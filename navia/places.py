"""Budynki na mapie (karczma, klasztor, kuźnia…) oraz zbieranie surowców z terenu."""
import random
import time
from datetime import date

from . import config
from . import character as chm
from .character import GameError
from .db import content, execute, query
from .world import dist_m, get_place, places_around


# --------------------------------------------------------------------------- zbieranie
def gather_available(ch, ctx):
    c = content()
    inv = chm.inv_map(ch["user_id"])
    out = []
    for g in c["gather_actions"].values():
        if not g.get("enabled", 1):
            continue
        t = g.get("terrain") or "*"
        if t == "*":
            ok = True
        elif t.startswith("power:"):
            ok = t.split(":", 1)[1] in ctx["power_infl"]
        else:
            ok = t in ctx["terrains"]
        if not ok:
            continue
        tool = g.get("tool")
        out.append({"id": g["id"], "name": g["name"], "tool": tool,
                    "tool_name": c["items"].get(tool, {}).get("name") if tool else None,
                    "has_tool": (not tool) or inv.get(tool, 0) > 0, "vigor": g.get("vigor_cost", 3),
                    "cooldown_left": max(0, int(ch["cooldowns"].get("g:" + g["id"], 0) - time.time()))})
    out.sort(key=lambda x: (x["id"] == "g_kamienie", x["name"]))
    return out


def gather(ch, ctx, gid):
    if ch.get("combat"):
        raise GameError("Najpierw dokończ walkę.")
    g = content()["gather_actions"].get(gid)
    avail = {a["id"]: a for a in gather_available(ch, ctx)}
    if not g or gid not in avail:
        raise GameError("Tutaj tego nie zrobisz.")
    if not avail[gid]["has_tool"]:
        raise GameError(f"Potrzebujesz narzędzia: {avail[gid]['tool_name']}.")
    if ch["vigor"] < (g.get("vigor_cost") or 0):
        raise GameError("Brak ci sił. Odpocznij albo wypij coś wzmacniającego.")
    chm.check_cooldown(ch, "g:" + gid, g.get("cooldown_s") or 20)
    ch["vigor"] -= g.get("vigor_cost") or 0
    st = chm.effective_stats(ch, ctx)
    t = g.get("terrain") or "*"
    infl = ctx["terrains"].get(t, 1.0) if t in ctx["terrains"] else 1.0
    loot = chm.roll_loot(g.get("loot"), mult=1.0 if infl < 0.85 else 1.3, luck=st["percepcja"] * 0.015)
    got = chm.give_loot(ch["user_id"], loot)
    xp_msgs = chm.gain_xp(ch, 2 if got else 1)
    return {"text": g.get("text") or g["name"], "loot": got or ["Nic nie znajdujesz."], "messages": xp_msgs}


# --------------------------------------------------------------------------- budynki
def _building(ch, pid):
    p = get_place(pid)
    if not p or p.get("layer") != "building":
        raise GameError("Nie ma tu takiego miejsca.")
    d = dist_m(ch["lat"], ch["lng"], p["lat"], p["lng"])
    if d > config.INTERACT_RADIUS_M + 5:
        raise GameError(f"Jesteś za daleko ({int(d)} m). Podejdź bliżej niż {config.INTERACT_RADIUS_M} m.")
    bt = content()["building_types"].get(p["kind"])
    if not bt:
        raise GameError("Nieznany rodzaj budynku.")
    return p, bt


def _contracts_for(pid):
    c = content()
    rng = random.Random(f"{config.WORLD_SEED}:{pid}:{date.today().isoformat()}")
    monsters = sorted(c["monsters"].values(), key=lambda m: m["id"])
    if not monsters:
        return []
    out = []
    for i in range(3):
        m = rng.choice(monsters)
        lvl = m.get("level", 1)
        out.append({"id": f"{pid}:{date.today().isoformat()}:{i}", "monster": m["id"],
                    "title": f"Ubij: {m['name']}", "level": lvl,
                    "text": rng.choice([
                        f"Sołtys płaci za łeb stwora, co nachodzi okolicę. Mówią, że to {m['name'].lower()}.",
                        f"Wdowa po młynarzu szuka kogoś, kto pomści męża. Ślady wskazują na: {m['name'].lower()}.",
                        f"Kupcy boją się jeździć traktem. Ktoś musi się rozprawić z bestią ({m['name'].lower()}).",
                        f"Pastuch widział coś w nocy. Opis pasuje do: {m['name'].lower()}.",
                    ]),
                    "reward": 25 + lvl * 20, "xp": 30 + lvl * 15})
    return out


