"""Walka turowa w stylu Pokémonów: w każdej turze gracz wybiera atak, czar,
przedmiot z torby albo ucieczkę; potem rusza potwór. Kolejność zależy od szybkości."""
import random
import time

from . import character as chm
from .character import GameError
from .db import content

ATTACKS = {
    "ciecie":    {"name": "Cięcie", "power": 1.0, "acc": 92, "vigor": 0, "desc": "Pewny, prosty cios."},
    "pchniecie": {"name": "Szybkie pchnięcie", "power": 0.65, "acc": 100, "vigor": 0, "priority": True,
                  "desc": "Słabsze, ale zawsze uderzasz pierwszy."},
    "potezny":   {"name": "Potężny cios", "power": 1.7, "acc": 70, "vigor": 6, "desc": "Zamach z całej siły. Łatwo chybić."},
    "finta":     {"name": "Finta", "power": 0.4, "acc": 95, "vigor": 3, "effect": "expose",
                  "desc": "Zwód, który odsłania wroga — jego obrona słabnie na 2 tury."},
}

SPELLS = {
    "zar":       {"name": "Żar Swaroga", "vigor": 8, "desc": "Strumień ognia. Bestie bojące się ognia płoną podwójnie."},
    "tchnienie": {"name": "Tchnienie Strzyboga", "vigor": 6, "desc": "Podmuch wichru — może ogłuszyć wroga na turę."},
    "tarcza":    {"name": "Tarcza Peruna", "vigor": 7, "desc": "Błyskawica otacza cię tarczą. Razi to, co boi się światła."},
    "peta":      {"name": "Pęta Welesa", "vigor": 9, "desc": "Korzenie oplatają wroga: słabsza obrona i rany co turę."},
    "szept":     {"name": "Szept Mokoszy", "vigor": 10, "desc": "Leczy rany i ułatwia ucieczkę."},
}

EFFECT_NAMES = {"bleed": "krwawienie", "poison": "zatrucie", "stun": "ogłuszenie", "weaken": "osłabienie",
                "drain": "wysysanie", "expose": "odsłonięcie", "bound": "pęta"}


def _default_moves(m):
    return [{"name": "Atak", "power": 1.0, "acc": 90}, {"name": "Wściekły atak", "power": 1.4, "acc": 72}]


def start_combat(ch, m, ctx=None, strength=1.0, reward=1.0):
    hp = int(round(m["hp"] * strength))
    ch["combat"] = {
        "monster": m["id"], "name": m["name"], "glyph": m.get("glyph", "☠"), "family": m.get("family", ""),
        "level": m.get("level", 1), "description": m.get("description", ""),
        "hp": hp, "max_hp": hp, "attack": m["attack"] * strength, "defense": m.get("defense", 0) * strength,
        "speed": m.get("speed", 5), "moves": m.get("moves") or _default_moves(m),
        "weaknesses": m.get("weaknesses") or [], "reward": reward, "flee_chance": m.get("flee_chance", 50),
        "turn": 1, "log": [{"who": "sys", "text": m.get("intro") or f"Na drodze staje {m['name']}."}],
        "ps": {}, "ms": {}, "oil": None, "flee_bonus": 0, "over": False, "result": None, "started": time.time(),
    }
    return ch["combat"]


def _log(cb, who, text, out):
    entry = {"who": who, "text": text}
    cb["log"].append(entry)
    cb["log"] = cb["log"][-14:]
    out.append(entry)


def _player_power(ch, d):
    weapon, _ = chm.equipment(ch["user_id"])
    watk = (weapon["effects"] or {}).get("attack", 0) if weapon else 0
    tags = (weapon["effects"] or {}).get("tags", []) if weapon else []
    return watk + d["stats"]["sila"] * 1.5 + ch["level"], tags, weapon


