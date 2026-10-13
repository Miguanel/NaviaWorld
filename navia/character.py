"""Postać gracza: statystyki, regeneracja, ekwipunek, doświadczenie, efekty."""
import random
import time

from . import config
from .db import content, dumps, execute, query

STAT_NAMES = {
    "sila": "Siła", "zrecznosc": "Zręczność", "witalnosc": "Witalność", "moc": "Moc",
    "odpornosc": "Odporność", "alchemia": "Alchemia", "percepcja": "Percepcja",
}
BASE_STATS = {"sila": 5, "zrecznosc": 5, "witalnosc": 5, "moc": 5, "odpornosc": 5, "alchemia": 3, "percepcja": 5}

CHAR_JSON = ["stats", "mutations", "effects", "cooldowns", "combat", "contracts", "equipment"]


def plural(n, one, few, many):
    n = abs(int(n))
    if n == 1:
        return one
    if 2 <= n % 10 <= 4 and not 12 <= n % 100 <= 14:
        return few
    return many


def money(g):
    """Kwota w groszach → „2 dobroty 40 gr”."""
    g = int(round(g))
    sign = "−" if g < 0 else ""
    d, r = divmod(abs(g), config.GROSZE_PER_DOBROTA)
    parts = []
    if d:
        parts.append(f"{d} {plural(d, *config.CURRENCY)}")
    if r or not d:
        parts.append(f"{r} gr")
    return sign + " ".join(parts)


class GameError(Exception):
    """Błąd zgłaszany graczowi (np. brak składników)."""


def xp_needed(level):
    return int(100 * level ** 1.5)


def load(user_id):
    ch = query("SELECT * FROM characters WHERE user_id=?", (user_id,), table="characters", one=True)
    if not ch:
        return None
    ch["stats"] = ch["stats"] or dict(BASE_STATS)
    ch["mutations"] = ch["mutations"] or []
    ch["effects"] = ch["effects"] or []
    ch["cooldowns"] = ch["cooldowns"] or {}
    ch["contracts"] = ch["contracts"] or []
    if ch.get("energy") is None:
        ch["energy"] = config.ENERGY_START
    if ch.get("equipment") is None:
        init_equipment(ch)
    return ch


def save(ch):
    cols = ["name", "level", "xp", "stat_points", "hp", "vigor", "toxicity", "energy", "coins", "stats",
            "mutations", "effects", "cooldowns", "combat", "contracts", "lat", "lng", "home_lat", "home_lng",
            "home_set_at", "last_tick", "last_seen", "last_move", "equipment"]
    vals = []
    for c in cols:
        v = ch.get(c)
        if c in CHAR_JSON:
            v = dumps(v) if v is not None else None
        vals.append(v)
    execute(f"UPDATE characters SET {','.join(c + '=?' for c in cols)} WHERE user_id=?", vals + [ch["user_id"]])


def create(user_id, name):
    lat, lng = config.DEFAULT_START
    st = dict(BASE_STATS)
    t = time.time()
    execute("INSERT INTO characters(user_id,name,stats,hp,vigor,energy,lat,lng,last_tick,last_seen) VALUES (?,?,?,?,?,?,?,?,?,?)",
            (user_id, name, dumps(st), 0, 0, config.ENERGY_START, lat, lng, t, t))
    from .seed import START_INVENTORY
    for item, qty in START_INVENTORY:
        add_item(user_id, item, qty)
    for r in content()["recipes"].values():
        if r.get("known_by_default"):
            execute("INSERT OR IGNORE INTO known_recipes(user_id, recipe_id) VALUES (?,?)", (user_id, r["id"]))
    ch = load(user_id)
    d = derived(ch)
    ch["hp"], ch["vigor"] = d["max_hp"], d["max_vigor"]
    save(ch)
    journal(user_id, "story", "Budzisz się na rozstajach z sakwą, kordem i niejasnym przeczuciem, że ziemia pod stopami pamięta więcej niż ty.")


