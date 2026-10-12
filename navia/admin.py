"""API panelu admina: edycja treści gry, symulator szans, gracze, eksport/import."""
from flask import Blueprint, jsonify, request

from . import character as chm
from . import config
from . import explore as explorem
from .api import admin_required
from .db import (CONTENT_TABLES, JSON_FIELDS, PLAYER_TABLES, bump_content, content, dumps, execute,
                 fix_sequences, query, upsert)

bp = Blueprint("admin", __name__, url_prefix="/api/admin")

EDITABLE = CONTENT_TABLES + ["places"]

ITEM_CATEGORIES = ["ziolo", "grzyb", "mineral", "drewno", "woda", "czesc_potwora", "narzedzie", "konstrukcja",
                   "eliksir", "olej", "wywar", "katalizator", "bron", "pancerz", "jedzenie", "artefakt", "inne"]
RARITIES = ["pospolity", "niepospolity", "rzadki", "legendarny"]

# Specyfikacja formularzy — panel buduje z niej edytory.
FIELDS = {
    "items": [
        ("id", "key", "Identyfikator"), ("name", "text", "Nazwa"), ("glyph", "glyph", "Ikona (emoji)"),
        ("category", "select:categories", "Kategoria"), ("rarity", "select:rarities", "Rzadkość"),
        ("description", "textarea", "Opis słowny"), ("value", "number", "Wartość (grosze)"),
        ("usable", "bool", "Można użyć / wypić"), ("effects", "effects", "Efekty"),
        ("is_tool", "bool", "Jest narzędziem"), ("tool_bonus", "number", "Premia narzędzia do szansy (%)"),
        ("catalyst_bonus", "number", "Katalizator uniwersalny (+% do każdej receptury)"),
        ("placeable", "bool", "Można postawić w obozie/siedlisku"),
        ("max_durability", "number", "Wytrzymałość"), ("decay_per_hour", "number", "Utrata wytrzymałości / h"),
        ("repair_cost", "itemqty", "Koszt naprawy"),
    ],
    "recipes": [
        ("id", "key", "Identyfikator"), ("name", "text", "Nazwa"), ("description", "textarea", "Opis"),
        ("result_item", "item", "Wynik"), ("result_qty", "number", "Ilość wyniku"),
        ("ingredients", "itemqty", "Składniki (zużywane)"), ("tools", "itemlist", "Wymagane narzędzia (nie zużywane)"),
        ("tool_mode", "select:tool_modes", "Skąd narzędzia"), ("station", "select:stations", "Miejsce wykonania"),
        ("base_chance", "range", "Bazowa szansa (%)"), ("skill_bonus", "number", "+% za punkt Alchemii"),
        ("catalysts", "catalysts", "Katalizatory i pomocnicze narzędzia"), ("fail_item", "item?", "Przy porażce daj"),
        ("min_level", "number", "Min. poziom"), ("xp", "number", "Doświadczenie"),
        ("known_by_default", "bool", "Znana od startu"), ("enabled", "bool", "Włączona"),
    ],
    "monsters": [
        ("id", "key", "Identyfikator"), ("name", "text", "Nazwa"), ("glyph", "glyph", "Ikona"),
        ("family", "select:families", "Rodzina"), ("level", "number", "Poziom"), ("hp", "number", "HP"),
        ("attack", "number", "Atak"), ("defense", "number", "Obrona"), ("speed", "number", "Szybkość"),
        ("xp", "number", "Doświadczenie"), ("coins", "number", "Grosze"), ("flee_chance", "number", "Szansa ucieczki (%)"),
        ("description", "textarea", "Wygląd"), ("intro", "textarea", "Tekst spotkania"), ("lore", "textarea", "Bestiariusz"),
        ("weaknesses", "taglist:weaknesses", "Słabości"), ("moves", "moves", "Ataki potwora"), ("loot", "loot", "Łup"),
    ],
    "events": [
        ("id", "key", "Identyfikator"), ("name", "text", "Nazwa"), ("kind", "select:event_kinds", "Rodzaj"),
        ("ref", "ref", "Potwór / przedmiot"), ("text", "textarea", "Tekst zdarzenia"),
        ("base_weight", "number", "Waga bazowa"), ("terrain_mods", "mods:terrains", "Mnożniki terenu"),
        ("other_terrain", "number", "Mnożnik na pozostałych terenach"), ("power_mods", "mods:power_kinds", "Mnożniki punktów mocy"),
        ("night_mult", "number", "Mnożnik nocą"), ("day_mult", "number", "Mnożnik za dnia"),
        ("min_level", "number", "Od poziomu"), ("max_level", "number", "Do poziomu"),
        ("outcome", "outcome", "Skutki (JSON)"), ("enabled", "bool", "Włączone"),
    ],
    "gather_actions": [
        ("id", "key", "Identyfikator"), ("name", "text", "Nazwa akcji"), ("terrain", "select:gather_terrains", "Gdzie"),
        ("tool", "item?", "Wymagane narzędzie"), ("text", "textarea", "Opis"), ("loot", "loot", "Łup"),
        ("cooldown_s", "number", "Odnowienie (s)"), ("vigor_cost", "number", "Koszt wigoru"), ("enabled", "bool", "Włączona"),
    ],
    "terrains": [
        ("id", "key", "Identyfikator"), ("name", "text", "Nazwa"), ("color", "color", "Kolor na mapie"),
        ("description", "textarea", "Opis"), ("weight", "number", "Częstość w generatorze (0 = nie generuj)"),
        ("min_r", "number", "Min. promień (m)"), ("max_r", "number", "Maks. promień (m)"),
        ("names", "stringlist", "Nazwy ({imie} = losowe słowiańskie imię)"),
    ],
    "power_kinds": [
        ("id", "key", "Identyfikator"), ("name", "text", "Nazwa"), ("glyph", "glyph", "Symbol"),
        ("color", "color", "Kolor"), ("description", "textarea", "Opis"),
        ("stat_mods", "statmods", "Wpływ na cechy (w centrum, maleje z odległością)"),
        ("radius", "number", "Promień (m)"), ("weight", "number", "Częstość w generatorze"),
        ("names", "stringlist", "Nazwy"),
    ],
    "building_types": [
        ("id", "key", "Identyfikator"), ("name", "text", "Nazwa"), ("glyph", "glyph", "Ikona"),
        ("description", "textarea", "Opis"), ("actions", "actions", "Akcje (JSON)"),
        ("shop", "itemprice", "Sklep"), ("teaches", "recipeprice", "Uczy receptur"),
        ("search_loot", "loot", "Łup z przeszukiwania"), ("weight", "number", "Częstość w generatorze"),
        ("names", "stringlist", "Nazwy"),
    ],
    "places": [
        ("id", "auto", "ID"), ("layer", "select:layers", "Warstwa"), ("kind", "placekind", "Rodzaj"),
        ("name", "text", "Nazwa"), ("lat", "number", "Szerokość"), ("lng", "number", "Długość"),
        ("radius", "number", "Promień (m)"), ("strength", "number", "Siła"), ("description", "textarea", "Opis"),
        ("source", "text", "Źródło"),
    ],
}

