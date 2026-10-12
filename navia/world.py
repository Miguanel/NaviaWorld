"""Świat gry: generator terenów, punktów mocy i budynków wokół GPS gracza,
miejsca z OpenStreetMap oraz obliczanie wpływu otoczenia na gracza."""
import hashlib
import json
import math
import random
import threading
import time
import urllib.parse
import urllib.request
from datetime import datetime

from . import config
from . import db as dbm
from .db import content, content_version, query

SLAVIC_NAMES = [
    "Wojmir", "Bogumił", "Radosław", "Dobrogost", "Ziemowit", "Lutomir", "Racibor", "Sulisław",
    "Żelisław", "Wszebor", "Mścisław", "Jarogniew", "Gościsław", "Siemowit", "Budzisław", "Bolebor",
    "Domarad", "Sobiebor", "Unisław", "Więcesław", "Zbylut", "Czcibor", "Mirogniew", "Świętopełk",
    "Dobiesław", "Krzesimir", "Ludomir", "Przybysław", "Sędziwoj", "Wrocisław", "Bogdał", "Gniewomir",
]

_cell_cache = {}
_cache_lock = threading.Lock()


# --------------------------------------------------------------------------- geometria
def dist_m(lat1, lng1, lat2, lng2):
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = p2 - p1
    dl = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def offset(lat, lng, dn, de):
    """Przesuwa punkt o dn metrów na północ i de metrów na wschód."""
    dlat = dn / 111320.0
    dlng = de / (111320.0 * math.cos(math.radians(lat)))
    return lat + dlat, lng + dlng


def cell_of(lat, lng):
    return math.floor(lat / config.CELL_LAT), math.floor(lng / config.CELL_LNG)


def is_night(hour=None):
    h = datetime.now().hour if hour is None else hour
    a, b = config.NIGHT_HOURS
    return h >= a or h < b


# --------------------------------------------------------------------------- generator
def _rng(*parts):
    seed = hashlib.sha256(":".join(str(p) for p in (config.WORLD_SEED,) + parts).encode()).hexdigest()
    return random.Random(seed)


def _weighted(rng, items, key="weight"):
    items = [i for i in items if (i.get(key) or 0) > 0]
    if not items:
        return None
    total = sum(i[key] for i in items)
    x = rng.random() * total
    for i in items:
        x -= i[key]
        if x <= 0:
            return i
    return items[-1]


def _name(rng, templates, fallback):
    if not templates:
        return fallback
    return rng.choice(templates).replace("{imie}", rng.choice(SLAVIC_NAMES))


