"""Walka turowa w stylu Pokémonów: w każdej turze gracz wybiera atak, czar,
przedmiot z torby albo ucieczkę; potem rusza potwór. Kolejność zależy od szybkości.

Silniejsze ciosy i czary nie zużywają wigoru — mają odnowienie liczone w turach (cd).
Akcja "auto" wybiera ruch według planu gracza (lista priorytetów z warunkami)."""
import random
import time

from . import character as chm
from .character import GameError
from .db import content

# cd = odnowienie: po użyciu ruch jest niedostępny przez tyle następnych tur
ATTACKS = {
    "ciecie":    {"name": "Cięcie", "glyph": "⚔", "power": 1.0, "acc": 92, "cd": 0, "desc": "Pewny, prosty cios."},
    "pchniecie": {"name": "Szybkie pchnięcie", "glyph": "➶", "power": 0.65, "acc": 100, "cd": 0, "priority": True,
                  "desc": "Słabsze, ale zawsze uderzasz pierwszy."},
    "potezny":   {"name": "Potężny cios", "glyph": "🪓", "power": 1.7, "acc": 70, "cd": 2, "desc": "Zamach z całej siły. Łatwo chybić."},
    "finta":     {"name": "Finta", "glyph": "↺", "power": 0.4, "acc": 95, "cd": 3, "effect": "expose",
                  "desc": "Zwód, który odsłania wroga — jego obrona słabnie na 2 tury."},
}

SPELLS = {
    "zar":       {"name": "Żar Swaroga", "glyph": "🔥", "cd": 3, "desc": "Strumień ognia. Bestie bojące się ognia płoną mocniej."},
    "tchnienie": {"name": "Tchnienie Strzyboga", "glyph": "🌬", "cd": 3, "desc": "Podmuch wichru — może ogłuszyć wroga na turę."},
    "tarcza":    {"name": "Tarcza Peruna", "glyph": "⚡", "cd": 4, "desc": "Błyskawica otacza cię tarczą. Razi to, co boi się światła."},
    "peta":      {"name": "Pęta Welesa", "glyph": "🌿", "cd": 4, "desc": "Korzenie oplatają wroga: słabsza obrona i rany co turę."},
    "szept":     {"name": "Szept Mokoszy", "glyph": "✿", "cd": 5, "desc": "Leczy rany i ułatwia ucieczkę."},
}

# Domyślny plan auto-walki (od góry: pierwszy możliwy ruch wygrywa)
DEFAULT_PLAN = [
    {"t": "item", "id": "*heal", "hp_below": 35},
    {"t": "spell", "id": "szept", "hp_below": 40},
    {"t": "item", "id": "*oil"},
    {"t": "spell", "id": "peta"},
    {"t": "spell", "id": "zar"},
    {"t": "attack", "id": "finta"},
    {"t": "attack", "id": "potezny"},
    {"t": "attack", "id": "ciecie"},
]

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
        "ps": {}, "ms": {}, "cd": {}, "oil": None, "flee_bonus": 0, "over": False, "result": None, "started": time.time(),
    }
    return ch["combat"]


def _log(cb, who, text, out, detail=None):
    entry = {"who": who, "text": text}
    if detail:
        entry["detail"] = detail
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


def _mdef(cb):
    return cb["defense"] * (0.5 if cb["ms"].get("expose") or cb["ms"].get("bound") else 1.0) * 0.8


def _hit_monster(ch, cb, dmg, out, crit_chance=0.05, notes=()):
    """Zadaje obrażenia potworowi. Zwraca (obrażenia, opis rzutu do dziennika walki)."""
    raw = dmg
    armor = _mdef(cb)
    dmg = max(1, dmg - armor)
    crit = random.random() < crit_chance
    if crit:
        dmg *= 1.5
        _log(cb, "sys", "Trafienie krytyczne!", out)
    if cb["ps"].get("weaken"):
        dmg *= 0.75
    dmg = int(round(dmg))
    cb["hp"] = max(0, cb["hp"] - dmg)
    if notes:
        _log(cb, "sys", "To bardzo skuteczne!", out)
    info = [f"siła {raw:.0f}", f"pancerz −{armor:.0f}"]
    if crit:
        info.append("krytyk ×1,5")
    if cb["ps"].get("weaken"):
        info.append("osłabienie ×0,75")
    if notes:
        info.append("słabość: " + ", ".join(_note_name(n) for n in notes))
    info.append(f"zdrowie wroga {cb['hp']}/{cb['max_hp']}")
    return dmg, " · ".join(info)


