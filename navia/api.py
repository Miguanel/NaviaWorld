"""REST API gry."""
import functools
import secrets
import time

from flask import Blueprint, g, jsonify, request
from werkzeug.security import check_password_hash, generate_password_hash

from . import build as buildm
from . import camp as campm
from . import character as chm
from . import combat as combatm
from . import config
from . import crafting
from . import explore as explorem
from . import finder
from . import places as placesm
from . import trade
from . import world
from .character import GameError
from .db import content, execute, query

bp = Blueprint("api", __name__, url_prefix="/api")


# --------------------------------------------------------------------------- auth
def current_user():
    h = request.headers.get("Authorization", "")
    token = h[7:] if h.startswith("Bearer ") else request.args.get("token")
    if not token:
        return None
    s = query("SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=?", (token,), one=True)
    return s


def login_required(fn):
    @functools.wraps(fn)
    def wrapper(*a, **kw):
        u = current_user()
        if not u:
            return jsonify({"error": "Zaloguj się."}), 401
        g.user = u
        try:
            return fn(*a, **kw)
        except GameError as e:
            return jsonify({"error": str(e)}), 400
        except (ValueError, TypeError, KeyError):
            return jsonify({"error": "Błędne dane w zapytaniu."}), 400
    return wrapper


def admin_required(fn):
    @functools.wraps(fn)
    def wrapper(*a, **kw):
        u = current_user()
        if not u or not u["is_admin"]:
            return jsonify({"error": "Tylko dla admina."}), 403
        g.user = u
        try:
            return fn(*a, **kw)
        except (GameError, ValueError, KeyError) as e:
            return jsonify({"error": str(e)}), 400
    return wrapper


def _session(uid):
    token = secrets.token_urlsafe(32)
    execute("INSERT INTO sessions(token, user_id, created_at) VALUES (?,?,?)", (token, uid, time.time()))
    return token


@bp.post("/register")
def register():
    data = request.get_json(force=True, silent=True) or {}
    name = (data.get("username") or "").strip()
    pw = data.get("password") or ""
    if not (3 <= len(name) <= 20) or not all(ch.isalnum() or ch in "_-" for ch in name):
        return jsonify({"error": "Imię łowcy: 3–20 znaków, litery, cyfry, _ lub -."}), 400
    if len(pw) < 4:
        return jsonify({"error": "Hasło musi mieć co najmniej 4 znaki."}), 400
    if query("SELECT 1 FROM users WHERE LOWER(username)=LOWER(?)", (name,), one=True):
        return jsonify({"error": "To imię jest już zajęte."}), 400
    first = query("SELECT COUNT(*) AS n FROM users", one=True)["n"] == 0
    cur = execute("INSERT INTO users(username, pass_hash, is_admin, created_at) VALUES (?,?,?,?)",
                  (name, generate_password_hash(pw), 1 if first else 0, time.time()))
    uid = cur.lastrowid
    chm.create(uid, name)
    return jsonify({"token": _session(uid), "username": name, "is_admin": first})


@bp.post("/login")
def login():
    data = request.get_json(force=True, silent=True) or {}
    u = query("SELECT * FROM users WHERE LOWER(username)=LOWER(?)", ((data.get("username") or "").strip(),), one=True)
    if not u or not check_password_hash(u["pass_hash"], data.get("password") or ""):
        return jsonify({"error": "Złe imię albo hasło."}), 400
    return jsonify({"token": _session(u["id"]), "username": u["username"], "is_admin": bool(u["is_admin"])})


@bp.post("/logout")
@login_required
def logout():
    h = request.headers.get("Authorization", "")
    execute("DELETE FROM sessions WHERE token=?", (h[7:],))
    return jsonify({"ok": True})


# --------------------------------------------------------------------------- pomocnicze
def _char():
    ch = chm.load(g.user["id"])
    if not ch:
        chm.create(g.user["id"], g.user["username"])
        ch = chm.load(g.user["id"])
    chm.tick(ch)
    return ch


def _body():
    return request.get_json(force=True, silent=True) or {}


