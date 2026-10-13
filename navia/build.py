"""Rozbudowa obozu/siedliska (okno budowy) i użycie postawionych budynków."""
import time

from . import camp as campm
from . import character as chm
from . import config
from . import crafting
from .character import GameError
from .db import content
from .world import dist_m


def _uses_view(ch, it, sid=None):
    items = content()["items"]
    inv = chm.inv_map(ch["user_id"])
    out = []
    t = time.time()
    for i, a in enumerate(it.get("uses") or []):
        cost = []
        for c in a.get("cost") or []:
            ci = items.get(c["item"], {})
            cost.append({"item": c["item"], "name": ci.get("name", c["item"]), "glyph": ci.get("glyph", "?"),
                         "qty": c.get("qty", 1), "have": inv.get(c["item"], 0)})
        gives = []
        if a.get("heal"):
            gives.append(f"+{a['heal']} zdrowia")
        if a.get("vigor"):
            gives.append(f"+{a['vigor']} wigoru")
        if a.get("toxicity"):
            gives.append(f"{'+' if a['toxicity'] > 0 else ''}{a['toxicity']} toksyn")
        if a.get("effect"):
            e = a["effect"]
            st = ", ".join(f"{'+' if v > 0 else ''}{v} {chm.STAT_NAMES.get(k, k)}" for k, v in (e.get("stats") or {}).items())
            gives.append(f"{e.get('name')}: {st} na {e.get('minutes', 30)} min")
        for l in a.get("loot") or []:
            li = items.get(l["item"], {})
            mn, mx = l.get("min") or 1, l.get("max") or l.get("min") or 1
            q = f"{mn}" if mn == mx else f"{mn}–{mx}"
            ch_ = l.get("chance", 1)
            gives.append(f"{li.get('glyph', '')} {li.get('name', l['item'])} ×{q}" + ("" if ch_ >= 1 else f" ({round(ch_ * 100)}%)"))
        left = 0
        if sid is not None:
            left = max(0, int((ch.get("cooldowns") or {}).get(f"struct:{sid}:{i}", 0) - t))
        out.append({"index": i, "label": a.get("label", "Użyj"), "glyph": a.get("glyph", "✦"), "text": a.get("text", ""),
                    "cost": cost, "gives": gives, "cooldown_s": a.get("cooldown_s") or 0, "cooldown_left": left,
                    "wear": a.get("wear") or 0,
                    "can_pay": all(c["have"] >= c["qty"] for c in cost)})
    return out


def _tool_for(item_id):
    """Receptury, w których ten budynek jest narzędziem albo pomocą (nazwy, do podglądu)."""
    out = []
    for r in content()["recipes"].values():
        if not r.get("enabled", 1):
            continue
        cats = {c["item"]: c for c in r.get("catalysts") or []}
        if item_id in (r.get("tools") or []):
            out.append({"id": r["id"], "name": r["name"], "as": "narzędzie"})
        elif item_id in cats:
            out.append({"id": r["id"], "name": r["name"], "as": f"pomoc +{cats[item_id]['bonus']}%"})
    return out


def _teachers(recipe_id):
    c = content()
    return [bt["name"] for bt in c["building_types"].values()
            if any(t.get("recipe") == recipe_id for t in bt.get("teaches") or [])]


def buildables(ch, ctx, where):
    """Wszystkie budynki, które można postawić, z podglądem jak w Księdze receptur."""
    c = content()
    items = c["items"]
    inv = chm.inv_map(ch["user_id"])
    ws = crafting.Workshop(ch, ctx)
    known = crafting.known_recipe_ids(ch["user_id"])
    site = campm.site_view(ch, where)
    placed = {}
    for s in (site or {}).get("structures", []):
        placed[s["item_id"]] = placed.get(s["item_id"], 0) + 1
    out = []
    for iid, it in items.items():
        if not it.get("placeable"):
            continue
        recipes = [r for r in c["recipes"].values() if r.get("result_item") == iid and r.get("enabled", 1)]
        rk = [r for r in recipes if r["id"] in known]
        ev = crafting.evaluate(ch, rk[0], ws) if rk else None
        unknown = None
        if not rk and recipes:
            unknown = {"name": recipes[0]["name"], "where": _teachers(recipes[0]["id"]), "min_level": recipes[0].get("min_level", 1)}
        out.append({
            "item": iid, "name": it["name"], "glyph": it["glyph"], "description": it["description"],
            "rarity": it["rarity"], "in_bag": inv.get(iid, 0), "placed": placed.get(iid, 0),
            "radius": it.get("area_radius") or config.STRUCTURE_RADIUS_M,
            "max_durability": it.get("max_durability") or 0, "decay_per_hour": it.get("decay_per_hour") or 0,
            "tool_bonus": it.get("tool_bonus") or 0,
            "repair_cost": [{"item": r["item"], "qty": r["qty"], "name": items.get(r["item"], {}).get("name", r["item"]),
                             "glyph": items.get(r["item"], {}).get("glyph", "?")} for r in it.get("repair_cost") or []],
            "uses": _uses_view(ch, it), "tool_for": _tool_for(iid),
            "recipe": ev, "unknown": unknown,
        })
    rank = lambda b: (0 if b["in_bag"] else 1 if b["recipe"] and b["recipe"]["can"] else 2 if b["recipe"] else 3, b["name"])
    out.sort(key=rank)
    return {"where": where, "site": site and {"name": site["name"], "lat": site["lat"], "lng": site["lng"]},
            "build_reach": config.BUILD_REACH_M, "spread": config.SITE_MAX_SPREAD_M, "buildings": out}


