"""Eksploracja: procentowe losowanie zdarzeń z puli zależnie od terenu,
punktów mocy, pory dnia, poziomu postaci i wybranego trybu (łatwy…specjalny)."""
import math
import random

from . import config
from . import character as chm
from .character import GameError
from .db import content


def event_weight(ev, terrains, power_infl, night, level, mode):
    if not ev.get("enabled", 1):
        return 0.0
    if level < (ev.get("min_level") or 1) or level > (ev.get("max_level") or 99):
        return 0.0
    w = float(ev.get("base_weight") or 0)
    if w <= 0:
        return 0.0
    # teren: najsilniej działający teren z listy modyfikatorów, reszta → other_terrain
    tm = ev.get("terrain_mods") or {}
    best = None
    for t, infl in terrains.items():
        if t in tm:
            m = 1 + (float(tm[t]) - 1) * infl
            best = m if best is None else max(best, m)
    w *= best if best is not None else float(ev.get("other_terrain", 1) if ev.get("other_terrain") is not None else 1)
    # punkty mocy: im bliżej, tym mocniej
    pm = ev.get("power_mods") or {}
    for kind, infl in power_infl.items():
        if kind in pm:
            w *= 1 + (float(pm[kind]) - 1) * min(1.5, infl)
    w *= float(ev.get("night_mult", 1)) if night else float(ev.get("day_mult", 1))
    # tryb eksploracji
    if ev.get("kind") == "monster":
        w *= mode["monster"]
    if (ev.get("base_weight") or 0) < 2:
        w *= mode["rare"]
    return max(0.0, w)


def probabilities(terrains, power_infl, night, level, mode_id="normalny", percepcja=5):
    c = content()
    mode = config.EXPLORE_MODES.get(mode_id, config.EXPLORE_MODES["normalny"])
    rows = []
    for ev in c["events"].values():
        w = event_weight(ev, terrains, power_infl, night, level, mode)
        if ev.get("kind") == "item":
            w *= 1 + max(0, percepcja - 5) * 0.03
        if w > 0:
            rows.append((ev, w))
    total = sum(w for _, w in rows) or 1
    out = []
    for ev, w in sorted(rows, key=lambda x: -x[1]):
        label = ev["name"]
        if ev["kind"] == "monster":
            m = c["monsters"].get(ev.get("ref"))
            label = m["name"] if m else label
        elif ev["kind"] == "item":
            it = c["items"].get(ev.get("ref"))
            label = it["name"] if it else label
        out.append({"id": ev["id"], "name": ev["name"], "label": label, "kind": ev["kind"],
                    "pct": round(100 * w / total, 2), "weight": round(w, 3)})
    return out


def _range(v, default=(1, 1)):
    if isinstance(v, (list, tuple)) and len(v) == 2:
        return random.randint(int(v[0]), int(v[1]))
    if isinstance(v, (int, float)):
        return int(v)
    return random.randint(*default)


def apply_outcome(ch, out, mult=1.0):
    """Stosuje skutki zdarzenia (HP, monety, przedmioty, efekty...). Zwraca listę komunikatów i ewentualnego potwora."""
    msgs, monster = [], None
    uid = ch["user_id"]
    if out.get("hp"):
        v = _range(out["hp"])
        ch["hp"] += v
        msgs.append(f"{'+' if v > 0 else ''}{v} HP")
    if out.get("heal"):
        ch["hp"] += int(out["heal"])
        msgs.append(f"+{int(out['heal'])} HP")
    if out.get("vigor"):
        v = _range(out["vigor"])
        ch["vigor"] += v
        msgs.append(f"{'+' if v > 0 else ''}{v} wigoru")
    if out.get("toxicity"):
        v = _range(out["toxicity"])
        ch["toxicity"] += v
        msgs.append(f"{'+' if v > 0 else ''}{v} toksyczności")
    if out.get("coins"):
        v = _range(out["coins"])
        if v > 0:
            v = int(round(v * mult))
        v = max(-ch["coins"], v)
        ch["coins"] += v
        if v:
            msgs.append(f"{'+' if v > 0 else ''}{chm.money(v)}")
    for i in out.get("items") or []:
        if random.random() <= float(i.get("chance", 1)):
            q = max(1, int(round(_range(i.get("qty", 1)) * mult)))
            msgs += chm.give_loot(uid, [(i["item"], q)])
    if out.get("effect"):
        e = out["effect"]
        chm.add_effect(ch, e["name"], e.get("stats", {}), e.get("minutes", 30))
        msgs.append(f"Efekt: {e['name']}")
    if out.get("xp"):
        xp = int(round(int(out["xp"]) * mult))
        msgs.append(f"+{xp} doświadczenia")
        msgs += chm.gain_xp(ch, xp)
    if out.get("monster"):
        monster = out["monster"]
    chm.clamp_vitals(ch)
    if ch["hp"] <= 0:
        ch["hp"] = 1
    return msgs, monster