def _items_view(user_id):
    c = content()["items"]
    out = []
    for row in chm.inventory(user_id):
        it = c.get(row["item_id"])
        if not it:
            continue
        eff = it.get("effects") or {}
        out.append({"id": it["id"], "qty": row["qty"], "name": it["name"], "glyph": it["glyph"],
                    "category": it["category"], "rarity": it["rarity"], "description": it["description"],
                    "value": it["value"], "usable": bool(it["usable"]) and not eff.get("oil"),
                    "is_tool": bool(it["is_tool"]), "placeable": bool(it["placeable"]),
                    "catalyst_bonus": it.get("catalyst_bonus") or 0, "tool_bonus": it.get("tool_bonus") or 0,
                    "effects": eff, "slot": chm.item_slot(it) or None,
                    "uses": len(it.get("uses") or []) if it.get("placeable") else 0})
    return out


def state_payload(ch, ctx=None):
    ctx = ctx or world.context_at(ch["lat"], ch["lng"])
    d = chm.derived(ch, ctx)
    if ch["hp"] > d["max_hp"]:  # np. punkt mocy obniżył witalność
        ch["hp"] = d["max_hp"]
    site = campm.site_status(ch)
    structs = [campm.structure_view(s) for s in campm.reachable_structures(ch, site)]
    my_camp = query("SELECT * FROM camps WHERE owner_id=? AND expires_at>?", (ch["user_id"], time.time()), one=True)
    eqv = chm.equipment_view(ch)
    omens = {}
    for mid in config.EXPLORE_MODES:
        omens[mid] = explorem.probabilities(ctx["terrains"], ctx["power_infl"], ctx["night"], ch["level"], mid,
                                            d["stats"]["percepcja"])[:10]
    journal = query("SELECT ts, kind, text FROM journal WHERE user_id=? ORDER BY id DESC LIMIT 40", (ch["user_id"],))
    return {
        "char": {
            "name": ch["name"], "level": ch["level"], "xp": ch["xp"], "xp_next": d["xp_next"],
            "stat_points": ch["stat_points"], "hp": round(ch["hp"], 1), "max_hp": d["max_hp"],
            "vigor": round(ch["vigor"], 1), "max_vigor": d["max_vigor"], "toxicity": round(ch["toxicity"], 1),
            "max_tox": d["max_tox"], "energy": round(ch["energy"], 2), "max_energy": config.ENERGY_MAX,
            "energy_per_hour": config.ENERGY_PER_HOUR, "vigor_per_meter": config.VIGOR_PER_METER,
            "coins": ch["coins"], "money": chm.money(ch["coins"]),
            "base_stats": ch["stats"], "stats": d["stats"], "mutations": ch["mutations"],
            "mutation_slots": d["mutation_slots"],
            "effects": [{"name": e["name"], "stats": e.get("stats", {}), "left": int(e["until"] - time.time())}
                        for e in ch["effects"]],
            "lat": ch["lat"], "lng": ch["lng"], "home": [ch["home_lat"], ch["home_lng"]] if ch["home_lat"] is not None else None,
            "equipment": eqv,
            "contracts": ch["contracts"], "is_admin": bool(g.user["is_admin"]),
        },
        "ctx": ctx,
        "inventory": _items_view(ch["user_id"]),
        "gathers": placesm.gather_available(ch, ctx),
        "site": {"in_camp": site["in_camp"], "at_base": site["at_base"], "at_own_base": site["at_own_base"],
                 "camps": [{"id": c["id"], "owner": c["owner_name"], "own": c["owner_id"] == ch["user_id"],
                            "left_h": round((c["expires_at"] - time.time()) / 3600, 1)} for c in site["camps"]],
                 "my_camp": my_camp and {"id": my_camp["id"], "lat": my_camp["lat"], "lng": my_camp["lng"],
                                         "left_h": round((my_camp["expires_at"] - time.time()) / 3600, 1)},
                 "guests": campm.guests(ch["user_id"])},
        "structures": structs,
        "combat": combatm.combat_view(ch),
        "omens": omens,
        "energy_modes": config.EXPLORE_MODES,
        "journal": journal,
        "merchants": trade.mine(ch["user_id"]),
        "merchant_cfg": {"day_cost": config.MERCHANT_DAY_COST, "max_days": config.MERCHANT_MAX_DAYS},
    }