def _weak_mult(cb, tags, out, kind_tag=None):
    mult = 1.0
    notes = []
    if cb.get("oil") and cb["oil"]["family"] == cb["family"]:
        mult *= 1 + cb["oil"]["bonus"]
        notes.append("olej działa")
    for t in tags:
        if t in cb["weaknesses"]:
            mult *= 1.5
            notes.append(t)
    if kind_tag and kind_tag in cb["weaknesses"]:
        mult *= 1.6
        notes.append(kind_tag)
    return mult, notes


def _hit_monster(ch, cb, dmg, out, crit_chance=0.05, notes=()):
    mdef = cb["defense"] * (0.5 if cb["ms"].get("expose") or cb["ms"].get("bound") else 1.0)
    dmg = max(1, dmg - mdef * 0.8)
    if random.random() < crit_chance:
        dmg *= 1.5
        _log(cb, "sys", "Trafienie krytyczne!", out)
    if cb["ps"].get("weaken"):
        dmg *= 0.75
    dmg = int(round(dmg))
    cb["hp"] = max(0, cb["hp"] - dmg)
    if notes:
        _log(cb, "sys", "To bardzo skuteczne!", out)
    return dmg


def _player_turn(ch, cb, d, action, arg, out):
    c = content()
    uid = ch["user_id"]
    st = d["stats"]
    if action == "attack":
        a = ATTACKS[arg]
        ch["vigor"] -= a["vigor"]
        acc = max(25, min(99, a["acc"] + (st["zrecznosc"] - cb["speed"]) * 1.5))
        if random.random() * 100 > acc:
            _log(cb, "player", f"{a['name']} — chybiasz!", out)
            return
        base, tags, _ = _player_power(ch, d)
        mult, notes = _weak_mult(cb, tags, out)
        dmg = base * a["power"] * random.uniform(0.85, 1.05) * mult
        dmg = _hit_monster(ch, cb, dmg, out, 0.05 + st["percepcja"] * 0.006, notes)
        _log(cb, "player", f"{a['name']}: {cb['name']} traci {dmg} HP.", out)
        if a.get("effect") == "expose":
            cb["ms"]["expose"] = 2
            _log(cb, "sys", f"{cb['name']} odsłania się — jego obrona słabnie.", out)
    elif action == "spell":
        s = SPELLS[arg]
        ch["vigor"] -= s["vigor"]
        moc = st["moc"]
        if arg == "zar":
            mult, notes = _weak_mult(cb, [], out, "ogien")
            dmg = (6 + moc * 2.2) * random.uniform(0.9, 1.1) * mult
            dmg = _hit_monster(ch, cb, dmg + cb["defense"] * 0.4, out, 0.04, notes)
            _log(cb, "player", f"{s['name']}! Ogień liże potwora — {dmg} obrażeń.", out)
        elif arg == "tchnienie":
            dmg = _hit_monster(ch, cb, (3 + moc) * random.uniform(0.9, 1.1), out, 0)
            _log(cb, "player", f"{s['name']}! Wicher uderza ({dmg} obrażeń).", out)
            if random.random() * 100 < 45 + moc * 3:
                cb["ms"]["stun"] = 1
                _log(cb, "sys", f"{cb['name']} zatacza się ogłuszony!", out)
        elif arg == "tarcza":
            cb["ps"]["shield"] = int(10 + moc * 3)
            _log(cb, "player", f"{s['name']}! Otacza cię błękitna poświata (tarcza {cb['ps']['shield']}).", out)
            if "swiatlo" in cb["weaknesses"]:
                dmg = _hit_monster(ch, cb, moc * 1.8 + 4, out, 0, ["swiatlo"])
                _log(cb, "player", f"Światło parzy {cb['name']} — {dmg} obrażeń.", out)
        elif arg == "peta":
            cb["ms"]["bound"] = 3
            _log(cb, "player", f"{s['name']}! Korzenie oplatają {cb['name']}.", out)
        elif arg == "szept":
            heal = int(8 + moc * 3)
            ch["hp"] += heal
            cb["flee_bonus"] += 25
            cb["ps"].pop("bleed", None)
            _log(cb, "player", f"{s['name']}. Rany się zasklepiają (+{heal} HP).", out)
    elif action == "item":
        it = c["items"].get(arg)
        eff = (it or {}).get("effects") or {}
        if eff.get("throw"):
            th = eff["throw"]
            chm.remove_item(uid, arg, 1)
            mult = th.get("mult", 1) if cb["family"] in (th.get("family") or []) else 1.0
            dmg = _hit_monster(ch, cb, (th.get("dmg", 5) + st["moc"] * 0.5) * mult + cb["defense"] * 0.5, out, 0,
                               ["x"] if mult > 1 else [])
            _log(cb, "player", f"{th.get('text') or 'Rzucasz ' + it['name'] + '.'} ({dmg} obrażeń)", out)
            if th.get("effect") == "stun" and random.random() < 0.5:
                cb["ms"]["stun"] = 1
                _log(cb, "sys", f"{cb['name']} krztusi się i traci turę!", out)
        elif eff.get("oil"):
            chm.remove_item(uid, arg, 1)
            cb["oil"] = {"family": eff["oil"]["family"], "bonus": eff["oil"]["bonus"], "name": it["name"]}
            hit = " Potwór cofa się na sam zapach." if eff["oil"]["family"] == cb["family"] else ""
            _log(cb, "player", f"Nacierasz ostrze: {it['name']}.{hit}", out)
        else:
            msgs = chm.use_item(ch, arg, in_combat=True)
            _log(cb, "player", " ".join(msgs), out)
    elif action == "flee":
        chance = max(5, min(95, cb["flee_chance"] + (st["zrecznosc"] - cb["speed"]) * 3 + cb["flee_bonus"]))
        if random.random() * 100 < chance:
            cb["over"], cb["result"] = True, "fled"
            _log(cb, "player", "Uciekasz w gęstwinę. Serce wali jak młot, ale żyjesz.", out)
        else:
            cb["flee_bonus"] += 10
            _log(cb, "player", "Próbujesz uciec — potwór odcina ci drogę!", out)