TABLE_LABELS = {
    "items": "Przedmioty", "recipes": "Receptury", "monsters": "Potwory", "events": "Pula zdarzeń",
    "gather_actions": "Zbieractwo", "terrains": "Tereny", "power_kinds": "Punkty mocy",
    "building_types": "Budynki", "places": "Miejsca na mapie",
}


@bp.get("/meta")
@admin_required
def meta():
    c = content()
    stations = ["any", "camp", "base"] + [f"building:{k}" for k in c["building_types"]] + \
               [f"power:{k}" for k in c["power_kinds"]]
    weak = sorted({"ogien", "swiatlo", "srebro"} | {i for i, it in c["items"].items() if (it.get("effects") or {}).get("oil")})
    families = sorted({m["family"] for m in c["monsters"].values()} | {"bestia", "upior", "wodne", "przeklety", "demon", "lesne", "smocze", "ludzie"})
    return jsonify({
        "fields": FIELDS, "labels": TABLE_LABELS,
        "options": {
            "categories": ITEM_CATEGORIES, "rarities": RARITIES, "tool_modes": ["any", "bag", "placed"],
            "stations": stations, "event_kinds": ["monster", "item", "story"], "families": families,
            "weaknesses": weak, "layers": ["zone", "power", "building"],
            "gather_terrains": ["*"] + list(c["terrains"].keys()) + [f"power:{k}" for k in c["power_kinds"]],
            "items": [{"id": k, "name": v["name"], "glyph": v["glyph"], "category": v["category"]} for k, v in sorted(c["items"].items(), key=lambda x: x[1]["name"])],
            "monsters": [{"id": k, "name": v["name"], "glyph": v["glyph"]} for k, v in c["monsters"].items()],
            "recipes": [{"id": k, "name": v["name"]} for k, v in c["recipes"].items()],
            "terrains": [{"id": k, "name": v["name"], "color": v["color"]} for k, v in c["terrains"].items()],
            "power_kinds": [{"id": k, "name": v["name"], "glyph": v["glyph"], "color": v["color"]} for k, v in c["power_kinds"].items()],
            "building_types": [{"id": k, "name": v["name"], "glyph": v["glyph"]} for k, v in c["building_types"].items()],
            "stats": chm.STAT_NAMES, "modes": config.EXPLORE_MODES,
        },
    })


@bp.get("/table/<table>")
@admin_required
def list_rows(table):
    if table not in EDITABLE:
        raise ValueError("Nieznana tabela")
    rows = query(f"SELECT * FROM {table} ORDER BY id", table=table)
    return jsonify({"rows": rows})