def respond(ch, result=None, ctx=None, full=True):
    out = {"result": result}
    if full:
        out["state"] = state_payload(ch, ctx)
    chm.save(ch)
    return jsonify(out)


# --------------------------------------------------------------------------- endpointy
@bp.get("/health")
def health():
    """Budzik serwera: aplikacja odpytuje ten adres przy starcie, zanim pokaże grę."""
    from . import db as dbm
    try:
        query("SELECT 1 AS ok", one=True)
        db_ok = True
    except Exception as exc:  # baza jeszcze wstaje
        print(f"[navia] health: {exc}")
        db_ok = False
    return jsonify({"ok": db_ok, "db": dbm.BACKEND, "name": config.GAME_NAME, "ts": time.time()}), (200 if db_ok else 503)


@bp.get("/config")
def get_config():
    return jsonify({"name": config.GAME_NAME, "subtitle": config.GAME_SUBTITLE, "debug": config.DEBUG_MOVEMENT,
                    "start": config.DEFAULT_START, "modes": config.EXPLORE_MODES,
                    "interact_radius": config.INTERACT_RADIUS_M, "camp_radius": config.CAMP_RADIUS_M,
                    "build_reach": config.BUILD_REACH_M, "site_spread": config.SITE_MAX_SPREAD_M,
                    "stat_names": chm.STAT_NAMES, "tiles": config.map_tiles(),
                    "slots": [{"slot": k, "name": n, "accepts": a} for k, n, a in chm.SLOTS],
                    "slot_types": chm.ITEM_SLOT_TYPES, "weapon_kinds": chm.WEAPON_KINDS,
                    "recipe_groups": crafting.RECIPE_GROUPS,
                    "currency": {"names": config.CURRENCY, "per": config.GROSZE_PER_DOBROTA},
                    "explore_cooldown": config.EXPLORE_COOLDOWN_S,
                    "combat_moves": {
                        "attacks": [{"id": k, "name": v["name"], "glyph": v["glyph"], "cd": v["cd"]} for k, v in combatm.ATTACKS.items()],
                        "spells": [{"id": k, "name": v["name"], "glyph": v["glyph"], "cd": v["cd"]} for k, v in combatm.SPELLS.items()],
                        "default_plan": combatm.DEFAULT_PLAN}})


@bp.get("/content")
def get_content():
    c = content()
    return jsonify({
        "terrains": c["terrains"], "power_kinds": c["power_kinds"],
        "building_types": {k: {"id": k, "name": v["name"], "glyph": v["glyph"], "description": v["description"]}
                           for k, v in c["building_types"].items()},
        "items": {k: {"id": k, "name": v["name"], "glyph": v["glyph"], "category": v["category"],
                      "rarity": v["rarity"], "description": v["description"]} for k, v in c["items"].items()},
    })


@bp.get("/state")
@login_required
def get_state():
    ch = _char()
    world.ensure_osm(ch["lat"], ch["lng"])
    return respond(ch)


@bp.post("/move")
@login_required
def move():
    ch = _char()
    b = _body()
    lat, lng = float(b["lat"]), float(b["lng"])
    if not (-85 < lat < 85 and -180 <= lng <= 180):
        raise GameError("Złe współrzędne.")
    t = time.time()
    # admin zawsze może używać strzałek / teleportu (testy na produkcji)
    if not config.DEBUG_MOVEMENT and not g.user["is_admin"] and ch.get("last_move") and ch["lat"] is not None:
        dt = max(1.0, t - ch["last_move"])
        if world.dist_m(ch["lat"], ch["lng"], lat, lng) / dt > config.MAX_SPEED_MS:
            raise GameError("Poruszasz się za szybko — czyżby czary?")
    gained = 0.0
    if ch["lat"] is not None and config.VIGOR_PER_METER > 0 and not ch.get("combat"):
        # wigor za chodzenie: pomijamy drgania GPS, jazdę pojazdem i skoki/teleporty
        step = world.dist_m(ch["lat"], ch["lng"], lat, lng)
        dt = max(0.5, t - (ch.get("last_move") or t - 1))
        if config.WALK_MIN_STEP_M <= step <= config.WALK_MAX_STEP_M and step / dt <= config.WALK_MAX_SPEED_MS:
            before = ch["vigor"]
            ch["vigor"] = min(chm.derived(ch)["max_vigor"], ch["vigor"] + step * config.VIGOR_PER_METER)
            gained = ch["vigor"] - before
    if gained or not ch.get("last_move") or world.dist_m(ch["lat"] or lat, ch["lng"] or lng, lat, lng) >= config.WALK_MIN_STEP_M:
        ch["lat"], ch["lng"], ch["last_move"] = lat, lng, t
    world.ensure_osm(lat, lng)
    return respond(ch, {"ok": True, "vigor_gained": round(gained, 1)})