def _note_name(n):
    it = content()["items"].get(n)
    return it["name"].lower() if it else {"ogien": "ogień", "swiatlo": "światło", "x": "celny rzut"}.get(n, n)


def _player_turn(ch, cb, d, action, arg, out):
    c = content()
    uid = ch["user_id"]
    st = d["stats"]
    if action == "attack":
        a = ATTACKS[arg]
        if a.get("cd"):
            cb["cd"][arg] = a["cd"] + 1
        acc = _acc(a, st, cb)
        if random.random() * 100 > acc:
            _log(cb, "player", f"{a['name']} — chybiasz!", out, f"szansa trafienia była {acc:.0f}%")
            return
        base, tags, _ = _player_power(ch, d)
        mult, notes = _weak_mult(cb, tags, out)
        dmg = base * a["power"] * random.uniform(0.85, 1.05) * mult
        dmg, info = _hit_monster(ch, cb, dmg, out, _crit(st), notes)
        _log(cb, "player", f"{a['name']}: {cb['name']} traci {dmg} HP.", out, f"trafienie {acc:.0f}% · {info}")
        if a.get("effect") == "expose":
            cb["ms"]["expose"] = 2
            _log(cb, "sys", f"{cb['name']} odsłania się — jego obrona słabnie.", out, "obrona wroga ×0,5 przez 2 tury")
    elif action == "spell":
        s = SPELLS[arg]
        cb["cd"][arg] = s["cd"] + 1
        moc = st["moc"]
        if arg == "zar":
            mult, notes = _weak_mult(cb, [], out, "ogien")
            dmg = (6 + moc * 2.2) * random.uniform(0.9, 1.1) * mult
            dmg, info = _hit_monster(ch, cb, dmg + cb["defense"] * 0.4, out, 0.04, notes)
            _log(cb, "player", f"{s['name']}! Ogień liże potwora — {dmg} obrażeń.", out, f"moc {moc} · {info}")
        elif arg == "tchnienie":
            dmg, info = _hit_monster(ch, cb, (3 + moc) * random.uniform(0.9, 1.1), out, 0)
            stun = min(95, 45 + moc * 3)
            _log(cb, "player", f"{s['name']}! Wicher uderza ({dmg} obrażeń).", out, f"ogłuszenie {stun}% · {info}")
            if random.random() * 100 < stun:
                cb["ms"]["stun"] = 1
                _log(cb, "sys", f"{cb['name']} zatacza się ogłuszony!", out)
        elif arg == "tarcza":
            cb["ps"]["shield"] = int(10 + moc * 3)
            _log(cb, "player", f"{s['name']}! Otacza cię błękitna poświata (tarcza {cb['ps']['shield']}).", out,
                 f"pochłonie {cb['ps']['shield']} obrażeń")
            if "swiatlo" in cb["weaknesses"]:
                dmg, info = _hit_monster(ch, cb, moc * 1.8 + 4, out, 0, ["swiatlo"])
                _log(cb, "player", f"Światło parzy {cb['name']} — {dmg} obrażeń.", out, info)
        elif arg == "peta":
            cb["ms"]["bound"] = 3
            _log(cb, "player", f"{s['name']}! Korzenie oplatają {cb['name']}.", out,
                 f"3 tury: obrona ×0,5, −{max(1, int(moc * 1.2))} HP co turę")
        elif arg == "szept":
            heal = int(8 + moc * 3)
            ch["hp"] += heal
            cb["flee_bonus"] += 25
            cb["ps"].pop("bleed", None)
            _log(cb, "player", f"{s['name']}. Rany się zasklepiają (+{heal} HP).", out, "ucieczka +25% · krwawienie ustaje")
    elif action == "item":
        it = c["items"].get(arg)
        eff = (it or {}).get("effects") or {}
        if eff.get("throw"):
            th = eff["throw"]
            chm.remove_item(uid, arg, 1)
            mult = th.get("mult", 1) if cb["family"] in (th.get("family") or []) else 1.0
            dmg, info = _hit_monster(ch, cb, (th.get("dmg", 5) + st["moc"] * 0.5) * mult + cb["defense"] * 0.5, out, 0,
                                     ["x"] if mult > 1 else [])
            _log(cb, "player", f"{th.get('text') or 'Rzucasz ' + it['name'] + '.'} ({dmg} obrażeń)", out, info)
            if th.get("effect") == "stun" and random.random() < 0.5:
                cb["ms"]["stun"] = 1
                _log(cb, "sys", f"{cb['name']} krztusi się i traci turę!", out)
        elif eff.get("oil"):
            chm.remove_item(uid, arg, 1)
            cb["oil"] = {"family": eff["oil"]["family"], "bonus": eff["oil"]["bonus"], "name": it["name"]}
            hit = " Potwór cofa się na sam zapach." if eff["oil"]["family"] == cb["family"] else ""
            _log(cb, "player", f"Nacierasz ostrze: {it['name']}.{hit}", out,
                 f"+{round(eff['oil']['bonus'] * 100)}% obrażeń przeciw: {eff['oil']['family']}")
        else:
            msgs = chm.use_item(ch, arg, in_combat=True)
            _log(cb, "player", " ".join(msgs), out)
    elif action == "flee":
        chance = _flee(cb, st)
        if random.random() * 100 < chance:
            cb["over"], cb["result"] = True, "fled"
            _log(cb, "player", "Uciekasz w gęstwinę. Serce wali jak młot, ale żyjesz.", out, f"szansa ucieczki {chance:.0f}%")
        else:
            cb["flee_bonus"] += 10
            _log(cb, "player", "Próbujesz uciec — potwór odcina ci drogę!", out, f"szansa była {chance:.0f}% · następna próba +10%")


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
        _log(cb, "monster", f"{cb['name']} — {move['name']}, ale robisz unik!", out, f"celność wroga {acc:.0f}%")
        return
    power = move.get("power", 1.0)
    dmg = 0
    if power > 0:
        prot = _protection(ch, st)
        raw = cb["attack"] * power * random.uniform(0.85, 1.15)
        dmg = raw - prot
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
        _log(cb, "monster", f"{cb['name']} {verb} — tracisz {dmg} HP.", out,
             f"celność {acc:.0f}% · siła {raw:.0f} · twój pancerz −{prot:.0f} · zdrowie {max(0, int(ch['hp']))}")
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
    cds = cb.setdefault("cd", {})
    for k in list(cds):
        cds[k] -= 1
        if cds[k] <= 0:
            cds.pop(k)
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
        chm.journal(uid, "combat", f"Pokonałeś: {cb['name']}. +{xp} PD, +{chm.money(coins)}. {', '.join(summary['loot'])}")
    elif cb["result"] == "lose":
        lost = int(ch["coins"] * 0.15)
        ch["coins"] -= lost
        ch["hp"] = 1
        summary["coins"] = -lost
        summary["messages"].append("Ciemność. Budzisz się w rowie, obdarty z części groszy. Ktoś cię opatrzył — nie wiesz kto.")
        _log(cb, "sys", "Padasz na ziemię…", out)
        chm.journal(uid, "combat", f"Pokonany przez: {cb['name']}. Straciłeś {chm.money(lost)}.")
    else:
        chm.journal(uid, "combat", f"Uciekłeś przed: {cb['name']}.")
    cb["summary"] = summary
    return summary