# --------------------------------------------------------------------------- statystyki
# Sloty stroju: (klucz, nazwa, jakie rodzaje przedmiotów przyjmuje). Kolejność = układ „lalki” w karcie postaci.
SLOTS = [
    ("head", "Głowa", ["head"]), ("neck", "Szyja", ["neck"]), ("cloak", "Płaszcz", ["cloak"]),
    ("chest", "Tułów", ["chest"]), ("belt", "Pas", ["belt"]), ("legs", "Nogi", ["legs"]), ("feet", "Stopy", ["feet"]),
    ("glove_r", "Prawa rękawica", ["glove"]), ("hand_r", "Prawa ręka", ["weapon", "shield"]),
    ("glove_l", "Lewa rękawica", ["glove"]), ("hand_l", "Lewa ręka", ["weapon", "shield"]),
    ("ring_r", "Prawy pierścień", ["ring"]), ("ring_l", "Lewy pierścień", ["ring"]),
]
SLOT_NAMES = {k: n for k, n, _ in SLOTS}
SLOT_ACCEPTS = {k: a for k, _, a in SLOTS}
# Rodzaj przedmiotu (pole „slot” w panelu admina) → nazwa
ITEM_SLOT_TYPES = {"head": "Głowa", "neck": "Szyja", "cloak": "Płaszcz", "chest": "Tułów", "belt": "Pas",
                   "legs": "Nogi", "feet": "Stopy", "glove": "Rękawica", "weapon": "Broń", "shield": "Tarcza",
                   "ring": "Pierścień"}
# Gdy przedmiot nie ma ustawionego slotu, zgadujemy po kategorii (zgodność ze starymi przedmiotami).
CATEGORY_SLOT = {"bron": "weapon", "pancerz": "chest", "tarcza": "shield", "rekawice": "glove", "bizuteria": "ring"}
# Preferowana kolejność slotów przy automatycznym zakładaniu.
SLOT_PREF = {"weapon": ["hand_r", "hand_l"], "shield": ["hand_l", "hand_r"], "glove": ["glove_r", "glove_l"],
             "ring": ["ring_r", "ring_l"]}
WEAPON_KINDS = {"miecz": "miecz", "sztylet": "sztylet", "topor": "topór", "obuch": "obuch", "drzewcowa": "drzewcowa",
                "piesc": "pięść", "tarcza": "tarcza", "inne": "inna"}


def item_slot(it):
    """Rodzaj slotu, na który można założyć przedmiot (albo None)."""
    if not it:
        return None
    return it.get("slot") or CATEGORY_SLOT.get(it.get("category"))


def init_equipment(ch):
    """Pierwsze wczytanie postaci po aktualizacji: zakłada najlepszą broń i pancerz z torby
    (wcześniej gra robiła to automatycznie). Zapisuje od razu, żeby nic nie zginęło."""
    ch["equipment"] = {}
    c = content()["items"]
    best = {}
    for row in inventory(ch["user_id"]):
        it = c.get(row["item_id"])
        st = item_slot(it)
        if st not in ("weapon", "chest"):
            continue
        key = "attack" if st == "weapon" else "armor"
        val = (it.get("effects") or {}).get(key, 0)
        if st not in best or val > best[st][1]:
            best[st] = (it["id"], val)
    for st, (iid, _) in best.items():
        slot = "hand_r" if st == "weapon" else "chest"
        execute("UPDATE inventory SET qty=qty-1 WHERE user_id=? AND item_id=?", (ch["user_id"], iid))
        ch["equipment"][slot] = iid
    execute("DELETE FROM inventory WHERE user_id=? AND qty<=0", (ch["user_id"],))
    execute("UPDATE characters SET equipment=? WHERE user_id=?", (dumps(ch["equipment"]), ch["user_id"]))


def worn(ch):
    """{slot: przedmiot} — tylko istniejące przedmioty."""
    c = content()["items"]
    return {s: c[i] for s, i in (ch.get("equipment") or {}).items() if i in c}