@bp.post("/table/<table>")
@admin_required
def save_row(table):
    if table not in EDITABLE:
        raise ValueError("Nieznana tabela")
    data = request.get_json(force=True) or {}
    original = data.pop("_original_id", None)
    if table == "places":
        cols = [f for f, _, _ in FIELDS["places"] if f != "id"]
        vals = [data.get(f) for f in cols]
        if data.get("id"):
            execute(f"UPDATE places SET {','.join(c + '=?' for c in cols)} WHERE id=?", vals + [int(data["id"])])
            pid = int(data["id"])
        else:
            pid = execute(f"INSERT INTO places({','.join(cols)}) VALUES ({','.join('?' * len(cols))})", vals).lastrowid
        bump_content()
        return jsonify({"ok": True, "id": pid})
    if not data.get("id"):
        raise ValueError("Podaj identyfikator.")
    for f in JSON_FIELDS.get(table, []):
        if isinstance(data.get(f), str):
            import json
            data[f] = json.loads(data[f] or "null")
    upsert(table, data)
    if original and original != data["id"]:
        execute(f"DELETE FROM {table} WHERE id=?", (original,))
        bump_content()
    return jsonify({"ok": True, "id": data["id"]})


@bp.delete("/table/<table>/<rid>")
@admin_required
def delete_row(table, rid):
    if table not in EDITABLE:
        raise ValueError("Nieznana tabela")
    execute(f"DELETE FROM {table} WHERE id=?", (int(rid) if table == "places" else rid,))
    bump_content()
    return jsonify({"ok": True})


@bp.post("/simulate")
@admin_required
def simulate():
    b = request.get_json(force=True) or {}
    terrains = {k: float(v) for k, v in (b.get("terrains") or {"trakt": 1}).items() if float(v) > 0} or {"trakt": 1.0}
    power = {k: float(v) for k, v in (b.get("power") or {}).items() if float(v) > 0}
    probs = explorem.probabilities(terrains, power, bool(b.get("night")), int(b.get("level", 1)),
                                   b.get("mode", "normalny"), float(b.get("percepcja", 5)))
    return jsonify({"probabilities": probs})


@bp.get("/users")
@admin_required
def users():
    rows = query("SELECT u.id, u.username, u.is_admin, c.level, c.coins, c.energy, c.last_seen "
                 "FROM users u LEFT JOIN characters c ON c.user_id=u.id ORDER BY u.id")
    return jsonify({"users": rows})


@bp.post("/users/<int:uid>")
@admin_required
def user_update(uid):
    b = request.get_json(force=True) or {}
    if "is_admin" in b:
        execute("UPDATE users SET is_admin=? WHERE id=?", (1 if b["is_admin"] else 0, uid))
    if b.get("give"):
        chm.add_item(uid, b["give"]["item"], int(b["give"].get("qty", 1)))
    if b.get("coins"):
        execute("UPDATE characters SET coins=coins+? WHERE user_id=?", (int(b["coins"]), uid))
    if b.get("energy"):
        e = float(b["energy"])
        execute("UPDATE characters SET energy=CASE WHEN energy+? > ? THEN ? ELSE energy+? END WHERE user_id=?",
                (e, config.ENERGY_MAX, config.ENERGY_MAX, e, uid))
    if b.get("teach_all"):
        for rid in content()["recipes"]:
            execute("INSERT OR IGNORE INTO known_recipes(user_id, recipe_id) VALUES (?,?)", (uid, rid))
    if b.get("heal"):
        execute("UPDATE characters SET hp=9999, vigor=9999, toxicity=0, combat=NULL WHERE user_id=?", (uid,))
    return jsonify({"ok": True})


@bp.get("/export")
@admin_required
def export():
    """Eksport treści gry; z ?full=1 także konta, postacie, ekwipunek i obozy (pełna kopia zapasowa)."""
    import time as _t
    out = {t: query(f"SELECT * FROM {t}", table=t) for t in EDITABLE}
    out["_meta"] = {"version": 1, "exported_at": _t.time(), "full": False}
    if request.args.get("full") == "1":
        for t in PLAYER_TABLES:
            out[t] = query(f"SELECT * FROM {t}")  # surowe wartości (JSON jako tekst)
        out["_meta"]["full"] = True
    return jsonify(out)


@bp.post("/import")
@admin_required
def import_():
    data = request.get_json(force=True) or {}
    n = 0
    full = bool((data.get("_meta") or {}).get("full")) and any(data.get(t) for t in PLAYER_TABLES)
    for t in CONTENT_TABLES:
        for row in data.get(t) or []:
            upsert(t, row, bump=False)
            n += 1
    for row in data.get("places") or []:
        if full:
            upsert("places", row, bump=False)
        else:
            row = {k: v for k, v in row.items() if k != "id"}
            cols = list(row.keys())
            execute(f"INSERT OR IGNORE INTO places({','.join(cols)}) VALUES ({','.join('?' * len(cols))})", [row[c] for c in cols])
        n += 1
    if full:  # pełna kopia: konta i postęp graczy
        for t in PLAYER_TABLES:
            for row in data.get(t) or []:
                upsert(t, row, bump=False)
                n += 1
        fix_sequences()
    bump_content()
    return jsonify({"ok": True, "imported": n})
