"""Obozy (publiczne, znikają z czasem) i baza domowa (prywatna, z zaproszeniami)."""
import time

from . import config
from . import character as chm
from .character import GameError
from .db import content, execute, query
from .world import dist_m


def durability_now(s):
    it = content()["items"].get(s["item_id"], {})
    hours = max(0.0, (time.time() - (s.get("updated_at") or time.time())) / 3600.0)
    return max(0.0, (s.get("durability") or 0) - (it.get("decay_per_hour") or 0) * hours)


def active_camps(lat=None, lng=None, radius=None):
    t = time.time()
    rows = query("SELECT * FROM camps WHERE expires_at > ?", (t,))
    if lat is not None:
        rows = [r for r in rows if dist_m(lat, lng, r["lat"], r["lng"]) <= radius]
    return rows


def guest_of(user_id):
    """Właściciele baz, którzy zaprosili gracza."""
    return [r["owner_id"] for r in query("SELECT owner_id FROM base_guests WHERE guest_id=?", (user_id,))]


def bases_visible(user_id):
    ids = [user_id] + guest_of(user_id)
    out = []
    for oid in ids:
        r = query("SELECT user_id, name, home_lat, home_lng FROM characters WHERE user_id=?", (oid,), one=True)
        if r and r["home_lat"] is not None:
            out.append({"owner_id": oid, "owner_name": r["name"], "lat": r["home_lat"], "lng": r["home_lng"],
                        "own": oid == user_id})
    return out


def site_status(ch):
    """Gdzie gracz jest: obóz w pobliżu, własna/zaproszona baza w pobliżu."""
    lat, lng = ch["lat"], ch["lng"]
    camps = active_camps(lat, lng, config.CAMP_RADIUS_M)
    bases = [b for b in bases_visible(ch["user_id"])
             if dist_m(lat, lng, b["lat"], b["lng"]) <= config.CAMP_RADIUS_M]
    return {"camps": camps, "bases": bases, "in_camp": bool(camps), "at_base": bool(bases),
            "at_own_base": any(b["own"] for b in bases)}


def reachable_structures(ch, site=None):
    """Konstrukcje gracza (i baz, do których jest zaproszony) w zasięgu ręki."""
    site = site or site_status(ch)
    out = []
    camp_ids = [c["id"] for c in site["camps"]]
    owners = [b["owner_id"] for b in site["bases"]]
    if camp_ids:
        rows = query(f"SELECT * FROM structures WHERE site='camp' AND camp_id IN ({','.join('?' * len(camp_ids))})", camp_ids)
        out += [r for r in rows if r["owner_id"] == ch["user_id"]]
    if owners:
        rows = query(f"SELECT * FROM structures WHERE site='base' AND owner_id IN ({','.join('?' * len(owners))})", owners)
        out += rows
    for s in out:
        s["dur"] = durability_now(s)
    return out


def structure_view(s):
    it = content()["items"].get(s["item_id"], {})
    dur = durability_now(s)
    mx = it.get("max_durability") or 1
    return {"id": s["id"], "item_id": s["item_id"], "name": it.get("name", s["item_id"]), "glyph": it.get("glyph", "?"),
            "site": s["site"], "camp_id": s.get("camp_id"), "owner_id": s["owner_id"],
            "durability": round(dur, 1), "max_durability": mx, "pct": round(100 * dur / mx),
            "broken": dur <= 0, "repair_cost": it.get("repair_cost") or [],
            "decay_per_hour": it.get("decay_per_hour") or 0}


# --------------------------------------------------------------------------- akcje
def build_camp(ch):
    uid = ch["user_id"]
    t = time.time()
    mine = query("SELECT * FROM camps WHERE owner_id=? AND expires_at>?", (uid, t))
    if mine:
        raise GameError("Masz już rozbity obóz. Możesz dorzucić do niego drewna albo poczekać, aż wygaśnie.")
    if chm.count(uid, config.CAMP_TOOL) < 1:
        raise GameError(f"Bez krzesiwa nie rozpalisz ogniska.")
    for c in config.CAMP_COST:
        if chm.count(uid, c["item"]) < c["qty"]:
            name = content()["items"].get(c["item"], {}).get("name", c["item"])
            raise GameError(f"Potrzebujesz: {name} ×{c['qty']}.")
    for c in config.CAMP_COST:
        chm.remove_item(uid, c["item"], c["qty"])
    exp = t + config.CAMP_LIFETIME_H * 3600
    execute("INSERT INTO camps(owner_id, owner_name, name, lat, lng, created_at, expires_at) VALUES (?,?,?,?,?,?,?)",
            (uid, ch["name"], f"Obóz {ch['name']}", ch["lat"], ch["lng"], t, exp))
    chm.journal(uid, "camp", "Rozpalasz ognisko i rozkładasz obóz. Dym wznosi się prosto w niebo — ktoś na pewno go zobaczy.")
    return f"Obóz rozbity. Ogień będzie płonął przez {config.CAMP_LIFETIME_H} h."


def feed_camp(ch):
    uid = ch["user_id"]
    t = time.time()
    camp = query("SELECT * FROM camps WHERE owner_id=? AND expires_at>?", (uid, t), one=True)
    if not camp:
        raise GameError("Nie masz aktywnego obozu.")
    if dist_m(ch["lat"], ch["lng"], camp["lat"], camp["lng"]) > config.CAMP_RADIUS_M:
        raise GameError("Musisz stać przy swoim obozie.")
    chm.remove_item(uid, "drewno", 2)
    new_exp = min(t + config.CAMP_MAX_H * 3600, camp["expires_at"] + 6 * 3600)
    execute("UPDATE camps SET expires_at=? WHERE id=?", (new_exp, camp["id"]))
    return "Dorzucasz drewna. Ogień buzuje — obóz postoi dłużej (+6 h)."