def build(ch, ctx, where, recipe_id, lat=None, lng=None, catalysts=None):
    """Wytwarza budynek z receptury i od razu stawia go w obozie/siedlisku (gdy się uda)."""
    r = content()["recipes"].get(recipe_id)
    if not r:
        raise GameError("Nie ma takiej receptury.")
    it = content()["items"].get(r.get("result_item"), {})
    if not it.get("placeable"):
        raise GameError("Z tej receptury nie powstaje budynek.")
    campm.check_place(ch, where, lat, lng)  # najpierw miejsce — żeby nie zużyć składników na próżno
    res = crafting.craft(ch, ctx, recipe_id, catalysts)
    if res["success"]:
        msg = campm.place_structure(ch, r["result_item"], where, lat, lng)
        res["messages"] = [msg] + res["messages"]
        res["placed"] = True
    return res


# --------------------------------------------------------------------------- użycie budynków
def _find_struct(ch, sid):
    for s in campm.reachable_structures(ch):
        if s["id"] == sid:
            return s
    return None


def structure_detail(ch, ctx, sid):
    from .db import query
    s = query("SELECT * FROM structures WHERE id=?", (sid,), one=True)
    if not s:
        raise GameError("Nie ma takiego budynku.")
    allowed = [ch["user_id"]] + campm.guest_of(ch["user_id"])
    if s["owner_id"] not in allowed or (s["site"] == "camp" and s["owner_id"] != ch["user_id"]):
        raise GameError("To nie twój budynek.")
    near = _find_struct(ch, sid)
    if s["site"] == "camp":
        c = campm.my_camp(s["owner_id"])
        center = (c["lat"], c["lng"]) if c else (s["lat"], s["lng"])
        _, structs = campm.geometry(center[0], center[1], campm.camp_structs(s["camp_id"]))
    else:
        r = query("SELECT home_lat, home_lng FROM characters WHERE user_id=?", (s["owner_id"],), one=True)
        _, structs = campm.geometry(r["home_lat"], r["home_lng"], campm.base_structs(s["owner_id"]))
    s = next((x for x in structs if x["id"] == sid), s)
    view = campm.structure_view(s)
    it = content()["items"].get(s["item_id"], {})
    items = content()["items"]
    view.update({
        "description": it.get("description", ""), "tool_bonus": it.get("tool_bonus") or 0,
        "repair_cost": [{"item": r["item"], "qty": r["qty"], "name": items.get(r["item"], {}).get("name", r["item"]),
                         "glyph": items.get(r["item"], {}).get("glyph", "?"),
                         "have": chm.count(ch["user_id"], r["item"])} for r in it.get("repair_cost") or []],
        "uses": _uses_view(ch, it, sid),
        "in_reach": bool(near), "dist": round(dist_m(ch["lat"], ch["lng"], s["lat"], s["lng"])),
        "own": s["owner_id"] == ch["user_id"],
    })
    book = crafting.recipe_book(ch, ctx)
    view["recipes"] = [r for r in book if s["item_id"] in [t["item"] for t in r["tools"]]
                       or s["item_id"] in [c["item"] for c in r["catalysts"]]]
    return view


def use_structure(ch, sid, index):
    s = _find_struct(ch, sid)
    if not s:
        raise GameError("Stań w zasięgu tego budynku (albo w połączonym z nim obszarze).")
    if s["dur"] <= 0:
        raise GameError("Budynek jest zniszczony — najpierw go napraw.")
    it = content()["items"].get(s["item_id"], {})
    uses = it.get("uses") or []
    index = int(index)
    if not 0 <= index < len(uses):
        raise GameError("Ten budynek tego nie potrafi.")
    a = uses[index]
    uid = ch["user_id"]
    items = content()["items"]
    for c in a.get("cost") or []:
        if chm.count(uid, c["item"]) < c.get("qty", 1):
            raise GameError(f"Potrzebujesz: {items.get(c['item'], {}).get('name', c['item'])} ×{c.get('qty', 1)}.")
    if a.get("cooldown_s"):
        chm.check_cooldown(ch, f"struct:{sid}:{index}", a["cooldown_s"])
    for c in a.get("cost") or []:
        chm.remove_item(uid, c["item"], c.get("qty", 1))
    msgs = []
    if a.get("heal"):
        ch["hp"] += a["heal"]
        msgs.append(f"+{a['heal']} zdrowia")
    if a.get("vigor"):
        ch["vigor"] += a["vigor"]
        msgs.append(f"+{a['vigor']} wigoru")
    if a.get("toxicity"):
        ch["toxicity"] = max(0, ch["toxicity"] + a["toxicity"])
        msgs.append(f"{'+' if a['toxicity'] > 0 else ''}{a['toxicity']} toksyn")
    if a.get("effect"):
        e = a["effect"]
        chm.add_effect(ch, e["name"], e.get("stats", {}), e.get("minutes", 30))
        msgs.append(f"Efekt: {e['name']} ({e.get('minutes', 30)} min)")
    if a.get("loot"):
        got = chm.give_loot(uid, chm.roll_loot(a["loot"]))
        msgs += got or ["Tym razem nic."]
    if a.get("xp"):
        msgs += chm.gain_xp(ch, a["xp"])
    if a.get("wear"):
        campm.wear_structure(s, a["wear"])
    chm.clamp_vitals(ch)
    return {"text": a.get("text") or f"{a.get('label', 'Użyto')}.", "messages": msgs}