def act(ch, action, arg=None):
    cb = ch.get("combat")
    if not cb or cb.get("over"):
        raise GameError("Nie walczysz z nikim.")
    cb.setdefault("cd", {})
    d = chm.derived(ch)
    auto_note = None
    if action == "auto":
        action, arg, auto_note = auto_choose(ch, cb, d, arg)
    # walidacja wyboru — błąd nie zużywa tury
    if action == "attack":
        if arg not in ATTACKS:
            raise GameError("Nieznany atak.")
        if cb["cd"].get(arg):
            raise GameError(f"{ATTACKS[arg]['name']} — jeszcze {cb['cd'][arg]} {chm.plural(cb['cd'][arg], 'tura', 'tury', 'tur')} odnowienia.")
    elif action == "spell":
        if arg not in SPELLS:
            raise GameError("Nieznany czar.")
        if cb["cd"].get(arg):
            raise GameError(f"{SPELLS[arg]['name']} — jeszcze {cb['cd'][arg]} {chm.plural(cb['cd'][arg], 'tura', 'tury', 'tur')} odnowienia.")
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
    if auto_note:
        out.append({"who": "auto", "text": auto_note})
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
    return {"turn_log": out, "combat": cb, "summary": summary, "auto": auto_note and {"action": action, "arg": arg}}


def _acc(a, st, cb):
    return max(25, min(99, a["acc"] + (st["zrecznosc"] - cb["speed"]) * 1.5))


def _crit(st):
    return 0.05 + st["percepcja"] * 0.006


def _flee(cb, st):
    return max(5, min(95, cb["flee_chance"] + (st["zrecznosc"] - cb["speed"]) * 3 + cb["flee_bonus"]))


def _protection(ch, st):
    _, armor = chm.equipment(ch["user_id"])
    arm = (armor["effects"] or {}).get("armor", 0) if armor else 0
    return arm + st["odpornosc"] * 0.5