def place_structure(ch, item_id, where):
    uid = ch["user_id"]
    it = content()["items"].get(item_id)
    if not it or not it.get("placeable"):
        raise GameError("Tego nie da się postawić.")
    site = site_status(ch)
    camp_id, lat, lng = None, ch["lat"], ch["lng"]
    if where == "camp":
        own = [c for c in site["camps"] if c["owner_id"] == uid]
        if not own:
            raise GameError("Stawiać możesz tylko w swoim obozie — stań przy nim.")
        camp_id, lat, lng = own[0]["id"], own[0]["lat"], own[0]["lng"]
    elif where == "base":
        if not site["at_own_base"]:
            raise GameError("Musisz być w swojej bazie.")
        lat, lng = ch["home_lat"], ch["home_lng"]
    else:
        raise GameError("Nieznane miejsce.")
    chm.remove_item(uid, item_id, 1)
    execute("INSERT INTO structures(owner_id,item_id,site,camp_id,lat,lng,durability,updated_at) VALUES (?,?,?,?,?,?,?,?)",
            (uid, item_id, where, camp_id, lat, lng, it.get("max_durability") or 100, time.time()))
    return f"Stawiasz: {it['name']}."


def pickup_structure(ch, sid):
    s = query("SELECT * FROM structures WHERE id=? AND owner_id=?", (sid, ch["user_id"]), one=True)
    if not s:
        raise GameError("To nie twoje.")
    if dist_m(ch["lat"], ch["lng"], s["lat"], s["lng"]) > config.CAMP_RADIUS_M:
        raise GameError("Podejdź bliżej.")
    if durability_now(s) <= 0:
        execute("DELETE FROM structures WHERE id=?", (sid,))
        return "Zostały z tego tylko szczątki. Rozbierasz je."
    execute("DELETE FROM structures WHERE id=?", (sid,))
    chm.add_item(ch["user_id"], s["item_id"], 1)
    return "Zabierasz konstrukcję do torby."


def repair_structure(ch, sid):
    s = query("SELECT * FROM structures WHERE id=?", (sid,), one=True)
    if not s:
        raise GameError("Nie ma takiej konstrukcji.")
    allowed = [ch["user_id"]] + guest_of(ch["user_id"])
    if s["owner_id"] not in allowed:
        raise GameError("To nie twoje.")
    if dist_m(ch["lat"], ch["lng"], s["lat"], s["lng"]) > config.CAMP_RADIUS_M:
        raise GameError("Podejdź bliżej.")
    it = content()["items"].get(s["item_id"], {})
    for c in it.get("repair_cost") or []:
        if chm.count(ch["user_id"], c["item"]) < c["qty"]:
            name = content()["items"].get(c["item"], {}).get("name", c["item"])
            raise GameError(f"Do naprawy potrzeba: {name} ×{c['qty']}.")
    for c in it.get("repair_cost") or []:
        chm.remove_item(ch["user_id"], c["item"], c["qty"])
    execute("UPDATE structures SET durability=?, updated_at=? WHERE id=?",
            (it.get("max_durability") or 100, time.time(), sid))
    return f"Naprawiasz: {it.get('name')}. Jak nowe."


def wear_structure(s, amount=2):
    dur = max(0.0, durability_now(s) - amount)
    execute("UPDATE structures SET durability=?, updated_at=? WHERE id=?", (dur, time.time(), s["id"]))


def set_home(ch):
    t = time.time()
    if ch.get("home_set_at") and t - ch["home_set_at"] < config.HOME_MOVE_COOLDOWN_H * 3600:
        left = config.HOME_MOVE_COOLDOWN_H * 3600 - (t - ch["home_set_at"])
        raise GameError(f"Bazę możesz przenieść za {int(left // 3600) + 1} h.")
    old = (ch.get("home_lat"), ch.get("home_lng"))
    ch["home_lat"], ch["home_lng"], ch["home_set_at"] = ch["lat"], ch["lng"], t
    if old[0] is not None:
        execute("UPDATE structures SET lat=?, lng=? WHERE owner_id=? AND site='base'", (ch["lat"], ch["lng"], ch["user_id"]))
    chm.journal(ch["user_id"], "base", "Wbijasz kołek w ziemię i mówisz: tu będzie moje siedlisko.")
    return "Tu jest twoje siedlisko. Widzisz je tylko ty i ci, których zaprosisz."


def invite(ch, username):
    u = query("SELECT id FROM users WHERE LOWER(username)=LOWER(?)", (username,), one=True)
    if not u:
        raise GameError("Nie ma takiego łowcy.")
    if u["id"] == ch["user_id"]:
        raise GameError("Siebie nie musisz zapraszać.")
    execute("INSERT OR IGNORE INTO base_guests(owner_id, guest_id) VALUES (?,?)", (ch["user_id"], u["id"]))
    return f"{username} może teraz odwiedzać twoje siedlisko."


def uninvite(ch, username):
    u = query("SELECT id FROM users WHERE LOWER(username)=LOWER(?)", (username,), one=True)
    if u:
        execute("DELETE FROM base_guests WHERE owner_id=? AND guest_id=?", (ch["user_id"], u["id"]))
    return f"{username} nie ma już wstępu do siedliska."


def guests(user_id):
    return [r["username"] for r in query(
        "SELECT u.username FROM base_guests g JOIN users u ON u.id=g.guest_id WHERE g.owner_id=?", (user_id,))]