def equip(ch, item_id, slot=None):
    if ch.get("combat"):
        raise GameError("W trakcie walki nie przebierzesz się.")
    c = content()["items"]
    it = c.get(item_id)
    st = item_slot(it)
    if not st:
        raise GameError("Tego nie da się założyć.")
    if count(ch["user_id"], item_id) < 1:
        raise GameError("Nie masz tego w torbie.")
    eq = ch.setdefault("equipment", {})
    eff = it.get("effects") or {}
    if eff.get("two_handed"):
        slot = "hand_r"
    candidates = [k for k, _, acc in SLOTS if st in acc]
    if slot:
        if slot not in SLOT_ACCEPTS or st not in SLOT_ACCEPTS[slot]:
            raise GameError(f"To nie pasuje do miejsca: {SLOT_NAMES.get(slot, slot)}.")
    else:
        pref = SLOT_PREF.get(st, candidates)
        slot = next((k for k in pref if not eq.get(k)), pref[0])
    msgs = []
    remove_item(ch["user_id"], item_id, 1)
    freed = [slot]
    if eff.get("two_handed"):
        freed.append("hand_l")
    if slot == "hand_l" and eq.get("hand_r") and (c.get(eq["hand_r"], {}).get("effects") or {}).get("two_handed"):
        freed.append("hand_r")
    for f in freed:
        old = eq.pop(f, None)
        if old:
            add_item(ch["user_id"], old, 1)
            msgs.append(f"Zdejmujesz: {c.get(old, {}).get('name', old)}.")
    eq[slot] = item_id
    msgs.append(f"Zakładasz: {it['name']} ({SLOT_NAMES[slot].lower()}).")
    return msgs


def unequip(ch, slot):
    if ch.get("combat"):
        raise GameError("W trakcie walki nie przebierzesz się.")
    eq = ch.get("equipment") or {}
    iid = eq.pop(slot, None)
    if not iid:
        raise GameError("Nic tam nie masz.")
    add_item(ch["user_id"], iid, 1)
    return f"Zdejmujesz: {content()['items'].get(iid, {}).get('name', iid)}."


def gear_stats(ch):
    out = {}
    for it in worn(ch).values():
        for s, v in ((it.get("effects") or {}).get("stats") or {}).items():
            out[s] = out.get(s, 0) + v
    return out


def gear_armor(ch):
    return round(sum(float((it.get("effects") or {}).get("armor") or 0) for it in worn(ch).values()), 1)


def _hand(weapon, gloves, share):
    """Siła jednej ręki: broń (albo pięść) zmieniona przez rękawicę założoną na tę rękę."""
    eff = (weapon.get("effects") or {}) if weapon else {}
    if not weapon:
        kind = "piesc"
    elif item_slot(weapon) == "shield":
        kind = "tarcza"
    else:
        kind = eff.get("kind") or "inne"
    base = float(eff.get("attack") or 0)
    flat = pct = crit = 0.0
    tags = list(eff.get("tags") or [])
    used = []
    for gl in gloves:
        gm = (gl.get("effects") or {}).get("weapon_mods") or {}
        if not gm:
            continue
        kinds = gm.get("kinds") or []
        if kinds and kind not in kinds:
            used.append({"name": gl["name"], "glyph": gl["glyph"], "applies": False,
                         "why": "działa tylko z: " + ", ".join(WEAPON_KINDS.get(k, k) for k in kinds)})
            continue
        flat += float(gm.get("attack") or 0) * share
        pct += float(gm.get("attack_pct") or 0) * share
        crit += float(gm.get("crit") or 0) * share
        tags += [t for t in gm.get("tags") or [] if t not in tags]
        used.append({"name": gl["name"], "glyph": gl["glyph"], "applies": True})
    attack = max(0.0, (base + flat) * (1 + pct / 100.0))
    return {"item": weapon and {"id": weapon["id"], "name": weapon["name"], "glyph": weapon["glyph"]},
            "kind": kind, "kind_name": WEAPON_KINDS.get(kind, kind), "base": base, "flat": round(flat, 1),
            "pct": round(pct, 1), "crit": round(crit, 1), "attack": round(attack, 1), "tags": tags, "gloves": used}