def explore(ch, ctx, mode_id):
    from .combat import start_combat
    if ch.get("combat"):
        raise GameError("Najpierw dokończ walkę.")
    mode = config.EXPLORE_MODES.get(mode_id)
    if not mode:
        raise GameError("Nieznany tryb eksploracji.")
    if ch["energy"] < mode["cost"]:
        raise GameError(f"Za mało energii ({int(ch['energy'])}/{mode['cost']}). Odnawia się {config.ENERGY_PER_HOUR} pkt na godzinę.")
    chm.check_cooldown(ch, "explore", config.EXPLORE_COOLDOWN_S)
    d = chm.derived(ch, ctx)
    probs = probabilities(ctx["terrains"], ctx["power_infl"], ctx["night"], ch["level"], mode_id, d["stats"]["percepcja"])
    if not probs:
        raise GameError("Okolica milczy. (Pula zdarzeń jest pusta — dodaj zdarzenia w panelu admina.)")
    ch["energy"] -= mode["cost"]
    c = content()
    total = sum(p["weight"] for p in probs)
    x = random.random() * total
    chosen = probs[-1]
    for p in probs:
        x -= p["weight"]
        if x <= 0:
            chosen = p
            break
    ev = c["events"][chosen["id"]]
    result = {"event": {"id": ev["id"], "name": ev["name"], "kind": ev["kind"], "pct": chosen["pct"]},
              "mode": mode_id, "text": ev.get("text") or "", "messages": [], "combat": None}
    mult = mode["reward"]

    if ev["kind"] == "monster":
        m = c["monsters"].get(ev.get("ref"))
        if not m:
            raise GameError("Zdarzenie wskazuje na nieistniejącego potwora.")
        result["text"] = m.get("intro") or ev.get("text") or f"Na drodze staje {m['name']}."
        result["combat"] = start_combat(ch, m, ctx, strength=mode["strength"], reward=mult)
    elif ev["kind"] == "item":
        out = ev.get("outcome") or {}
        q = max(1, int(round(_range(out.get("qty", [1, 1])) * mult)))
        result["messages"] += chm.give_loot(ch["user_id"], [(ev["ref"], q)])
        if out.get("xp"):
            result["messages"] += chm.gain_xp(ch, out["xp"])
    else:
        out = dict(ev.get("outcome") or {})
        branches = out.pop("branches", None)
        if branches:
            tot = sum(b.get("weight", 1) for b in branches)
            x = random.random() * tot
            br = branches[-1]
            for b in branches:
                x -= b.get("weight", 1)
                if x <= 0:
                    br = b
                    break
            if br.get("text"):
                result["text"] = (result["text"] + " " + br["text"]).strip()
            out = {**out, **br}
        msgs, monster = apply_outcome(ch, out, mult)
        result["messages"] += msgs
        if monster and monster in c["monsters"]:
            result["combat"] = start_combat(ch, c["monsters"][monster], ctx, strength=mode["strength"], reward=mult)
    chm.journal(ch["user_id"], "explore", f"[{mode['name']}] {ev['name']}: {result['text']}"[:500])
    return result


