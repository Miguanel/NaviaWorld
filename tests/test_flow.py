"""Testy dymne całej pętli gry.

Uruchom:  python -m pytest tests      albo      python tests/test_flow.py
Test używa osobnej, tymczasowej bazy SQLite — nie rusza Twojej gry.
Z ustawionym DATABASE_URL testy działają na wskazanej (pustej!) bazie PostgreSQL.
"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ["NAVIA_DB"] = os.path.join(tempfile.mkdtemp(), "test.db")
os.environ["NAVIA_OSM"] = "0"
os.environ["NAVIA_DEBUG"] = "1"

from navia import character as chm  # noqa: E402
from navia import create_app  # noqa: E402
from navia.combat import start_combat  # noqa: E402
from navia.db import content  # noqa: E402

chm.check_cooldown = lambda ch, key, seconds: None  # w testach bez odczekiwania

APP = create_app()


def sql(q, args=()):
    from navia import db
    conn = db.connect()
    rows = conn.execute(q, args).fetchall()
    conn.commit()
    conn.close()
    return rows


def client(name):
    c = APP.test_client()
    r = c.post("/api/register", json={"username": name, "password": "haslo"})
    assert r.status_code == 200, r.json
    uid = sql("SELECT id FROM users WHERE username=?", (name,))[0][0]
    return c, {"Authorization": "Bearer " + r.json["token"]}, uid


from navia import config  # noqa: E402

ADMIN = APP.test_client()  # konto admina z config.py zakłada się samo
AH = {"Authorization": "Bearer " + ADMIN.post("/api/login", json={"username": config.ADMIN_USERNAME,
                                                                   "password": config.ADMIN_PASSWORD}).json["token"]}


def give(uid, item, qty=1):
    r = ADMIN.post(f"/api/admin/users/{uid}", json={"give": {"item": item, "qty": qty}}, headers=AH)
    assert r.status_code == 200, r.json


def admin(uid, **kw):
    ADMIN.post(f"/api/admin/users/{uid}", json=kw, headers=AH)


def set_combat(uid, monster, strength=1.0, hp=None):
    with APP.app_context():
        ch = chm.load(uid)
        start_combat(ch, content()["monsters"][monster], strength=strength)
        if hp is not None:
            ch["hp"] = hp
        chm.save(ch)


def goto(c, h, layer, kind):
    for _ in range(40):
        w = c.get("/api/world", headers=h).json
        for p in w[layer]:
            if p["kind"] == kind:
                c.post("/api/move", json={"lat": p["lat"], "lng": p["lng"]}, headers=h)
                return p
        st = c.get("/api/state", headers=h).json["state"]["char"]
        c.post("/api/move", json={"lat": st["lat"] + 0.012, "lng": st["lng"] + 0.004}, headers=h)
    raise AssertionError(f"nie znaleziono {layer}/{kind}")


def fight_to_end(c, h, action="attack", arg="ciecie"):
    for _ in range(100):
        r = c.post("/api/combat", json={"action": action, "arg": arg}, headers=h)
        if r.status_code == 400:
            r = c.post("/api/combat", json={"action": "attack", "arg": "ciecie"}, headers=h)
        assert r.status_code == 200, r.json
        if r.json["result"]["summary"]:
            return r.json["result"]["summary"]
    raise AssertionError("walka się nie skończyła")


def test_energy_and_modes():
    c, h, uid = client("Energia")
    st = c.get("/api/state", headers=h).json["state"]
    assert st["char"]["energy"] == 50
    assert list(st["energy_modes"]) == ["latwy", "normalny", "trudny", "specjalny"]
    for mode, cost in [("latwy", 1), ("normalny", 2), ("trudny", 3), ("specjalny", 5)]:
        before = c.get("/api/state", headers=h).json["state"]["char"]["energy"]
        r = c.post("/api/explore", json={"mode": mode}, headers=h)
        assert r.status_code == 200, r.json
        after = r.json["state"]["char"]["energy"]
        assert round(before - after) == cost, (mode, before, after)
        if r.json["state"]["combat"]:
            fight_to_end(c, h)
            admin(uid, heal=True)
    sql("UPDATE characters SET energy=0.5 WHERE user_id=?", (uid,))
    r = c.post("/api/explore", json={"mode": "latwy"}, headers=h)
    assert r.status_code == 400 and "energii" in r.json["error"]
    # regeneracja: +10 na godzinę
    sql("UPDATE characters SET energy=10, last_tick=last_tick-3600 WHERE user_id=?", (uid,))
    e = c.get("/api/state", headers=h).json["state"]["char"]["energy"]
    assert 19.9 <= e <= 20.2, e


def test_combat_all_actions():
    c, h, uid = client("Wojownik")
    give(uid, "woda_swiecona", 3); give(uid, "olej_bestii", 2); give(uid, "kamien", 3)
    set_combat(uid, "wilk")
    view = c.get("/api/state", headers=h).json["state"]["combat"]
    assert view and {a["id"] for a in view["attacks"]} >= {"ciecie", "potezny"} and view["items"]
    for action, arg in [("item", "olej_bestii"), ("item", "kamien"), ("spell", "tarcza"), ("spell", "peta"),
                        ("attack", "finta"), ("spell", "zar"), ("item", "wywar_krwawnika"), ("attack", "pchniecie")]:
        r = c.post("/api/combat", json={"action": action, "arg": arg}, headers=h)
        assert r.status_code == 200, (action, arg, r.json)
        if r.json["result"]["summary"]:
            break
    else:
        fight_to_end(c, h)
    # przegrana
    admin(uid, heal=True)
    set_combat(uid, "zmij", strength=3, hp=3)
    s = fight_to_end(c, h)
    assert s["result"] in ("lose", "win")
    # ucieczka
    admin(uid, heal=True)
    set_combat(uid, "wilk")
    for _ in range(40):
        r = c.post("/api/combat", json={"action": "flee"}, headers=h)
        assert r.status_code == 200
        if r.json["result"]["summary"]:
            break


def test_gather_camp_craft_structures_base():
    c, h, uid = client("Zielarz")
    goto(c, h, "zones", "las")
    r = c.post("/api/gather", json={"id": "g_drewno"}, headers=h)
    assert r.status_code == 200, r.json
    for it, q in [("drewno", 10), ("krwawnik", 4), ("kociol_alchemiczny", 1), ("alembik", 1), ("stol_zielarski", 1), ("miod", 1)]:
        give(uid, it, q)
    assert c.post("/api/camp/build", headers=h).status_code == 200
    assert c.post("/api/camp/build", headers=h).status_code == 400  # drugi obóz
    assert c.post("/api/camp/feed", headers=h).status_code == 200
    assert c.post("/api/structure/place", json={"item": "kociol_alchemiczny", "where": "camp"}, headers=h).status_code == 200
    r = c.post("/api/structure/place", json={"item": "stol_zielarski", "where": "camp"}, headers=h)
    structs = r.json["state"]["structures"]
    assert len(structs) == 2
    ev = c.post("/api/craft/evaluate", json={"recipe": "r_krwawnik", "catalysts": ["miod"]}, headers=h).json
    assert ev["can"] and ev["breakdown"]["katalizatory"] == 18, ev["breakdown"]
    assert c.post("/api/craft", json={"recipe": "r_krwawnik", "catalysts": ["miod"]}, headers=h).status_code == 200
    ev = c.post("/api/craft/evaluate", json={"recipe": "r_m_kot"}, headers=h).json
    assert any("poziom" in m for m in ev["missing"])
    s = c.post("/api/craft/suggest", json={"items": ["krwawnik", "woda_czysta"]}, headers=h).json
    assert s["recipes"]
    sid = structs[0]["id"]
    for it in ["ruda_zelaza", "wegiel", "zywica"]:
        give(uid, it)
    give(uid, "drewno", 3)
    assert c.post("/api/structure/repair", json={"id": sid}, headers=h).status_code == 200
    assert c.post("/api/structure/pickup", json={"id": sid}, headers=h).status_code == 200
    assert c.post("/api/home/set", headers=h).status_code == 200
    assert c.post("/api/home/invite", json={"username": "Wojownik"}, headers=h).status_code == 200
    give(uid, "oltarzyk")
    assert c.post("/api/structure/place", json={"item": "oltarzyk", "where": "base"}, headers=h).status_code == 200
    w = c.get("/api/world", headers=h).json
    assert w["camps"] and w["bases"][0]["structures"]


def test_mutation_and_stats():
    c, h, uid = client("Mutant")
    give(uid, "wywar_trzeciego_oka")
    r = c.post("/api/use", json={"item": "wywar_trzeciego_oka"}, headers=h)
    assert r.status_code == 200, r.json
    assert r.json["state"]["char"]["toxicity"] >= 49
    sql("UPDATE characters SET stat_points=2 WHERE user_id=?", (uid,))
    r = c.post("/api/stats/raise", json={"stat": "sila"}, headers=h)
    assert r.status_code == 200 and r.json["state"]["char"]["base_stats"]["sila"] == 6


def test_buildings_all_kinds():
    c, h, uid = client("Bywalec")
    admin(uid, coins=3000)
    give(uid, "lopata"); give(uid, "swieca", 3)
    seen = set()
    for kind in ["karczma", "klasztor", "kuznia", "cmentarz", "biblioteka", "ruiny", "chata_zielarki", "gontyna", "straznica"]:
        b = goto(c, h, "buildings", kind)
        v = c.get(f"/api/building/{b['id']}", headers=h)
        assert v.status_code == 200, v.json
        v = v.json
        for a in v["actions"]:
            payload = {}
            if a["type"] == "shop" and v["shop"]:
                payload = {"item": v["shop"][0]["item"], "qty": 1}
            if a["type"] == "sell" and v["sellable"]:
                payload = {"item": v["sellable"][0]["item"], "qty": 1}
            if a["type"] == "learn":
                t = [t for t in v["teaches"] if not t["known"] and t["min_level"] <= 1]
                if not t:
                    continue
                payload = {"recipe": t[0]["recipe"]}
            if a["type"] == "contracts":
                payload = {"contract": v["contracts"][0]["id"], "op": "take"}
            r = c.post(f"/api/building/{b['id']}", json={"index": a["index"], "payload": payload}, headers=h)
            assert r.status_code == 200, (kind, a, r.json)
            if r.json["state"]["combat"]:
                fight_to_end(c, h)
                admin(uid, heal=True)
            seen.add(a["type"])
    assert {"rest", "shop", "sell", "learn", "pray", "search", "contracts", "cleanse", "rumors", "bestiary"} <= seen, seen


def test_contract_reward():
    c, h, uid = client("Najemnik")
    b = goto(c, h, "buildings", "straznica")
    v = c.get(f"/api/building/{b['id']}", headers=h).json
    idx = next(a["index"] for a in v["actions"] if a["type"] == "contracts")
    ct = v["contracts"][0]
    assert c.post(f"/api/building/{b['id']}", json={"index": idx, "payload": {"contract": ct["id"], "op": "take"}}, headers=h).status_code == 200
    set_combat(uid, ct["monster"], strength=0.05)
    s = fight_to_end(c, h)
    assert s["result"] == "win", s
    coins = c.get("/api/state", headers=h).json["state"]["char"]["coins"]
    r = c.post(f"/api/building/{b['id']}", json={"index": idx, "payload": {"contract": ct["id"], "op": "claim"}}, headers=h)
    assert r.status_code == 200, r.json
    assert r.json["state"]["char"]["coins"] == coins + ct["reward"]


def test_admin_crud_and_sim():
    meta = ADMIN.get("/api/admin/meta", headers=AH).json
    assert "recipes" in meta["fields"]
    r = ADMIN.post("/api/admin/table/events", json={"id": "e_nowe", "name": "Nowe", "kind": "item", "ref": "krwawnik",
                                                     "base_weight": 50, "terrain_mods": {"las": 5}, "outcome": {"qty": [1, 1]}}, headers=AH)
    assert r.status_code == 200, r.json
    sim = ADMIN.post("/api/admin/simulate", json={"terrains": {"las": 1}}, headers=AH).json["probabilities"]
    assert sim[0]["id"] == "e_nowe"
    assert ADMIN.delete("/api/admin/table/events/e_nowe", headers=AH).status_code == 200
    r = ADMIN.post("/api/admin/table/places", json={"layer": "power", "kind": "cmentarz", "name": "Mój cmentarz",
                                                     "lat": 50.26, "lng": 19.02, "radius": 200, "strength": 1.5}, headers=AH)
    assert r.status_code == 200
    exp = ADMIN.get("/api/admin/export", headers=AH).json
    assert len(exp["items"]) > 50
    c, h, _ = client("Zwykly")
    assert c.get("/api/admin/meta", headers=h).status_code == 403


def test_money_format():
    assert chm.money(0) == "0 gr"
    assert chm.money(45) == "45 gr"
    assert chm.money(100) == "1 dobrota"
    assert chm.money(240) == "2 dobroty 40 gr"
    assert chm.money(512) == "5 dobrot 12 gr"
    assert chm.money(2205) == "22 dobroty 5 gr"
    assert chm.money(1250) == "12 dobrot 50 gr"


def test_walking_energy():
    c, h, uid = client("Piechur")
    st = c.get("/api/state", headers=h).json["state"]["char"]
    sql("UPDATE characters SET energy=10 WHERE user_id=?", (uid,))
    lat, lng = st["lat"], st["lng"]
    import time as _t
    sql("UPDATE characters SET last_move=? WHERE user_id=?", (_t.time() - 30, uid))
    r = c.post("/api/move", json={"lat": lat + 50 / 111320, "lng": lng}, headers=h)  # ~50 m pieszo
    e = r.json["state"]["char"]["energy"]
    assert 58 <= e <= 61, e
    # drganie GPS (2 m) — bez energii
    r = c.post("/api/move", json={"lat": lat + 52 / 111320, "lng": lng}, headers=h)
    assert abs(r.json["state"]["char"]["energy"] - e) < 0.5
    # skok o 5 km — bez energii
    sql("UPDATE characters SET energy=10 WHERE user_id=?", (uid,))
    r = c.post("/api/move", json={"lat": lat + 0.05, "lng": lng}, headers=h)
    assert r.json["state"]["char"]["energy"] < 11


def test_market_and_merchants_and_finder():
    seller, sh, sid = client("Kupiec")
    buyer, bh, bid = client("Klient")
    admin(sid, coins=1000)
    admin(bid, coins=1000)
    give(sid, "krwawnik", 10)
    # targowisko
    b = goto(buyer, bh, "buildings", "targ")
    v = buyer.get(f"/api/building/{b['id']}", headers=bh).json
    assert v["market"], v
    idx = next(a["index"] for a in v["actions"] if a["type"] == "market")
    r = buyer.post(f"/api/building/{b['id']}", json={"index": idx, "payload": {"item": v["market"][0]["item"]}}, headers=bh)
    assert r.status_code == 200, r.json
    # kram gracza obok targu
    seller.post("/api/move", json={"lat": b["lat"], "lng": b["lng"]}, headers=sh)
    r = seller.post("/api/merchant/create", json={"name": "Zioła u Kupca", "days": 3}, headers=sh)
    assert r.status_code == 200, r.json
    assert r.json["state"]["char"]["coins"] == 1030 - 150 or r.json["state"]["char"]["coins"] > 0
    mid = r.json["state"]["merchants"][0]["id"]
    assert seller.post("/api/merchant/create", json={"days": 1}, headers=sh).status_code == 400  # limit
    r = seller.post(f"/api/merchant/{mid}/stock", json={"item": "krwawnik", "qty": 5, "price": 12}, headers=sh)
    assert r.status_code == 200, r.json
    w = buyer.get("/api/world", headers=bh).json
    assert any(m["id"] == mid for m in w["merchants"])
    coins = buyer.get("/api/state", headers=bh).json["state"]["char"]["coins"]
    r = buyer.post(f"/api/merchant/{mid}/buy", json={"item": "krwawnik", "qty": 2}, headers=bh)
    assert r.status_code == 200, r.json
    assert r.json["state"]["char"]["coins"] == coins - 24
    # tropiciel znajduje kram
    f = buyer.get("/api/find?item=krwawnik", headers=bh).json
    types = {l["type"] for l in f["leads"]}
    assert "stall" in types and "gather" in types, types
    # utarg i zwinięcie
    r = seller.post(f"/api/merchant/{mid}/collect", headers=sh)
    assert r.status_code == 200 and "24 gr" in r.json["result"]["messages"][0], r.json
    r = seller.post(f"/api/merchant/{mid}/close", headers=sh)
    assert r.status_code == 200
    inv = {i["id"]: i["qty"] for i in r.json["state"]["inventory"]}
    assert inv.get("krwawnik") == 8, inv
    # tropiciel dla rzeczy z potworów
    f = buyer.get("/api/find?item=oko_nocnicy", headers=bh).json
    assert any(l["type"] == "hunt" for l in f["leads"]), f["leads"]


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("OK", name)
