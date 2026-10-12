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


# --------------------------------------------------------------------------- geometria obozu
def struct_radius(s):
    it = content()["items"].get(s["item_id"], {})
    return float(it.get("area_radius") or config.STRUCTURE_RADIUS_M)


def geometry(center_lat, center_lng, structs):
    """Obszar obozu/siedliska: centrum + budynki połączone z nim łańcuchem stykających się kręgów
    („ośmiornica”). Budynek odłączony działa tylko w swoim małym kręgu."""
    for s in structs:
        s["radius"] = struct_radius(s)
        s["connected"] = False
    frontier = [(center_lat, center_lng, config.CAMP_RADIUS_M)]
    while frontier:
        la, ln, r = frontier.pop()
        for s in structs:
            if not s["connected"] and dist_m(la, ln, s["lat"], s["lng"]) <= r + s["radius"]:
                s["connected"] = True
                frontier.append((s["lat"], s["lng"], s["radius"]))
    circles = [(center_lat, center_lng, config.CAMP_RADIUS_M)] + \
              [(s["lat"], s["lng"], s["radius"]) for s in structs if s["connected"]]
    return circles, structs


def in_circles(lat, lng, circles):
    return any(dist_m(lat, lng, la, ln) <= r for la, ln, r in circles)


def camp_structs(camp_id):
    return query("SELECT * FROM structures WHERE site='camp' AND camp_id=?", (camp_id,))


def base_structs(owner_id):
    return query("SELECT * FROM structures WHERE site='base' AND owner_id=?", (owner_id,))


def site_status(ch):
    """Gdzie gracz jest: w obszarze obozu albo siedliska (centrum + połączone budynki)."""
    lat, lng = ch["lat"], ch["lng"]
    near = config.CAMP_RADIUS_M + config.SITE_MAX_SPREAD_M
    camps, bases, loose = [], [], []
    for c in active_camps(lat, lng, near):
        circles, structs = geometry(c["lat"], c["lng"], camp_structs(c["id"]))
        if in_circles(lat, lng, circles):
            camps.append(c)
        c["_structs"] = structs
        c["_inside"] = in_circles(lat, lng, circles)
        loose.append(c)
    for b in bases_visible(ch["user_id"]):
        if dist_m(lat, lng, b["lat"], b["lng"]) > near:
            continue
        circles, structs = geometry(b["lat"], b["lng"], base_structs(b["owner_id"]))
        b["_structs"] = structs
        b["_inside"] = in_circles(lat, lng, circles)
        if b["_inside"]:
            bases.append(b)
        loose.append(b)
    return {"camps": camps, "bases": bases, "in_camp": bool(camps), "at_base": bool(bases),
            "at_own_base": any(b["own"] for b in bases), "_sites": loose}


def reachable_structures(ch, site=None):
    """Budynki w zasięgu: połączone z obszarem, w którym stoisz, albo odłączone, przy których stoisz."""
    site = site or site_status(ch)
    out = []
    for s_ in site["_sites"]:
        is_camp = "expires_at" in s_
        for s in s_.get("_structs", []):
            if is_camp and s["owner_id"] != ch["user_id"]:
                continue
            here = dist_m(ch["lat"], ch["lng"], s["lat"], s["lng"]) <= s["radius"]
            if (s["connected"] and s_["_inside"]) or here:
                s["dur"] = durability_now(s)
                out.append(s)
    return out