def _monster_turn(ch, cb, d, out):
    if cb["ms"].get("stun"):
        cb["ms"].pop("stun")
        _log(cb, "monster", f"{cb['name']} nie może się ruszyć.", out)
        return
    move = random.choice(cb["moves"])
    st = d["stats"]
    acc = max(30, min(97, (move.get("acc") or 90) - (st["zrecznosc"] - cb["speed"]) * 1.0))
    verb = move.get("text") or f"używa: {move['name']}"
    if random.random() * 100 > acc:
        _log(cb, "monster", f"{cb['name']} — {move['name']}, ale robisz unik!", out)
        return
    power = move.get("power", 1.0)
    dmg = 0
    if power > 0:
        _, armor = chm.equipment(ch["user_id"])
        arm = (armor["effects"] or {}).get("armor", 0) if armor else 0
        dmg = cb["attack"] * power * random.uniform(0.85, 1.15) - (arm + st["odpornosc"] * 0.5)
        if cb["ms"].get("weaken_m"):
            dmg *= 0.8
        dmg = max(1, dmg)
        sh = cb["ps"].get("shield", 0)
        if sh:
            absorbed = min(sh, dmg)
            dmg -= absorbed
            cb["ps"]["shield"] = int(sh - absorbed)
            if cb["ps"]["shield"] <= 0:
                cb["ps"].pop("shield")
            _log(cb, "sys", f"Tarcza pochłania {int(absorbed)} obrażeń.", out)
        dmg = int(round(dmg))
        ch["hp"] -= dmg
        _log(cb, "monster", f"{cb['name']} {verb} — tracisz {dmg} HP.", out)
    else:
        _log(cb, "monster", f"{cb['name']} {verb}.", out)
    eff = move.get("effect")
    if eff == "bleed" and random.random() < 0.6:
        cb["ps"]["bleed"] = 3
        _log(cb, "sys", "Krwawisz!", out)
    elif eff == "poison" and random.random() < 0.7:
        ch["toxicity"] += 8
        cb["ps"]["poison"] = 2
        _log(cb, "sys", "Jad pali ci krew (+8 toksyczności).", out)
    elif eff == "stun" and random.random() < 0.45:
        cb["ps"]["stun"] = 1
        _log(cb, "sys", "Jesteś ogłuszony — stracisz następną turę!", out)
    elif eff == "drain" and dmg:
        heal = int(dmg * 0.5)
        cb["hp"] = min(cb["max_hp"], cb["hp"] + heal)
        _log(cb, "sys", f"{cb['name']} pije twoją siłę (+{heal} HP).", out)
    elif eff == "weaken":
        cb["ps"]["weaken"] = 2
        _log(cb, "sys", "Twoje ciosy słabną.", out)


