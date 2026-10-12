"""Crafting: receptury ze składnikami, narzędziami (w torbie lub postawionymi),
miejscem wykonania i szansą powodzenia, którą podnoszą alchemia, narzędzia i katalizatory."""
import random

from . import camp as campm
from . import character as chm
from .character import GameError
from .db import content, query

# Budynki działają jak warsztaty — udostępniają „wirtualne” narzędzia.
BUILDING_TOOLS = {
    "kuznia": ["kowadlo", "ognisko_kamienne"],
    "karczma": ["ognisko_kamienne", "kociol_alchemiczny"],
    "klasztor": ["alembik", "kociol_alchemiczny", "stol_zielarski"],
    "chata_zielarki": ["stol_zielarski", "suszarnia", "mozdzierz", "kociol_alchemiczny"],
    "gontyna": ["oltarzyk"],
}


def known_recipe_ids(user_id):
    return {r["recipe_id"] for r in query("SELECT recipe_id FROM known_recipes WHERE user_id=?", (user_id,))}


class Workshop:
    """Zbiera, co gracz ma pod ręką: torba, konstrukcje w zasięgu, budynki."""

    def __init__(self, ch, ctx):
        self.ch = ch
        self.ctx = ctx
        self.inv = chm.inv_map(ch["user_id"])
        self.site = campm.site_status(ch)
        self.structs = [s for s in campm.reachable_structures(ch, self.site) if s["dur"] > 0]
        self.building_kinds = {b["kind"] for b in ctx.get("buildings", [])}
        self.building_tools = set()
        for k in self.building_kinds:
            self.building_tools.update(BUILDING_TOOLS.get(k, []))

    def tool_source(self, item_id, mode="any"):
        """Zwraca ('bag'|'placed'|'building', struct) albo (None, None)."""
        if mode in ("any", "bag") and self.inv.get(item_id, 0) > 0:
            return "bag", None
        if mode in ("any", "placed"):
            for s in self.structs:
                if s["item_id"] == item_id:
                    return "placed", s
            if item_id in self.building_tools:
                return "building", None
        return None, None

    def station_ok(self, station):
        c = content()
        if not station or station == "any":
            return True, "Wszędzie"
        if station == "camp":
            ok = self.site["in_camp"] or self.site["at_base"] or bool(self.building_kinds & {"karczma", "klasztor", "chata_zielarki"})
            return ok, "Obóz, siedlisko lub warsztat"
        if station == "base":
            return self.site["at_base"], "Siedlisko"
        if station.startswith("building:"):
            k = station.split(":", 1)[1]
            return k in self.building_kinds, c["building_types"].get(k, {}).get("name", k)
        if station.startswith("power:"):
            k = station.split(":", 1)[1]
            return k in (self.ctx.get("power_infl") or {}), c["power_kinds"].get(k, {}).get("name", k)
        return False, station


def evaluate(ch, recipe, ws, selected=None):
    c = content()
    items = c["items"]
    selected = set(selected or [])
    stats = chm.effective_stats(ch, ws.ctx)
    missing = []
    ingredients = []
    for ing in recipe.get("ingredients") or []:
        have = ws.inv.get(ing["item"], 0)
        it = items.get(ing["item"], {})
        ingredients.append({"item": ing["item"], "name": it.get("name", ing["item"]), "glyph": it.get("glyph", "?"),
                            "qty": ing["qty"], "have": have})
        if have < ing["qty"]:
            missing.append(f"{it.get('name', ing['item'])} ({have}/{ing['qty']})")
    tools = []
    tool_bonus = 0.0
    mode = recipe.get("tool_mode") or "any"
    for t in recipe.get("tools") or []:
        src, _ = ws.tool_source(t, mode)
        it = items.get(t, {})
        tools.append({"item": t, "name": it.get("name", t), "glyph": it.get("glyph", "?"), "source": src})
        if src:
            tool_bonus += it.get("tool_bonus") or 0
        else:
            where = {"bag": "w torbie", "placed": "postawione w obozie/siedlisku"}.get(mode, "")
            missing.append(f"narzędzie: {it.get('name', t)} {where}".strip())
    st_ok, st_label = ws.station_ok(recipe.get("station"))
    if not st_ok:
        missing.append(f"miejsce: {st_label}")
    if ch["level"] < (recipe.get("min_level") or 1):
        missing.append(f"poziom {recipe['min_level']}")

    # katalizatory: z receptury + uniwersalne (catalyst_bonus w przedmiocie)
    cats = []
    seen = set()
    for cat in recipe.get("catalysts") or []:
        seen.add(cat["item"])
        it = items.get(cat["item"], {})
        if cat.get("tool"):
            src, _ = ws.tool_source(cat["item"], "any")
            cats.append({"item": cat["item"], "name": it.get("name", cat["item"]), "glyph": it.get("glyph", "?"),
                         "bonus": cat["bonus"], "tool": True, "have": bool(src), "selected": bool(src)})
        else:
            have = ws.inv.get(cat["item"], 0)
            cats.append({"item": cat["item"], "name": it.get("name", cat["item"]), "glyph": it.get("glyph", "?"),
                         "bonus": cat["bonus"], "tool": False, "have": have > 0,
                         "selected": cat["item"] in selected and have > 0})
    for iid, it in items.items():
        if (it.get("catalyst_bonus") or 0) > 0 and iid not in seen and ws.inv.get(iid, 0) > 0:
            cats.append({"item": iid, "name": it["name"], "glyph": it["glyph"], "bonus": it["catalyst_bonus"],
                         "tool": False, "have": True, "selected": iid in selected, "universal": True})

    skill = stats.get("alchemia", 0) * (recipe.get("skill_bonus") or 0)
    cat_bonus = sum(cc["bonus"] for cc in cats if cc["selected"])
    raw = (recipe.get("base_chance") or 50) + skill + tool_bonus + cat_bonus
    chance = max(3.0, min(97.0, raw))
    res = items.get(recipe.get("result_item"), {})
    return {
        "id": recipe["id"], "name": recipe["name"], "description": recipe.get("description", ""),
        "result": {"item": recipe.get("result_item"), "name": res.get("name", "?"), "glyph": res.get("glyph", "?"),
                   "qty": recipe.get("result_qty", 1), "description": res.get("description", "")},
        "ingredients": ingredients, "tools": tools, "tool_mode": mode, "catalysts": cats,
        "station": {"id": recipe.get("station") or "any", "label": st_label, "ok": st_ok},
        "chance": round(chance, 1),
        "breakdown": {"base": recipe.get("base_chance"), "alchemia": round(skill, 1),
                      "narzedzia": round(tool_bonus, 1), "katalizatory": round(cat_bonus, 1)},
        "missing": missing, "can": not missing, "min_level": recipe.get("min_level", 1),
    }