def gear(ch):
    """Siła ataku z obu rąk: broń w prawej i lewej ręce, każda zmieniona przez swoją rękawicę.
    Broń dwuręczna korzysta z obu rękawic (każda działa w połowie). Druga broń dodaje 50% swojej siły."""
    w = worn(ch)
    r, l = w.get("hand_r"), w.get("hand_l")
    gr, gl = w.get("glove_r"), w.get("glove_l")
    two = bool(r and (r.get("effects") or {}).get("two_handed"))
    if two:
        main = _hand(r, [g for g in (gr, gl) if g], 0.5)
        main["side"] = "both"
        hands = [main]
        attack, crit, tags = main["attack"], main["crit"], main["tags"]
    else:
        hr = _hand(r, [gr] if gr else [], 1.0)
        hr["side"] = "right"
        hl = _hand(l, [gl] if gl else [], 1.0)
        hl["side"] = "left"
        hands = [hr, hl]
        order = sorted([hr, hl], key=lambda x: -x["attack"])
        first, second = order
        attack = first["attack"] + 0.5 * second["attack"]
        crit = first["crit"] + (0.5 * second["crit"] if second["attack"] > 0 else 0)
        tags = list(first["tags"]) + [t for t in (second["tags"] if second["attack"] > 0 else []) if t not in first["tags"]]
        for x in hands:
            x["share"] = 1.0 if x is first else 0.5
    return {"attack": round(attack, 1), "crit": round(crit, 1), "tags": tags, "two_handed": two,
            "hands": hands, "armor": gear_armor(ch), "stats": gear_stats(ch)}


def equipment_view(ch):
    w = worn(ch)
    slots = []
    for k, name, acc in SLOTS:
        it = w.get(k)
        slots.append({"slot": k, "name": name, "accepts": acc,
                      "item": it and {"id": it["id"], "name": it["name"], "glyph": it["glyph"], "rarity": it["rarity"],
                                      "category": it["category"], "description": it["description"],
                                      "effects": it.get("effects") or {}, "value": it["value"]},
                      "blocked": k == "hand_l" and bool(w.get("hand_r") and (w["hand_r"].get("effects") or {}).get("two_handed"))})
    return {"slots": slots, "gear": gear(ch)}


def effective_stats(ch, ctx=None):
    stats = dict(BASE_STATS)
    stats.update(ch["stats"] or {})
    for m in ch["mutations"]:
        for s, v in (m.get("stats") or {}).items():
            stats[s] = stats.get(s, 0) + v
    for s, v in gear_stats(ch).items():
        stats[s] = stats.get(s, 0) + v
    t = time.time()
    for e in ch["effects"]:
        if e.get("until", 0) > t:
            for s, v in (e.get("stats") or {}).items():
                stats[s] = stats.get(s, 0) + v
    if ctx:
        for s, v in (ctx.get("stat_mods") or {}).items():
            stats[s] = stats.get(s, 0) + v
    return {k: round(v, 1) for k, v in stats.items()}


def derived(ch, ctx=None):
    s = effective_stats(ch, ctx)
    return {
        "stats": s,
        "max_hp": int(40 + s["witalnosc"] * 10 + ch["level"] * 6),
        "max_vigor": int(20 + s["moc"] * 4),
        "max_tox": int(40 + s["odpornosc"] * 8),
        "mutation_slots": 2 + ch["level"] // 3,
        "xp_next": xp_needed(ch["level"]),
    }


def tick(ch):
    """Regeneracja zdrowia, wigoru i energii eksploracji; wygasanie efektów i toksyn."""
    t = time.time()
    last = ch.get("last_tick") or t
    dt_min = max(0.0, (t - last) / 60.0)
    d = derived(ch)
    if not ch.get("combat"):
        ch["hp"] = min(d["max_hp"], (ch["hp"] or 0) + d["max_hp"] * 0.02 * dt_min)
        ch["vigor"] = min(d["max_vigor"], (ch["vigor"] or 0) + 2.0 * dt_min)
    ch["toxicity"] = max(0.0, (ch["toxicity"] or 0) - 1.5 * dt_min)
    ch["energy"] = min(config.ENERGY_MAX, (ch.get("energy") or 0) + config.ENERGY_PER_HOUR * dt_min / 60.0)
    ch["effects"] = [e for e in ch["effects"] if e.get("until", 0) > t]
    ch["last_tick"] = t
    ch["last_seen"] = t
    return ch


