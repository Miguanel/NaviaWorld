"""Eksploracja: procentowe losowanie zdarzeń z puli zależnie od terenu,
punktów mocy, pory dnia, poziomu postaci i wybranego trybu (łatwy…specjalny)."""
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
            msgs.append(f"{'+' if v > 0 else ''}{v} groszy")
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