def _end_of_turn(ch, cb, d, out):
    ps, ms = cb["ps"], cb["ms"]
    if ps.get("bleed"):
        dmg = max(1, int(cb["attack"] * 0.25))
        ch["hp"] -= dmg
        _log(cb, "sys", f"Krwawienie: −{dmg} HP.", out)
    if ps.get("poison"):
        dmg = max(1, int(cb["attack"] * 0.2))
        ch["hp"] -= dmg
        _log(cb, "sys", f"Trucizna: −{dmg} HP.", out)
    if ms.get("bound") and cb["hp"] > 0:
        dmg = max(1, int(d["stats"]["moc"] * 1.2))
        cb["hp"] = max(0, cb["hp"] - dmg)
        _log(cb, "sys", f"Pęta zaciskają się: {cb['name']} traci {dmg} HP.", out)
    for sdict in (ps, ms):
        for k in list(sdict.keys()):
            if k in ("bleed", "poison", "weaken", "expose", "bound"):
                sdict[k] -= 1
                if sdict[k] <= 0:
                    sdict.pop(k)
    cb["turn"] += 1


def _finish(ch, cb, out):
    c = content()
    uid = ch["user_id"]
    m = c["monsters"].get(cb["monster"], {})
    summary = {"result": cb["result"], "loot": [], "xp": 0, "coins": 0, "messages": []}
    if cb["result"] == "win":
        d = chm.derived(ch)
        luck = d["stats"]["percepcja"] * 0.02
        loot = chm.roll_loot(m.get("loot"), mult=1.0 if cb["reward"] < 1.5 else 1.5, luck=luck)
        summary["loot"] = chm.give_loot(uid, loot)
        xp = int(round((m.get("xp") or 10) * cb["reward"]))
        coins = int(round((m.get("coins") or 0) * cb["reward"] * random.uniform(0.5, 1.0)))
        ch["coins"] += coins
        summary["xp"], summary["coins"] = xp, coins
        summary["messages"] += chm.gain_xp(ch, xp)
        for ct in ch["contracts"]:
            if not ct.get("done") and ct.get("monster") == cb["monster"]:
                ct["done"] = True
                summary["messages"].append(f"Zlecenie wykonane: {ct['title']}. Odbierz nagrodę w strażnicy.")
                break
        _log(cb, "sys", f"{cb['name']} pada martwy. Zwycięstwo!", out)
        chm.journal(uid, "combat", f"Pokonałeś: {cb['name']}. +{xp} PD, +{coins} gr. {', '.join(summary['loot'])}")
    elif cb["result"] == "lose":
        lost = int(ch["coins"] * 0.15)
        ch["coins"] -= lost
        ch["hp"] = 1
        ch["vigor"] = 0
        summary["coins"] = -lost
        summary["messages"].append("Ciemność. Budzisz się w rowie, obdarty z części groszy. Ktoś cię opatrzył — nie wiesz kto.")
        _log(cb, "sys", "Padasz na ziemię…", out)
        chm.journal(uid, "combat", f"Pokonany przez: {cb['name']}. Straciłeś {lost} gr.")
    else:
        chm.journal(uid, "combat", f"Uciekłeś przed: {cb['name']}.")
    cb["summary"] = summary
    return summary