def clamp_vitals(ch):
    d = derived(ch)
    ch["hp"] = max(0, min(d["max_hp"], ch["hp"]))
    ch["vigor"] = max(0, min(d["max_vigor"], ch["vigor"]))
    ch["toxicity"] = max(0, ch["toxicity"])
    return d


def add_effect(ch, name, stats, minutes):
    t = time.time()
    ch["effects"] = [e for e in ch["effects"] if e.get("name") != name and e.get("until", 0) > t]
    ch["effects"].append({"name": name, "stats": stats, "until": t + minutes * 60})


def gain_xp(ch, amount):
    """Dodaje doświadczenie; zwraca listę komunikatów o awansie."""
    msgs = []
    ch["xp"] += int(amount)
    while ch["xp"] >= xp_needed(ch["level"]):
        ch["xp"] -= xp_needed(ch["level"])
        ch["level"] += 1
        ch["stat_points"] += 3
        d = derived(ch)
        ch["hp"] = d["max_hp"]
        ch["vigor"] = d["max_vigor"]
        msgs.append(f"Awans! Osiągasz poziom {ch['level']}. Otrzymujesz 3 punkty cech.")
    return msgs


def check_cooldown(ch, key, seconds):
    t = time.time()
    left = ch["cooldowns"].get(key, 0) - t
    if left > 0:
        raise GameError(f"Jeszcze nie teraz — odczekaj {int(left) + 1} s.")
    ch["cooldowns"][key] = t + seconds


# --------------------------------------------------------------------------- ekwipunek
def inventory(user_id):
    return query("SELECT item_id, qty FROM inventory WHERE user_id=? AND qty>0 ORDER BY item_id", (user_id,))


def inv_map(user_id):
    return {r["item_id"]: r["qty"] for r in inventory(user_id)}


def count(user_id, item_id):
    r = query("SELECT qty FROM inventory WHERE user_id=? AND item_id=?", (user_id, item_id), one=True)
    return r["qty"] if r else 0


def add_item(user_id, item_id, qty=1):
    if qty <= 0:
        return
    execute("INSERT INTO inventory(user_id,item_id,qty) VALUES (?,?,?) "
            "ON CONFLICT(user_id,item_id) DO UPDATE SET qty=inventory.qty+excluded.qty", (user_id, item_id, qty))


def remove_item(user_id, item_id, qty=1):
    have = count(user_id, item_id)
    if have < qty:
        name = content()["items"].get(item_id, {}).get("name", item_id)
        raise GameError(f"Brakuje: {name} ({have}/{qty}).")
    execute("UPDATE inventory SET qty=qty-? WHERE user_id=? AND item_id=?", (qty, user_id, item_id))
    execute("DELETE FROM inventory WHERE user_id=? AND qty<=0", (user_id,))


def roll_loot(loot, mult=1.0, luck=0.0):
    """loot: [{item, chance, min, max}] → [(item, qty)]"""
    out = []
    for l in loot or []:
        ch = min(1.0, (l.get("chance") or 0) * (1 + luck))
        if random.random() < ch:
            q = random.randint(int(l.get("min") or 1), int(l.get("max") or l.get("min") or 1))
            q = max(1, int(round(q * mult)))
            out.append((l["item"], q))
    return out


def give_loot(user_id, loot_list):
    c = content()["items"]
    names = []
    for item, qty in loot_list:
        if item in c:
            add_item(user_id, item, qty)
            names.append(f"{c[item]['glyph']} {c[item]['name']} ×{qty}")
    return names