def _range_dmg(cb, lo, hi):
    """Przedział obrażeń po pancerzu wroga i osłabieniu gracza."""
    armor = _mdef(cb)
    w = 0.75 if cb["ps"].get("weaken") else 1.0
    return [int(round(max(1, lo - armor) * w)), int(round(max(1, hi - armor) * w))]


def estimates(ch, cb, d):
    """Statystyki każdego ruchu: obrażenia, celność, krytyk, efekty, odnowienie."""
    st = d["stats"]
    moc = st["moc"]
    base, tags, _ = _player_power(ch, d)
    cds = cb.get("cd") or {}
    attacks = []
    for k, a in ATTACKS.items():
        mult, notes = _weak_mult(cb, tags, [])
        lo, hi = base * a["power"] * 0.85 * mult, base * a["power"] * 1.05 * mult
        e = {"id": k, "name": a["name"], "glyph": a["glyph"], "desc": a["desc"], "cd": a["cd"], "cd_left": cds.get(k, 0),
             "dmg": _range_dmg(cb, lo, hi), "hit": round(_acc(a, st, cb)), "crit": round(_crit(st) * 100),
             "weak": [_note_name(n) for n in notes], "first": bool(a.get("priority"))}
        if a.get("effect") == "expose":
            e["effect"] = "odsłania wroga: obrona ×0,5 przez 2 tury"
        attacks.append(e)
    spells = []
    for k, s in SPELLS.items():
        e = {"id": k, "name": s["name"], "glyph": s["glyph"], "desc": s["desc"], "cd": s["cd"], "cd_left": cds.get(k, 0),
             "hit": 100}
        if k == "zar":
            mult, notes = _weak_mult(cb, [], [], "ogien")
            add = cb["defense"] * 0.4
            e.update(dmg=_range_dmg(cb, (6 + moc * 2.2) * 0.9 * mult + add, (6 + moc * 2.2) * 1.1 * mult + add),
                     crit=4, weak=[_note_name(n) for n in notes])
        elif k == "tchnienie":
            e.update(dmg=_range_dmg(cb, (3 + moc) * 0.9, (3 + moc) * 1.1), crit=0,
                     effect=f"ogłuszenie {min(95, 45 + moc * 3)}% (wróg traci turę)")
        elif k == "tarcza":
            e["effect"] = f"tarcza pochłania {int(10 + moc * 3)} obrażeń"
            if "swiatlo" in cb["weaknesses"]:
                e.update(dmg=_range_dmg(cb, moc * 1.8 + 4, moc * 1.8 + 4), weak=["światło"])
        elif k == "peta":
            e["effect"] = f"3 tury: obrona wroga ×0,5, −{max(1, int(moc * 1.2))} HP co turę"
        elif k == "szept":
            e["effect"] = f"+{int(8 + moc * 3)} HP, ucieczka +25%, tamuje krwawienie"
        spells.append(e)
    flee = round(_flee(cb, st))
    me = {"power": round(base, 1), "protection": round(_protection(ch, st), 1), "speed": st["zrecznosc"],
          "crit": round(_crit(st) * 100), "flee": flee}
    foe_moves = []
    for mv in cb["moves"]:
        acc = max(30, min(97, (mv.get("acc") or 90) - (st["zrecznosc"] - cb["speed"]) * 1.0))
        p = mv.get("power", 1.0)
        rng = [max(1, int(cb["attack"] * p * 0.85 - me["protection"])), max(1, int(cb["attack"] * p * 1.15 - me["protection"]))] if p > 0 else None
        foe_moves.append({"name": mv["name"], "hit": round(acc), "dmg": rng,
                          "effect": EFFECT_NAMES.get(mv.get("effect")) if mv.get("effect") else None})
    foe = {"attack": round(cb["attack"], 1), "defense": round(_mdef(cb), 1), "speed": cb["speed"],
           "weaknesses": [_note_name(w) for w in cb["weaknesses"]], "moves": foe_moves}
    return attacks, spells, me, foe


def _usable_items(ch):
    c = content()
    out = []
    for iid, q in chm.inv_map(ch["user_id"]).items():
        it = c["items"].get(iid)
        if not it or q < 1:
            continue
        eff = it.get("effects") or {}
        if (it.get("usable") or eff.get("throw")) and not eff.get("mutation"):
            out.append((iid, it, eff, q))
    return out