@bp.get("/world")
@login_required
def get_world():
    ch = _char()
    chm.save(ch)
    lat = float(request.args.get("lat", ch["lat"]))
    lng = float(request.args.get("lng", ch["lng"]))
    pl = world.places_around(lat, lng)
    camps = []
    t = time.time()
    for cp in campm.active_camps(lat, lng, 2500):
        total = max(1, cp["expires_at"] - cp["created_at"])
        _, structs = campm.geometry(cp["lat"], cp["lng"], campm.camp_structs(cp["id"]))
        camps.append({"id": cp["id"], "owner": cp["owner_name"], "name": cp["name"], "lat": cp["lat"], "lng": cp["lng"],
                      "left_h": round((cp["expires_at"] - t) / 3600, 1), "fade": round((cp["expires_at"] - t) / total, 2),
                      "own": cp["owner_id"] == ch["user_id"], "radius": config.CAMP_RADIUS_M,
                      "structures": [campm.structure_view(s) for s in structs]})
    players = []
    for p in query("SELECT user_id, name, level, lat, lng FROM characters WHERE last_seen>? AND user_id!=?",
                   (t - 600, ch["user_id"])):
        if p["lat"] is not None and world.dist_m(lat, lng, p["lat"], p["lng"]) < 2500:
            players.append({"name": p["name"], "level": p["level"], "lat": p["lat"], "lng": p["lng"]})
    bases = []
    for b in campm.bases_visible(ch["user_id"]):
        _, structs = campm.geometry(b["lat"], b["lng"], campm.base_structs(b["owner_id"]))
        bases.append({**b, "radius": config.CAMP_RADIUS_M, "structures": [campm.structure_view(s) for s in structs]})
    merchants = trade.merchants_near(lat, lng, 2500, viewer_id=ch["user_id"], with_stock=False)
    return jsonify({"zones": pl["zones"], "power": pl["power"], "buildings": pl["buildings"],
                    "camps": camps, "players": players, "bases": bases, "merchants": merchants})


@bp.post("/explore")
@login_required
def do_explore():
    ch = _char()
    ctx = world.context_at(ch["lat"], ch["lng"])
    res = explorem.explore(ch, ctx, _body().get("mode", "normalny"))
    if res.get("combat"):
        res["combat"] = combatm.combat_view(ch)
    return respond(ch, res, ctx)


@bp.post("/combat")
@login_required
def do_combat():
    ch = _char()
    b = _body()
    res = combatm.act(ch, b.get("action"), b.get("arg"))
    view = combatm.combat_view(ch) if ch.get("combat") else None
    return respond(ch, {"turn_log": res["turn_log"], "summary": res["summary"], "combat": view, "auto": res.get("auto"),
                        "monster_hp": res["combat"]["hp"], "monster_max_hp": res["combat"]["max_hp"]})


@bp.post("/gather")
@login_required
def do_gather():
    ch = _char()
    ctx = world.context_at(ch["lat"], ch["lng"])
    return respond(ch, placesm.gather(ch, ctx, _body().get("id")), ctx)


@bp.post("/use")
@login_required
def do_use():
    ch = _char()
    if ch.get("combat"):
        raise GameError("W walce użyj przedmiotu z menu Torba.")
    return respond(ch, {"messages": chm.use_item(ch, _body().get("item"))})