def recipe_book(ch, ctx):
    ws = Workshop(ch, ctx)
    known = known_recipe_ids(ch["user_id"])
    out = []
    for r in content()["recipes"].values():
        if r["id"] in known and r.get("enabled", 1):
            out.append(evaluate(ch, r, ws))
    out.sort(key=lambda e: (not e["can"], e["name"]))
    return out


def suggest(ch, ctx, item_ids):
    """Przeciągnięcie przedmiotu na przedmiot / użycie narzędzia → pasujące receptury."""
    ws = Workshop(ch, ctx)
    known = known_recipe_ids(ch["user_id"])
    item_ids = [i for i in item_ids if i]
    found, unknown = [], 0
    for r in content()["recipes"].values():
        if not r.get("enabled", 1):
            continue
        pool = {i["item"] for i in r.get("ingredients") or []} | set(r.get("tools") or []) | \
               {cc["item"] for cc in r.get("catalysts") or []}
        if all(i in pool for i in item_ids):
            if r["id"] in known:
                found.append(evaluate(ch, r, ws))
            else:
                unknown += 1
    found.sort(key=lambda e: (not e["can"], -e["chance"]))
    return {"recipes": found, "unknown": unknown}


def craft(ch, ctx, recipe_id, catalysts=None):
    r = content()["recipes"].get(recipe_id)
    if not r or not r.get("enabled", 1):
        raise GameError("Nie ma takiej receptury.")
    if recipe_id not in known_recipe_ids(ch["user_id"]):
        raise GameError("Nie znasz tej receptury.")
    ws = Workshop(ch, ctx)
    ev = evaluate(ch, r, ws, catalysts)
    if not ev["can"]:
        raise GameError("Brakuje: " + ", ".join(ev["missing"]))
    uid = ch["user_id"]
    for ing in r.get("ingredients") or []:
        chm.remove_item(uid, ing["item"], ing["qty"])
    for cc in ev["catalysts"]:
        if cc["selected"] and not cc["tool"]:
            chm.remove_item(uid, cc["item"], 1)
    # zużycie postawionych narzędzi
    for t in (r.get("tools") or []) + [cc["item"] for cc in ev["catalysts"] if cc["tool"] and cc["selected"]]:
        src, s = ws.tool_source(t, r.get("tool_mode") or "any")
        if src == "placed" and s:
            campm.wear_structure(s, 2)
    items = content()["items"]
    roll = random.random() * 100
    msgs = []
    if roll < ev["chance"]:
        chm.add_item(uid, r["result_item"], r.get("result_qty", 1))
        res = items.get(r["result_item"], {})
        text = f"Udało się! {res.get('glyph', '')} {res.get('name', '?')} ×{r.get('result_qty', 1)}"
        msgs += chm.gain_xp(ch, r.get("xp", 10))
        success = True
        chm.journal(uid, "craft", f"Wykonałeś: {res.get('name')} (szansa {ev['chance']}%).")
    else:
        text = "Nie wyszło. Wywar mętnieje, coś syczy, składniki przepadają."
        if r.get("fail_item") and r["fail_item"] in items:
            chm.add_item(uid, r["fail_item"], 1)
            text += f" Zostaje ci tylko: {items[r['fail_item']]['name']}."
        msgs += chm.gain_xp(ch, max(1, r.get("xp", 10) // 3))
        success = False
    return {"success": success, "text": text, "chance": ev["chance"], "roll": round(roll, 1), "messages": msgs}