def market_stock(pid, action):
    """Dzienny asortyment targowiska — każdego dnia inni kupcy, inne towary i ceny."""
    c = content()
    rng = random.Random(f"{config.WORLD_SEED}:targ:{pid}:{date.today().isoformat()}")
    pool = sorted([i for i in c["items"].values()
                   if (i.get("value") or 0) > 0 and i["category"] not in ("konstrukcja",)
                   and (i["rarity"] != "legendarny" or rng.random() < 0.08)], key=lambda i: i["id"])
    rng.shuffle(pool)
    out = []
    for it in pool[:int(action.get("count", 12))]:
        price = max(2, int(round(it["value"] * rng.uniform(1.3, 2.2))))
        out.append({"item": it["id"], "name": it["name"], "glyph": it["glyph"], "price": price,
                    "description": it["description"], "rarity": it["rarity"],
                    "trader": rng.choice(["Kramarz", "Przekupka", "Handlarz z Rusi", "Kupiec z Gdańska",
                                          "Wędrowny handlarz", "Zielarz z gór", "Bursztyniarz", "Handlarz trofeami"])})
    out.sort(key=lambda x: x["name"])
    return out


def view(ch, pid):
    p, bt = _building(ch, pid)
    c = content()
    known = {r["recipe_id"] for r in query("SELECT recipe_id FROM known_recipes WHERE user_id=?", (ch["user_id"],))}
    shop = []
    for s in bt.get("shop") or []:
        it = c["items"].get(s["item"])
        if it:
            shop.append({"item": s["item"], "name": it["name"], "glyph": it["glyph"], "price": s["price"],
                         "description": it["description"], "rarity": it["rarity"]})
    teaches = []
    for t in bt.get("teaches") or []:
        r = c["recipes"].get(t["recipe"])
        if r:
            teaches.append({"recipe": r["id"], "name": r["name"], "price": t["price"], "known": r["id"] in known,
                            "min_level": r.get("min_level", 1), "description": r.get("description", "")})
    sell_rate = max([a.get("rate", 0.5) for a in bt.get("actions") or [] if a["type"] == "sell"] or [0])
    sellable = []
    if sell_rate:
        for row in chm.inventory(ch["user_id"]):
            it = c["items"].get(row["item_id"])
            if it and (it.get("value") or 0) > 0:
                sellable.append({"item": it["id"], "name": it["name"], "glyph": it["glyph"], "qty": row["qty"],
                                 "price": max(1, int(it["value"] * sell_rate))})
    contracts = None
    if any(a["type"] == "contracts" for a in bt.get("actions") or []):
        taken = {ct["id"]: ct for ct in ch["contracts"]}
        contracts = []
        for ct in _contracts_for(pid):
            ct["taken"] = ct["id"] in taken
            ct["done"] = taken.get(ct["id"], {}).get("done", False)
            ct["claimed"] = taken.get(ct["id"], {}).get("claimed", False)
            contracts.append(ct)
        for ct in ch["contracts"]:  # zlecenia z innych strażnic, gotowe do odebrania
            if ct.get("done") and not ct.get("claimed") and not any(x["id"] == ct["id"] for x in contracts):
                contracts.append({**ct, "taken": True})
    market = None
    for a in bt.get("actions") or []:
        if a["type"] == "market":
            market = market_stock(pid, a)
    from .trade import merchants_near
    stalls = merchants_near(p["lat"], p["lng"], 250, viewer_id=ch["user_id"])
    actions = []
    for i, a in enumerate(bt.get("actions") or []):
        actions.append({"index": i, **a})
    return {"id": pid, "name": p.get("name") or bt["name"], "kind": bt["id"], "kind_name": bt["name"],
            "glyph": bt["glyph"], "description": bt["description"], "actions": actions, "shop": shop,
            "teaches": teaches, "sellable": sellable, "sell_rate": sell_rate, "contracts": contracts,
            "market": market, "stalls": stalls}