def act(ch, action, arg=None):
    cb = ch.get("combat")
    if not cb or cb.get("over"):
        raise GameError("Nie walczysz z nikim.")
    d = chm.derived(ch)
    # walidacja wyboru — błąd nie zużywa tury
    if action == "attack":
        if arg not in ATTACKS:
            raise GameError("Nieznany atak.")
        if ch["vigor"] < ATTACKS[arg]["vigor"]:
            raise GameError("Za mało wigoru na ten cios.")
    elif action == "spell":
        if arg not in SPELLS:
            raise GameError("Nieznany czar.")
        if ch["vigor"] < SPELLS[arg]["vigor"]:
            raise GameError("Za mało wigoru, by rzucić czar.")
    elif action == "item":
        it = content()["items"].get(arg)
        eff = (it or {}).get("effects") or {}
        if not it or not (it.get("usable") or eff.get("throw")) or eff.get("mutation"):
            raise GameError("Tego nie użyjesz w walce.")
        if chm.count(ch["user_id"], arg) < 1:
            raise GameError("Nie masz tego w torbie.")
    elif action != "flee":
        raise GameError("Nieznana akcja.")

    out = []
    # kolejność: przedmioty i ucieczka zawsze pierwsze, potem szybkie pchnięcie, potem szybkość
    player_first = action in ("item", "flee") or (action == "attack" and ATTACKS[arg].get("priority"))
    if not player_first:
        ps = d["stats"]["zrecznosc"] + random.uniform(-1.5, 1.5)
        player_first = ps >= cb["speed"]

    def player():
        if cb["ps"].get("stun"):
            cb["ps"].pop("stun")
            _log(cb, "player", "Wciąż kręci ci się w głowie — tracisz turę.", out)
            return
        _player_turn(ch, cb, d, action, arg, out)

    order = [player, lambda: _monster_turn(ch, cb, d, out)]
    if not player_first:
        order.reverse()
    for step in order:
        if cb["over"]:
            break
        step()
        if cb["hp"] <= 0:
            cb["over"], cb["result"] = True, "win"
        elif ch["hp"] <= 0:
            cb["over"], cb["result"] = True, "lose"
    if not cb["over"]:
        _end_of_turn(ch, cb, d, out)
        if cb["hp"] <= 0:
            cb["over"], cb["result"] = True, "win"
        elif ch["hp"] <= 0:
            cb["over"], cb["result"] = True, "lose"
    chm.clamp_vitals(ch)
    summary = None
    if cb["over"]:
        summary = _finish(ch, cb, out)
        if ch["hp"] <= 0:
            ch["hp"] = 1
        ch["combat"] = None
    return {"turn_log": out, "combat": cb, "summary": summary}


def combat_view(ch):
    """Stan walki do wyświetlenia + dostępne ruchy gracza."""
    cb = ch.get("combat")
    if not cb:
        return None
    c = content()
    inv = chm.inv_map(ch["user_id"])
    items = []
    for iid, q in inv.items():
        it = c["items"].get(iid)
        if not it:
            continue
        eff = it.get("effects") or {}
        if (it.get("usable") or eff.get("throw")) and not eff.get("mutation"):
            kind = "rzut" if eff.get("throw") else ("olej" if eff.get("oil") else it["category"])
            items.append({"id": iid, "name": it["name"], "glyph": it["glyph"], "qty": q, "kind": kind,
                          "description": it["description"]})
    return {
        **{k: cb[k] for k in ("monster", "name", "glyph", "family", "level", "description", "hp", "max_hp",
                              "turn", "log", "ps", "ms", "oil")},
        "attacks": [{"id": k, **v} for k, v in ATTACKS.items()],
        "spells": [{"id": k, **v} for k, v in SPELLS.items()],
        "items": items,
    }