@bp.post("/drop")
@login_required
def do_drop():
    ch = _char()
    b = _body()
    chm.remove_item(ch["user_id"], b.get("item"), max(1, int(b.get("qty", 1))))
    return respond(ch, {"messages": ["Wyrzucasz to w krzaki."]})


@bp.post("/equip")
@login_required
def do_equip():
    ch = _char()
    b = _body()
    return respond(ch, {"messages": chm.equip(ch, b.get("item"), b.get("slot") or None)})


@bp.post("/unequip")
@login_required
def do_unequip():
    ch = _char()
    return respond(ch, {"messages": [chm.unequip(ch, _body().get("slot"))]})


@bp.post("/stats/raise")
@login_required
def raise_stat():
    ch = _char()
    s = _body().get("stat")
    if s not in chm.STAT_NAMES:
        raise GameError("Nieznana cecha.")
    if ch["stat_points"] <= 0:
        raise GameError("Brak punktów cech.")
    ch["stat_points"] -= 1
    ch["stats"][s] = ch["stats"].get(s, chm.BASE_STATS[s]) + 1
    return respond(ch, {"messages": [f"{chm.STAT_NAMES[s]} +1"]})


@bp.get("/recipes")
@login_required
def get_recipes():
    ch = _char()
    ctx = world.context_at(ch["lat"], ch["lng"])
    return jsonify({"recipes": crafting.recipe_book(ch, ctx)})


@bp.post("/craft/suggest")
@login_required
def craft_suggest():
    ch = _char()
    ctx = world.context_at(ch["lat"], ch["lng"])
    return jsonify(crafting.suggest(ch, ctx, _body().get("items") or []))


@bp.post("/craft/evaluate")
@login_required
def craft_evaluate():
    ch = _char()
    ctx = world.context_at(ch["lat"], ch["lng"])
    b = _body()
    r = content()["recipes"].get(b.get("recipe"))
    if not r:
        raise GameError("Nie ma takiej receptury.")
    return jsonify(crafting.evaluate(ch, r, crafting.Workshop(ch, ctx), b.get("catalysts") or []))


@bp.post("/craft")
@login_required
def do_craft():
    ch = _char()
    ctx = world.context_at(ch["lat"], ch["lng"])
    b = _body()
    return respond(ch, crafting.craft(ch, ctx, b.get("recipe"), b.get("catalysts") or []), ctx)


@bp.get("/building/<pid>")
@login_required
def building_view(pid):
    ch = _char()
    return jsonify(placesm.view(ch, pid))


@bp.post("/building/<pid>")
@login_required
def building_act(pid):
    ch = _char()
    ctx = world.context_at(ch["lat"], ch["lng"])
    b = _body()
    res = placesm.act(ch, ctx, pid, b.get("index"), b.get("payload"))
    if res.get("combat"):
        res["combat"] = combatm.combat_view(ch)
    chm.save(ch)
    res["building"] = placesm.view(ch, pid)
    return respond(ch, res, ctx)


@bp.post("/camp/build")
@login_required
def camp_build():
    ch = _char()
    return respond(ch, {"messages": [campm.build_camp(ch)]})


@bp.post("/camp/feed")
@login_required
def camp_feed():
    ch = _char()
    return respond(ch, {"messages": [campm.feed_camp(ch)]})


@bp.post("/structure/place")
@login_required
def structure_place():
    ch = _char()
    b = _body()
    return respond(ch, {"messages": [campm.place_structure(ch, b.get("item"), b.get("where"), b.get("lat"), b.get("lng"))]})


@bp.post("/structure/pickup")
@login_required
def structure_pickup():
    ch = _char()
    return respond(ch, {"messages": [campm.pickup_structure(ch, int(_body().get("id")))]})


@bp.post("/structure/repair")
@login_required
def structure_repair():
    ch = _char()
    return respond(ch, {"messages": [campm.repair_structure(ch, int(_body().get("id")))]})


@bp.post("/home/set")
@login_required
def home_set():
    ch = _char()
    b = _body()
    return respond(ch, {"messages": [campm.set_home(ch, b.get("lat"), b.get("lng"))]})