def influence(ch, ctx, what):
    """Jak wybrany element miejsca (teren, punkt mocy, noc) zmienia cechy i szanse zdarzeń.
    Porównujemy szanse „teraz” z szansami „gdyby tego elementu nie było”."""
    c = content()
    d = chm.derived(ch, ctx)
    perc, lvl = d["stats"]["percepcja"], ch["level"]
    terr, pinf, night = dict(ctx["terrains"]), dict(ctx["power_infl"]), ctx["night"]
    kind, _, ref = (what or "").partition(":")
    out = {"what": what, "title": "", "glyph": "", "color": None, "desc": "", "infl": None,
           "stats": {}, "changes": [], "gathers": [], "notes": []}

    def gathers_for(tkey):
        for g in c["gather_actions"].values():
            if g.get("enabled", 1) and (g.get("terrain") or "*") == tkey:
                tool = c["items"].get(g.get("tool") or "", {}).get("name")
                out["gathers"].append({"name": g["name"], "vigor": g.get("vigor_cost", 3), "tool": tool})

    if kind == "terrain":
        t = c["terrains"].get(ref, {})
        out.update(title=t.get("name", ref), glyph="■", color=t.get("color"), desc=t.get("description", ""),
                   infl=terr.get(ref))
        terr.pop(ref, None)
        if not terr:
            terr = {"trakt": 1.0}
        gathers_for(ref)
        if ref in ctx["terrains"] and ctx["terrains"][ref] < 1:
            out["notes"].append("Im głębiej w obszar, tym silniej działa (od 50% na skraju do 100% w środku).")
    elif kind == "power":
        p = next((x for x in ctx["powers"] if str(x["id"]) == ref or x["kind"] == ref), None)
        if not p:
            out["title"] = "Punkt mocy poza zasięgiem"
            return out
        pk = c["power_kinds"].get(p["kind"], {})
        infl = pinf.get(p["kind"], p["infl"])
        out.update(title=p.get("name") or pk.get("name", p["kind"]), glyph=pk.get("glyph", "✶"), color=pk.get("color"),
                   desc=pk.get("description", ""), infl=infl, kind_name=pk.get("name"), dist=p.get("dist"))
        out["stats"] = {s: round(v * infl, 2) for s, v in (pk.get("stat_mods") or {}).items()}
        pinf.pop(p["kind"], None)
        gathers_for("power:" + p["kind"])
        out["notes"].append(f"Siła działania {round(infl * 100)}% — rośnie, im bliżej środka (jesteś {p.get('dist')} m od niego).")
    elif kind == "night":
        out.update(title="Noc", glyph="☾", desc="Od zmierzchu do świtu upiory i nocne bestie wychodzą śmielej, a dzienne stworzenia się kryją.")
        night = not night
    else:
        out["title"] = "Nieznane"
        return out

    now = {p["id"]: p for p in probabilities(ctx["terrains"], ctx["power_infl"], ctx["night"], lvl, "normalny", perc)}
    base = {p["id"]: p for p in probabilities(terr, pinf, night, lvl, "normalny", perc)}
    rows = []
    for eid in set(now) | set(base):
        a, b = now.get(eid), base.get(eid)
        pa, pb = (a or {}).get("pct", 0), (b or {}).get("pct", 0)
        if max(pa, pb) < 0.3:
            continue
        ratio = (pa / pb) if pb else 99.0
        if 0.87 < ratio < 1.15:
            continue
        ref_row = a or b
        rows.append({"label": ref_row["label"], "kind": ref_row["kind"], "now": pa, "without": pb,
                     "ratio": round(ratio, 2) if pb else None})
    rows.sort(key=lambda r: -abs(math.log(max(0.01, r["ratio"] or 50))) - r["now"] / 100.0)
    out["changes"] = rows[:10]
    return out