def rumors(ch, ctx):
    from .explore import probabilities
    c = content()
    pl = places_around(ch["lat"], ch["lng"], cells=3)
    lines = []
    pw = sorted(pl["power"], key=lambda p: dist_m(ch["lat"], ch["lng"], p["lat"], p["lng"]))[:4]
    for p in pw:
        d = dist_m(ch["lat"], ch["lng"], p["lat"], p["lng"])
        kind = c["power_kinds"].get(p["kind"], {})
        lines.append(f"„{p.get('name') or kind.get('name')}” — jakieś {int(d // 50 * 50 + 50)} kroków stąd. {kind.get('description', '')}")
    probs = [x for x in probabilities(ctx["terrains"], ctx["power_infl"], ctx["night"], ch["level"]) if x["kind"] == "monster"][:3]
    if probs:
        lines.append("W okolicy widziano: " + ", ".join(f"{x['label']} ({x['pct']}%)" for x in probs) + ".")
    return lines or ["Nikt nic nie słyszał. Podejrzanie spokojnie."]


def act(ch, ctx, pid, index, payload):
    from .combat import start_combat
    p, bt = _building(ch, pid)
    acts = bt.get("actions") or []
    payload = payload or {}
    if index is None or not (0 <= int(index) < len(acts)):
        raise GameError("Nieznana akcja.")
    a = acts[int(index)]
    c = content()
    uid = ch["user_id"]
    typ = a["type"]
    res = {"text": "", "messages": [], "combat": None}

    def pay(cost):
        if ch["coins"] < cost:
            raise GameError(f"Brakuje ci pieniędzy (masz {chm.money(ch['coins'])}, potrzeba {chm.money(cost)}).")
        ch["coins"] -= cost

    if typ == "rest":
        pay(a.get("cost", 5))
        d = chm.derived(ch)
        ch["hp"], ch["vigor"] = d["max_hp"], d["max_vigor"]
        ch["toxicity"] = max(0, ch["toxicity"] - 30)
        res["text"] = "Śpisz jak kamień. Budzisz się wypoczęty, choć śniło ci się coś, czego wolisz nie pamiętać."
    elif typ == "cleanse":
        pay(a.get("cost", 10))
        ch["toxicity"] = 0
        res["text"] = "Gorzkie zioła, modlitwa i upust krwi. Toksyny opuszczają twoje ciało."
    elif typ == "pray":
        if a.get("item"):
            chm.remove_item(uid, a["item"], 1)
        if a.get("cost"):
            pay(a["cost"])
        e = a.get("effect") or {}
        if e:
            chm.add_effect(ch, e["name"], e.get("stats", {}), e.get("minutes", 30))
        res["text"] = a.get("text") or "Twoja ofiara została przyjęta."
        res["messages"].append(f"Efekt: {e.get('name', '')}")
    elif typ == "rumors":
        res["text"] = "Pochylasz się nad stołem i słuchasz."
        res["messages"] = rumors(ch, ctx)
    elif typ == "bestiary":
        res["text"] = "Skryba podsuwa ci opasły bestiariusz."
        res["bestiary"] = [{"name": m["name"], "glyph": m["glyph"], "level": m["level"], "family": m["family"],
                            "lore": m["lore"], "weaknesses": m["weaknesses"]} for m in
                           sorted(c["monsters"].values(), key=lambda m: m["level"])]
    elif typ == "shop":
        item, qty = payload.get("item"), max(1, int(payload.get("qty", 1)))
        entry = next((s for s in bt.get("shop") or [] if s["item"] == item), None)
        if not entry:
            raise GameError("Tego tu nie sprzedają.")
        pay(entry["price"] * qty)
        chm.add_item(uid, item, qty)
        res["text"] = f"Kupujesz: {c['items'][item]['name']} ×{qty} za {chm.money(entry['price'] * qty)}."
    elif typ == "market":
        item, qty = payload.get("item"), max(1, int(payload.get("qty", 1)))
        entry = next((s for s in market_stock(pid, a) if s["item"] == item), None)
        if not entry:
            raise GameError("Dziś nikt na targu tego nie ma.")
        pay(entry["price"] * qty)
        chm.add_item(uid, item, qty)
        res["text"] = f"{entry['trader']} zawija ci w płótno: {c['items'][item]['name']} ×{qty}."
    elif typ == "sell":
        item, qty = payload.get("item"), max(1, int(payload.get("qty", 1)))
        it = c["items"].get(item)
        if not it:
            raise GameError("Nieznany przedmiot.")
        chm.remove_item(uid, item, qty)
        price = max(1, int((it.get("value") or 0) * a.get("rate", 0.5))) * qty
        ch["coins"] += price
        res["text"] = f"Sprzedajesz {it['name']} ×{qty} za {chm.money(price)}."
    elif typ == "learn":
        rid = payload.get("recipe")
        entry = next((t for t in bt.get("teaches") or [] if t["recipe"] == rid), None)
        if not entry:
            raise GameError("Tu tego nie nauczą.")
        r = c["recipes"].get(rid)
        if ch["level"] < (r.get("min_level") or 1):
            raise GameError(f"Ta wiedza jest dla ciebie za trudna (poziom {r['min_level']}).")
        if query("SELECT 1 FROM known_recipes WHERE user_id=? AND recipe_id=?", (uid, rid), one=True):
            raise GameError("Znasz już tę recepturę.")
        pay(entry["price"])
        execute("INSERT OR IGNORE INTO known_recipes(user_id, recipe_id) VALUES (?,?)", (uid, rid))
        res["text"] = f"Zapisujesz w notatniku nową recepturę: {r['name']}."
        chm.journal(uid, "learn", f"Poznałeś recepturę: {r['name']}.")
    elif typ == "search":
        tool = a.get("tool")
        if tool and chm.count(uid, tool) < 1:
            raise GameError(f"Potrzebujesz: {c['items'].get(tool, {}).get('name', tool)}.")
        if ch["vigor"] < a.get("vigor", 5):
            raise GameError("Brak ci sił.")
        chm.check_cooldown(ch, f"s:{pid}:{index}", a.get("cooldown", 90))
        ch["vigor"] -= a.get("vigor", 5)
        mons = [c["monsters"][m] for m in a.get("monsters") or [] if m in c["monsters"]]
        mons = [m for m in mons if m["level"] <= ch["level"] + 3] or mons
        if mons and random.random() < a.get("risk", 0.3):
            m = random.choice(mons)
            res["text"] = m.get("intro") or f"Coś się porusza w ciemności — {m['name']}!"
            res["combat"] = start_combat(ch, m, ctx)
        else:
            st = chm.effective_stats(ch, ctx)
            got = chm.give_loot(uid, chm.roll_loot(bt.get("search_loot"), luck=st["percepcja"] * 0.02))
            res["text"] = "Przeszukujesz każdy kąt." if got else "Kurz, pajęczyny i nic więcej."
            res["messages"] = got
            res["messages"] += chm.gain_xp(ch, 4)
    elif typ == "contracts":
        cid, op = payload.get("contract"), payload.get("op", "take")
        if op == "take":
            ct = next((x for x in _contracts_for(pid) if x["id"] == cid), None)
            if not ct:
                raise GameError("Tego zlecenia już nie ma na tablicy.")
            if any(x["id"] == cid for x in ch["contracts"]):
                raise GameError("Już je przyjąłeś.")
            if len([x for x in ch["contracts"] if not x.get("claimed")]) >= 5:
                raise GameError("Masz już pięć niewykonanych zleceń.")
            ch["contracts"].append({**ct, "done": False, "claimed": False})
            res["text"] = f"Zrywasz kartkę z tablicy: {ct['title']}."
        elif op == "claim":
            ct = next((x for x in ch["contracts"] if x["id"] == cid), None)
            if not ct or not ct.get("done") or ct.get("claimed"):
                raise GameError("Nie ma tu nic do odebrania.")
            ct["claimed"] = True
            ch["coins"] += ct["reward"]
            res["text"] = f"Kapitan straży odlicza {chm.money(ct['reward'])}. „Dobra robota, łowco.”"
            res["messages"] += chm.gain_xp(ch, ct["xp"])
        ch["contracts"] = [x for x in ch["contracts"] if not x.get("claimed")][-10:] + \
                          [x for x in ch["contracts"] if x.get("claimed")][-5:]
    elif typ == "craft":
        res["text"] = "Kowal kiwa głową na kowadło: „Bierz, co trzeba”. Otwórz księgę receptur — kuźnia działa jak warsztat."
    else:
        raise GameError("Tej akcji jeszcze nie ma.")
    chm.clamp_vitals(ch)
    return res