def structure_view(s):
    it = content()["items"].get(s["item_id"], {})
    dur = durability_now(s)
    mx = it.get("max_durability") or 1
    return {"id": s["id"], "item_id": s["item_id"], "name": it.get("name", s["item_id"]), "glyph": it.get("glyph", "?"),
            "site": s["site"], "camp_id": s.get("camp_id"), "owner_id": s["owner_id"],
            "lat": s["lat"], "lng": s["lng"], "radius": s.get("radius") or struct_radius(s),
            "connected": s.get("connected", True),
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
    if not any(c["id"] == camp["id"] for c in site_status(ch)["camps"]):
        raise GameError("Musisz być w obszarze swojego obozu.")
    chm.remove_item(uid, "drewno", 2)
    new_exp = min(t + config.CAMP_MAX_H * 3600, camp["expires_at"] + 6 * 3600)
    execute("UPDATE camps SET expires_at=? WHERE id=?", (new_exp, camp["id"]))
    return "Dorzucasz drewna. Ogień buzuje — obóz postoi dłużej (+6 h)."


def my_camp(uid):
    return query("SELECT * FROM camps WHERE owner_id=? AND expires_at>?", (uid, time.time()), one=True)


def place_structure(ch, item_id, where, lat=None, lng=None):
    """Rozbudowa: stawia budynek w wybranym punkcie (domyślnie tam, gdzie stoisz).
    Punkt musi być blisko ciebie i nie dalej niż SITE_MAX_SPREAD_M od centrum."""
    uid = ch["user_id"]
    it = content()["items"].get(item_id)
    if not it or not it.get("placeable"):
        raise GameError("Tego nie da się postawić.")
    lat = ch["lat"] if lat is None else float(lat)
    lng = ch["lng"] if lng is None else float(lng)
    if dist_m(ch["lat"], ch["lng"], lat, lng) > config.BUILD_REACH_M:
        raise GameError(f"Budować możesz najdalej {config.BUILD_REACH_M} m od siebie — podejdź bliżej.")
    camp_id = None
    if where == "camp":
        c = my_camp(uid)
        if not c:
            raise GameError("Nie masz rozbitego obozu.")
        camp_id, clat, clng = c["id"], c["lat"], c["lng"]
    elif where == "base":
        if ch.get("home_lat") is None:
            raise GameError("Nie masz jeszcze siedliska.")
        clat, clng = ch["home_lat"], ch["home_lng"]
    else:
        raise GameError("Nieznane miejsce.")
    if dist_m(clat, clng, lat, lng) > config.SITE_MAX_SPREAD_M:
        raise GameError(f"To za daleko od centrum (najwyżej {config.SITE_MAX_SPREAD_M} m).")
    chm.remove_item(uid, item_id, 1)
    execute("INSERT INTO structures(owner_id,item_id,site,camp_id,lat,lng,durability,updated_at) VALUES (?,?,?,?,?,?,?,?)",
            (uid, item_id, where, camp_id, lat, lng, it.get("max_durability") or 100, time.time()))
    # czy nowy budynek połączył się z obszarem?
    structs = camp_structs(camp_id) if where == "camp" else base_structs(uid)
    _, structs = geometry(clat, clng, structs)
    new = max(structs, key=lambda s: s["id"])
    if new["connected"]:
        return f"Stawiasz: {it['name']}. Jego krąg łączy się z obszarem — działa w całym {('obozie' if where == 'camp' else 'siedlisku')}."
    return f"Stawiasz: {it['name']}. Stoi osobno — działa tylko w swoim kręgu (~{int(struct_radius(new))} m). Postaw coś pomiędzy, żeby go połączyć."


def move_site(ch, where, lat, lng):
    """Przenosi obóz albo siedlisko w wybrane miejsce na mapie razem z budynkami (zachowuje ich układ)."""
    uid = ch["user_id"]
    lat, lng = float(lat), float(lng)
    if not (-85 < lat < 85 and -180 <= lng <= 180):
        raise GameError("Złe współrzędne.")
    if where == "camp":
        c = my_camp(uid)
        if not c:
            raise GameError("Nie masz rozbitego obozu.")
        dlat, dlng = lat - c["lat"], lng - c["lng"]
        execute("UPDATE camps SET lat=?, lng=? WHERE id=?", (lat, lng, c["id"]))
        execute("UPDATE structures SET lat=lat+?, lng=lng+? WHERE site='camp' AND camp_id=?", (dlat, dlng, c["id"]))
        chm.journal(uid, "camp", "Zwijasz obóz i rozbijasz go w nowym miejscu.")
        return "Obóz przeniesiony razem z budynkami."
    if where == "base":
        if ch.get("home_lat") is None:
            ch["home_lat"], ch["home_lng"], ch["home_set_at"] = lat, lng, time.time()
            return "Tu jest twoje siedlisko."
        return set_home(ch, lat, lng)
    raise GameError("Nieznane miejsce.")


def site_view(ch, where, owner_id=None):
    """Obóz/siedlisko z budynkami i informacją, które są połączone."""
    uid = ch["user_id"]
    if where == "camp":
        c = my_camp(uid)
        if not c:
            return None
        _, structs = geometry(c["lat"], c["lng"], camp_structs(c["id"]))
        return {"type": "camp", "id": c["id"], "name": c["name"], "lat": c["lat"], "lng": c["lng"],
                "radius": config.CAMP_RADIUS_M, "left_h": round((c["expires_at"] - time.time()) / 3600, 1),
                "structures": [structure_view(s) for s in structs]}
    oid = owner_id or uid
    r = query("SELECT name, home_lat, home_lng FROM characters WHERE user_id=?", (oid,), one=True)
    if not r or r["home_lat"] is None:
        return None
    _, structs = geometry(r["home_lat"], r["home_lng"], base_structs(oid))
    return {"type": "base", "owner_id": oid, "name": f"Siedlisko {r['name']}", "lat": r["home_lat"], "lng": r["home_lng"],
            "radius": config.CAMP_RADIUS_M, "own": oid == uid, "structures": [structure_view(s) for s in structs]}


def pickup_structure(ch, sid):
    s = query("SELECT * FROM structures WHERE id=? AND owner_id=?", (sid, ch["user_id"]), one=True)
    if not s:
        raise GameError("To nie twoje.")
    if dist_m(ch["lat"], ch["lng"], s["lat"], s["lng"]) > config.BUILD_REACH_M:
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
    if dist_m(ch["lat"], ch["lng"], s["lat"], s["lng"]) > config.BUILD_REACH_M:
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


def set_home(ch, lat=None, lng=None):
    t = time.time()
    if ch.get("home_set_at") and t - ch["home_set_at"] < config.HOME_MOVE_COOLDOWN_H * 3600:
        left = config.HOME_MOVE_COOLDOWN_H * 3600 - (t - ch["home_set_at"])
        raise GameError(f"Bazę możesz przenieść za {int(left // 3600) + 1} h.")
    lat = ch["lat"] if lat is None else float(lat)
    lng = ch["lng"] if lng is None else float(lng)
    old = (ch.get("home_lat"), ch.get("home_lng"))
    ch["home_lat"], ch["home_lng"], ch["home_set_at"] = lat, lng, t
    if old[0] is not None:  # budynki przenoszą się razem z siedliskiem, zachowując układ
        execute("UPDATE structures SET lat=lat+?, lng=lng+? WHERE owner_id=? AND site='base'",
                (lat - old[0], lng - old[1], ch["user_id"]))
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