def auto_choose(ch, cb, d, plan=None):
    """Wybiera ruch z planu gracza: pierwszy pasujący warunek i dostępny ruch."""
    plan = plan if isinstance(plan, list) and plan else DEFAULT_PLAN
    hp_pct = 100.0 * ch["hp"] / max(1, d["max_hp"])
    foe_pct = 100.0 * cb["hp"] / max(1, cb["max_hp"])
    items = _usable_items(ch)
    cds = cb.get("cd") or {}
    for step in plan[:20]:
        if not isinstance(step, dict):
            continue
        t, sid = step.get("t"), step.get("id")
        if step.get("hp_below") not in (None, "") and hp_pct >= float(step["hp_below"]):
            continue
        if step.get("foe_above") not in (None, "") and foe_pct <= float(step["foe_above"]):
            continue
        if t == "attack" and sid in ATTACKS and not cds.get(sid):
            return "attack", sid, f"Auto: {ATTACKS[sid]['name']}"
        if t == "spell" and sid in SPELLS and not cds.get(sid):
            if sid == "tarcza" and cb["ps"].get("shield"):
                continue
            if sid == "peta" and cb["ms"].get("bound"):
                continue
            return "spell", sid, f"Auto: {SPELLS[sid]['name']}"
        if t == "flee":
            return "flee", None, "Auto: ucieczka"
        if t == "item":
            pick = None
            if sid == "*heal":
                room = d["max_tox"] - ch["toxicity"]
                heals = [(iid, it, eff) for iid, it, eff, q in items
                         if (eff.get("heal") or 0) > 0 and not eff.get("throw") and (eff.get("toxicity") or 0) < room]
                # najmniej toksyczne, potem najmocniejsze
                heals.sort(key=lambda x: ((x[2].get("toxicity") or 0) > 0, -(x[2].get("heal") or 0)))
                pick = heals[0] if heals else None
            elif sid == "*oil":
                if not (cb.get("oil") and cb["oil"]["family"] == cb["family"]):
                    pick = next(((iid, it, eff) for iid, it, eff, q in items
                                 if eff.get("oil") and eff["oil"]["family"] == cb["family"]), None)
            elif sid == "*throw":
                th = [(iid, it, eff) for iid, it, eff, q in items if eff.get("throw")]
                th.sort(key=lambda x: -(x[2]["throw"].get("mult", 1) if cb["family"] in (x[2]["throw"].get("family") or []) else 1))
                pick = th[0] if th else None
            else:
                pick = next(((iid, it, eff) for iid, it, eff, q in items if iid == sid), None)
                if pick and pick[2].get("oil") and cb.get("oil") and cb["oil"]["family"] == pick[2]["oil"]["family"]:
                    pick = None
            if pick:
                return "item", pick[0], f"Auto: {pick[1]['name']}"
    return "attack", "ciecie", "Auto: Cięcie"


def combat_view(ch):
    """Stan walki do wyświetlenia + dostępne ruchy gracza ze statystykami."""
    cb = ch.get("combat")
    if not cb:
        return None
    cb.setdefault("cd", {})
    d = chm.derived(ch)
    items = []
    for iid, it, eff, q in _usable_items(ch):
        kind = "rzut" if eff.get("throw") else ("olej" if eff.get("oil") else it["category"])
        info = []
        if eff.get("heal"):
            info.append(f"{'+' if eff['heal'] > 0 else ''}{eff['heal']} HP")
        if eff.get("toxicity"):
            info.append(f"+{eff['toxicity']} toksyn")
        if eff.get("throw"):
            th = eff["throw"]
            eff_mult = th.get("mult", 1) if cb["family"] in (th.get("family") or []) else 1
            raw = (th.get("dmg", 5) + d["stats"]["moc"] * 0.5) * eff_mult + cb["defense"] * 0.5
            info.append(f"~{max(1, int(raw - _mdef(cb)))} obrażeń" + (" · skuteczne!" if eff_mult > 1 else ""))
        if eff.get("oil"):
            ok = eff["oil"]["family"] == cb["family"]
            info.append(f"+{round(eff['oil']['bonus'] * 100)}% obrażeń" + (" · pasuje!" if ok else " · nie na ten gatunek"))
        items.append({"id": iid, "name": it["name"], "glyph": it["glyph"], "qty": q, "kind": kind,
                      "description": it["description"], "info": " · ".join(info)})
    attacks, spells, me, foe = estimates(ch, cb, d)
    return {
        **{k: cb[k] for k in ("monster", "name", "glyph", "family", "level", "description", "hp", "max_hp",
                              "turn", "log", "ps", "ms", "oil", "cd")},
        "attacks": attacks, "spells": spells, "items": items, "me": me, "foe": foe,
        "default_plan": DEFAULT_PLAN,
    }