def gen_cell(cx, cy):
    key = (cx, cy, content_version())
    with _cache_lock:
        if key in _cell_cache:
            return _cell_cache[key]
    c = content()
    terrains = sorted([t for t in c["terrains"].values() if (t.get("weight") or 0) > 0], key=lambda t: t["id"])
    kinds = sorted(c["power_kinds"].values(), key=lambda k: k["id"])
    btypes = sorted(c["building_types"].values(), key=lambda b: b["id"])

    r = _rng(cx, cy, "cell")
    # Region (4x4 komórki) ma dominujący teren — dzięki temu lasy i bagna tworzą większe płaty.
    dominant = _weighted(_rng(cx // 4, cy // 4, "region"), terrains)
    lat0, lng0 = cx * config.CELL_LAT, cy * config.CELL_LNG
    out = {"zones": [], "power": [], "buildings": []}

    for i in range(r.choice([1, 1, 2, 2, 3])):
        t = dominant if (dominant and r.random() < 0.55) else _weighted(r, terrains)
        if not t:
            break
        out["zones"].append({
            "id": f"g{cx}_{cy}_z{i}", "layer": "zone", "kind": t["id"],
            "name": _name(r, t.get("names"), t["name"]),
            "lat": lat0 + r.random() * config.CELL_LAT, "lng": lng0 + r.random() * config.CELL_LNG,
            "radius": r.uniform(t.get("min_r") or 120, t.get("max_r") or 360), "strength": 1.0, "source": "gen",
        })
    if kinds and r.random() < 0.42:
        k = _weighted(r, kinds)
        out["power"].append({
            "id": f"g{cx}_{cy}_p0", "layer": "power", "kind": k["id"],
            "name": _name(r, k.get("names"), k["name"]),
            "lat": lat0 + r.random() * config.CELL_LAT, "lng": lng0 + r.random() * config.CELL_LNG,
            "radius": (k.get("radius") or 200) * r.uniform(0.75, 1.3),
            "strength": round(r.uniform(0.6, 1.4), 2), "source": "gen",
        })
    if btypes and r.random() < 0.33:
        b = _weighted(r, btypes)
        out["buildings"].append({
            "id": f"g{cx}_{cy}_b0", "layer": "building", "kind": b["id"],
            "name": _name(r, b.get("names"), b["name"]),
            "lat": lat0 + (0.15 + r.random() * 0.7) * config.CELL_LAT,
            "lng": lng0 + (0.15 + r.random() * 0.7) * config.CELL_LNG,
            "radius": config.INTERACT_RADIUS_M, "strength": 1.0, "source": "gen",
        })
    with _cache_lock:
        if len(_cell_cache) > 5000:
            _cell_cache.clear()
        _cell_cache[key] = out
    return out


def _db_places(lat_min, lat_max, lng_min, lng_max):
    rows = query("SELECT * FROM places WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?",
                 (lat_min, lat_max, lng_min, lng_max))
    out = []
    for p in rows:
        p = dict(p)
        p["id"] = f"p{p['id']}"
        out.append(p)
    return out


def places_around(lat, lng, cells=None):
    """Wszystkie miejsca (generowane + z bazy) w kwadracie komórek wokół punktu."""
    cells = config.VIEW_CELLS if cells is None else cells
    cx, cy = cell_of(lat, lng)
    res = {"zones": [], "power": [], "buildings": []}
    for dx in range(-cells, cells + 1):
        for dy in range(-cells, cells + 1):
            g = gen_cell(cx + dx, cy + dy)
            for k in res:
                res[k].extend(g[k])
    lat_min = (cx - cells) * config.CELL_LAT
    lat_max = (cx + cells + 1) * config.CELL_LAT
    lng_min = (cy - cells) * config.CELL_LNG
    lng_max = (cy + cells + 1) * config.CELL_LNG
    for p in _db_places(lat_min - 0.005, lat_max + 0.005, lng_min - 0.008, lng_max + 0.008):
        layer = {"zone": "zones", "power": "power", "building": "buildings"}.get(p["layer"])
        if layer:
            res[layer].append(p)
    return res


def get_place(pid):
    """Odszukuje miejsce po id (generowane: g{cx}_{cy}_b0, z bazy: p{id})."""
    if pid.startswith("p") and pid[1:].isdigit():
        p = query("SELECT * FROM places WHERE id=?", (int(pid[1:]),), one=True)
        if p:
            p = dict(p)
            p["id"] = pid
        return p
    if pid.startswith("g"):
        try:
            cx, cy, _ = pid[1:].split("_")
            g = gen_cell(int(cx), int(cy))
        except ValueError:
            return None
        for layer in g.values():
            for p in layer:
                if p["id"] == pid:
                    return p
    return None


# --------------------------------------------------------------------------- wpływ otoczenia
def context_at(lat, lng):
    """Teren, punkty mocy i budynki działające na gracza w danym punkcie."""
    c = content()
    pl = places_around(lat, lng, cells=1)
    terrains = {}
    zone_names = {}
    for z in pl["zones"]:
        d = dist_m(lat, lng, z["lat"], z["lng"])
        if d <= z["radius"]:
            infl = 0.5 + 0.5 * (1 - d / z["radius"])
            if infl > terrains.get(z["kind"], 0):
                terrains[z["kind"]] = round(infl, 3)
                zone_names[z["kind"]] = z.get("name")
    if not terrains:
        terrains = {"trakt": 1.0}
        zone_names["trakt"] = "Trakt"
    primary = max(terrains, key=terrains.get)

    powers, power_infl = [], {}
    for p in pl["power"]:
        d = dist_m(lat, lng, p["lat"], p["lng"])
        if d <= p["radius"]:
            infl = round((p.get("strength") or 1) * (1 - d / p["radius"]), 3)
            kind = c["power_kinds"].get(p["kind"], {})
            powers.append({"id": p["id"], "kind": p["kind"], "name": p.get("name"), "infl": infl,
                           "dist": round(d), "glyph": kind.get("glyph", "✶"), "kind_name": kind.get("name", p["kind"])})
            power_infl[p["kind"]] = min(2.0, max(power_infl.get(p["kind"], 0), infl))
    powers.sort(key=lambda x: -x["infl"])

    stat_mods = {}
    for kind_id, infl in power_infl.items():
        for s, v in (c["power_kinds"].get(kind_id, {}).get("stat_mods") or {}).items():
            stat_mods[s] = round(stat_mods.get(s, 0) + v * infl, 2)

    buildings = []
    for b in pl["buildings"]:
        d = dist_m(lat, lng, b["lat"], b["lng"])
        if d <= max(config.INTERACT_RADIUS_M, b.get("radius") or 0):
            bt = c["building_types"].get(b["kind"], {})
            buildings.append({"id": b["id"], "kind": b["kind"], "name": b.get("name"), "dist": round(d),
                              "glyph": bt.get("glyph", "⌂"), "kind_name": bt.get("name", b["kind"])})
    buildings.sort(key=lambda x: x["dist"])

    t = c["terrains"].get(primary, {})
    return {
        "terrains": terrains, "primary": primary, "primary_name": t.get("name", primary),
        "zone_name": zone_names.get(primary), "terrain_desc": t.get("description", ""),
        "powers": powers, "power_infl": power_infl, "stat_mods": stat_mods,
        "buildings": buildings, "night": is_night(),
    }


# --------------------------------------------------------------------------- OpenStreetMap
OSM_RULES = [
    # (klucz, wartość, warstwa, rodzaj, promień, siła)
    ("amenity", "place_of_worship", "power", "swiatynia", 170, 1.0),
    ("landuse", "cemetery", "power", "cmentarz", 220, 1.1),
    ("amenity", "grave_yard", "power", "cmentarz", 200, 1.0),
    ("historic", "wayside_cross", "power", "rozstaje", 110, 0.7),
    ("historic", "wayside_shrine", "power", "rozstaje", 110, 0.7),
    ("historic", "archaeological_site", "power", "kurhan", 200, 1.0),
    ("historic", "battlefield", "power", "pobojowisko", 300, 1.2),
    ("natural", "spring", "power", "zrodlo", 130, 1.0),
    ("historic", "ruins", "building", "ruiny", 0, 1),
    ("historic", "castle", "building", "ruiny", 0, 1),
    ("amenity", "pub", "building", "karczma", 0, 1),
    ("amenity", "library", "building", "biblioteka", 0, 1),
    ("amenity", "pharmacy", "building", "chata_zielarki", 0, 1),
    ("amenity", "police", "building", "straznica", 0, 1),
    ("amenity", "monastery", "building", "klasztor", 0, 1),
    ("building", "monastery", "building", "klasztor", 0, 1),
    ("craft", "blacksmith", "building", "kuznia", 0, 1),
    ("landuse", "forest", "zone", "las", 320, 1),
    ("natural", "wood", "zone", "las", 280, 1),
    ("natural", "wetland", "zone", "bagno", 220, 1),
    ("landuse", "meadow", "zone", "laka", 200, 1),
    ("landuse", "farmland", "zone", "pole", 280, 1),
    ("natural", "peak", "zone", "gory", 350, 1),
    ("natural", "water", "zone", "rzeka", 220, 1),
]

_osm_running = set()


def _osm_query(s, w, n, e):
    b = f"({s},{w},{n},{e})"
    return f"""[out:json][timeout:25];
(
 nwr["amenity"~"^(place_of_worship|grave_yard|pub|library|pharmacy|police|monastery)$"]{b};
 nwr["landuse"~"^(cemetery|forest|meadow|farmland)$"]{b};
 nwr["historic"~"^(ruins|castle|wayside_cross|wayside_shrine|archaeological_site|battlefield)$"]{b};
 nwr["natural"~"^(spring|wood|water|wetland|peak)$"]{b};
 nwr["craft"="blacksmith"]{b};
 nwr["building"="monastery"]{b};
);
out center 600;"""


def _osm_worker(cell, s, w, n, e):
    conn = dbm.connect()
    ok = 0
    try:
        data = urllib.parse.urlencode({"data": _osm_query(s, w, n, e)}).encode()
        req = urllib.request.Request(config.OSM_URL, data=data,
                                     headers={"User-Agent": f"{config.GAME_NAME} (gra edukacyjna)"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
        counts = {"zone": 0, "power": 0, "building": 0}
        limits = {"zone": 80, "power": 60, "building": 30}
        for el in payload.get("elements", []):
            tags = el.get("tags") or {}
            lat = el.get("lat") or (el.get("center") or {}).get("lat")
            lng = el.get("lon") or (el.get("center") or {}).get("lon")
            if lat is None or lng is None:
                continue
            for k, v, layer, kind, radius, strength in OSM_RULES:
                if tags.get(k) != v:
                    continue
                if layer == "zone" and kind == "rzeka" and tags.get("water") in ("lake", "reservoir", "pond", "lagoon"):
                    kind = "morze"
                if counts[layer] >= limits[layer]:
                    break
                counts[layer] += 1
                name = tags.get("name") or ""
                conn.execute(
                    "INSERT OR IGNORE INTO places(layer,kind,name,lat,lng,radius,strength,description,source,ext_id) "
                    "VALUES (?,?,?,?,?,?,?,?,?,?)",
                    (layer, kind, name, lat, lng, radius or config.INTERACT_RADIUS_M, strength,
                     "", "osm", f"osm:{el.get('type')}/{el.get('id')}"))
                break
        ok = 1
    except Exception as exc:  # brak sieci, limit Overpass itp. — gra działa dalej na generatorze
        print(f"[navia] OSM {cell}: {exc}")
    finally:
        conn.execute("INSERT OR REPLACE INTO osm_cells(cell, fetched_at, ok) VALUES (?,?,?)", (cell, time.time(), ok))
        conn.commit()
        conn.close()
        _osm_running.discard(cell)
        if ok:
            dbm.bump_content()


def ensure_osm(lat, lng):
    if not config.USE_OSM:
        return
    ox, oy = math.floor(lat / config.OSM_CELL), math.floor(lng / config.OSM_CELL)
    cell = f"{ox}:{oy}"
    if cell in _osm_running:
        return
    row = query("SELECT fetched_at, ok FROM osm_cells WHERE cell=?", (cell,), one=True)
    if row and (row["ok"] or time.time() - row["fetched_at"] < 3600):
        return  # pobrane albo niedawna porażka — spróbujemy za godzinę
    _osm_running.add(cell)
    s, w = ox * config.OSM_CELL, oy * config.OSM_CELL
    threading.Thread(target=_osm_worker, args=(cell, s, w, s + config.OSM_CELL, w + config.OSM_CELL),
                     daemon=True).start()