@bp.get("/site/<where>")
@login_required
def site_get(where):
    ch = _char()
    return jsonify(campm.site_view(ch, where, request.args.get("owner", type=int)))


@bp.get("/site/<where>/buildables")
@login_required
def site_buildables(where):
    ch = _char()
    ctx = world.context_at(ch["lat"], ch["lng"])
    chm.save(ch)
    return jsonify(buildm.buildables(ch, ctx, where))


@bp.post("/site/build")
@login_required
def site_build():
    ch = _char()
    ctx = world.context_at(ch["lat"], ch["lng"])
    b = _body()
    return respond(ch, buildm.build(ch, ctx, b.get("where"), b.get("recipe"), b.get("lat"), b.get("lng"),
                                    b.get("catalysts") or []), ctx)


@bp.get("/structure/<int:sid>")
@login_required
def structure_get(sid):
    ch = _char()
    ctx = world.context_at(ch["lat"], ch["lng"])
    chm.save(ch)
    return jsonify(buildm.structure_detail(ch, ctx, sid))


@bp.post("/structure/use")
@login_required
def structure_use():
    ch = _char()
    b = _body()
    return respond(ch, buildm.use_structure(ch, int(b.get("id")), b.get("index", 0)))


@bp.post("/site/move")
@login_required
def site_move():
    ch = _char()
    b = _body()
    return respond(ch, {"messages": [campm.move_site(ch, b.get("where"), b.get("lat"), b.get("lng"))]})


@bp.post("/home/invite")
@login_required
def home_invite():
    ch = _char()
    return respond(ch, {"messages": [campm.invite(ch, (_body().get("username") or "").strip())]})


@bp.post("/home/uninvite")
@login_required
def home_uninvite():
    ch = _char()
    return respond(ch, {"messages": [campm.uninvite(ch, (_body().get("username") or "").strip())]})


# --------------------------------------------------------------------------- tropiciel
@bp.get("/find")
@login_required
def find_item():
    ch = _char()
    chm.save(ch)
    if request.args.get("monster"):
        return jsonify(finder.find_monster(ch, request.args.get("monster")))
    return jsonify(finder.find(ch, request.args.get("item", "")))


@bp.get("/influence")
@login_required
def influence():
    """Dymek po kliknięciu czipa pozycji: jak teren / punkt mocy / noc wpływa na cechy i zdarzenia."""
    ch = _char()
    ctx = world.context_at(ch["lat"], ch["lng"])
    chm.save(ch)
    return jsonify(explorem.influence(ch, ctx, request.args.get("what", "")))


# --------------------------------------------------------------------------- kramy graczy
@bp.get("/merchant/<int:mid>")
@login_required
def merchant_view(mid):
    ch = _char()
    m = trade.get(mid)
    v = trade.view(m, ch["user_id"])
    v["dist"] = round(world.dist_m(ch["lat"], ch["lng"], m["lat"], m["lng"]))
    return jsonify(v)


@bp.post("/merchant/create")
@login_required
def merchant_create():
    ch = _char()
    b = _body()
    return respond(ch, {"messages": [trade.create(ch, b.get("name"), b.get("days", 1))]})


@bp.post("/merchant/<int:mid>/<op>")
@login_required
def merchant_op(mid, op):
    ch = _char()
    b = _body()
    ops = {
        "stock": lambda: trade.stock_add(ch, mid, b.get("item"), b.get("qty", 1), b.get("price", 1)),
        "unstock": lambda: trade.stock_remove(ch, mid, b.get("item")),
        "extend": lambda: trade.extend(ch, mid, b.get("days", 1)),
        "collect": lambda: trade.collect(ch, mid),
        "close": lambda: trade.close(ch, mid),
        "buy": lambda: trade.buy(ch, mid, b.get("item"), b.get("qty", 1)),
    }
    if op not in ops:
        raise GameError("Nieznana akcja.")
    msg = ops[op]()
    return respond(ch, {"messages": [msg], "merchant": trade.view(trade.get(mid), ch["user_id"])})