def journal(user_id, kind, text):
    execute("INSERT INTO journal(user_id, ts, kind, text) VALUES (?,?,?,?)", (user_id, time.time(), kind, text))


# --------------------------------------------------------------------------- użycie przedmiotu
def use_item(ch, item_id, in_combat=False):
    """Wypicie eliksiru, zjedzenie, wywar przemiany. Zwraca listę komunikatów."""
    it = content()["items"].get(item_id)
    if not it or not it.get("usable"):
        raise GameError("Tego nie da się użyć.")
    eff = it.get("effects") or {}
    if eff.get("oil") and not in_combat:
        raise GameError("Olej nakłada się na ostrze w trakcie walki.")
    if eff.get("throw") and not eff.get("heal") and not in_combat and not eff.get("effect"):
        raise GameError("Tym można rzucić w potwora podczas walki.")
    uid = ch["user_id"]
    remove_item(uid, item_id, 1)
    msgs = []
    d = derived(ch)

    if eff.get("mutation"):
        mut = eff["mutation"]
        if len(ch["mutations"]) >= d["mutation_slots"]:
            add_item(uid, item_id, 1)
            raise GameError(f"Twoje ciało nie zniesie kolejnej przemiany (miejsca: {d['mutation_slots']}). Zdobądź wyższy poziom.")
        if any(m["name"] == mut["name"] for m in ch["mutations"]):
            add_item(uid, item_id, 1)
            raise GameError("Ta przemiana już w tobie płynie.")
        tox = eff.get("toxicity", 50)
        risk = eff.get("risk", 0.2)
        over = (ch["toxicity"] + tox) - d["max_tox"]
        if over > 0:
            risk += over / 100.0
        risk = max(0.0, risk - d["stats"]["odpornosc"] * 0.01)
        ch["toxicity"] += tox
        if random.random() < risk:
            dmg = d["max_hp"] * 0.6
            ch["hp"] -= dmg
            msgs.append(f"Przemiana się nie udała. Wijesz się w konwulsjach, krew cieknie z nosa i uszu (−{int(dmg)} HP).")
        else:
            ch["mutations"].append({"name": mut["name"], "stats": mut.get("stats", {}), "item": item_id, "at": time.time()})
            parts = ", ".join(f"{'+' if v > 0 else ''}{v} {STAT_NAMES.get(s, s)}" for s, v in mut.get("stats", {}).items())
            msgs.append(f"Ból mija o świcie. Coś w tobie się zmieniło na zawsze: {mut['name']} ({parts}).")
            journal(uid, "mutation", f"Przeszedłeś przemianę: {mut['name']}.")
    else:
        if eff.get("heal"):
            ch["hp"] += eff["heal"]
            msgs.append(f"{'+' if eff['heal'] > 0 else ''}{eff['heal']} HP")
        if eff.get("vigor"):
            ch["vigor"] += eff["vigor"]
            msgs.append(f"+{eff['vigor']} wigoru")
        if eff.get("toxicity"):
            ch["toxicity"] += eff["toxicity"]
            msgs.append(f"{'+' if eff['toxicity'] > 0 else ''}{eff['toxicity']} toksyczności")
        if eff.get("effect"):
            e = eff["effect"]
            add_effect(ch, e["name"], e.get("stats", {}), e.get("minutes", 30))
            msgs.append(f"Efekt: {e['name']} ({e.get('minutes', 30)} min)")
    d = derived(ch)
    if ch["toxicity"] > d["max_tox"]:
        over = ch["toxicity"] - d["max_tox"]
        ch["hp"] -= over * 0.8
        msgs.append(f"Za dużo toksyn! Żołądek się skręca, wzrok mętnieje (−{int(over * 0.8)} HP).")
    clamp_vitals(ch)
    if ch["hp"] <= 0:
        ch["hp"] = 1
        msgs.append("Padasz bez czucia i budzisz się dopiero po długim czasie.")
    return [f"{it['glyph']} {it['name']}: " + "; ".join(msgs)] if msgs else [f"Używasz: {it['name']}."]
