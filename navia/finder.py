"""Tropiciel: dla wybranego przedmiotu szuka w okolicy, gdzie go zdobyć —
zbieractwo, eksploracja (zdarzenia i łupy z potworów), sklepy w budynkach,
targowiska, kramy graczy oraz receptury."""
from . import character as chm
from . import trade
from .db import content
from .explore import probabilities
from .world import context_at, dist_m, places_around

SEARCH_CELLS = 4          # ok. 4 × 6 km wokół gracza


def _toward(lat, lng, p, radius):
    """Punkt docelowy: wnętrze obszaru najbliżej gracza (nie trzeba iść do samego środka)."""
    d = dist_m(lat, lng, p["lat"], p["lng"])
    if d <= radius * 0.7:
        return lat, lng, 0
    f = (d - radius * 0.6) / d
    tl = lat + (p["lat"] - lat) * f
    tg = lng + (p["lng"] - lng) * f
    return tl, tg, dist_m(lat, lng, tl, tg)


def _nearest(lat, lng, places, kinds):
    best = None
    for p in places:
        if p["kind"] in kinds:
            tl, tg, d = _toward(lat, lng, p, p.get("radius") or 0)
            if best is None or d < best[3]:
                best = (p, tl, tg, d)
    return best


def _event_sources(item_id, c):
    """Zdarzenia eksploracji, które mogą dać przedmiot: (event, opis, szansa_na_przedmiot)."""
    monsters_with = {m["id"]: l for m in c["monsters"].values() for l in (m.get("loot") or []) if l["item"] == item_id}
    out = []
    for ev in c["events"].values():
        if not ev.get("enabled", 1):
            continue
        o = ev.get("outcome") or {}
        if ev["kind"] == "item" and ev.get("ref") == item_id:
            out.append((ev, "znalezisko podczas eksploracji", 1.0, None))
        elif ev["kind"] == "monster" and ev.get("ref") in monsters_with:
            m = c["monsters"][ev["ref"]]
            out.append((ev, f"łup z potwora: {m['name']}", monsters_with[m["id"]].get("chance", 0.5), m))
        else:
            items = list(o.get("items") or [])
            for br in o.get("branches") or []:
                items += br.get("items") or []
                if br.get("monster") in monsters_with:
                    m = c["monsters"][br["monster"]]
                    out.append((ev, f"zdarzenie „{ev['name']}”, potem walka: {m['name']}", 0.3, m))
            if any(i.get("item") == item_id for i in items):
                out.append((ev, f"zdarzenie „{ev['name']}”", 0.5, None))
    return out


def find(ch, item_id):
    c = content()
    it = c["items"].get(item_id)
    if not it:
        return {"item": None, "leads": [], "recipes": []}
    lat, lng = ch["lat"], ch["lng"]
    pl = places_around(lat, lng, cells=SEARCH_CELLS)
    leads = []

    def add(kind, title, detail, tl, tg, d, place_name="", glyph="", **extra):
        leads.append({"type": kind, "title": title, "detail": detail, "lat": tl, "lng": tg, "dist": round(d),
                      "place": place_name, "glyph": glyph, **extra})

    # 1. zbieractwo
    for g in c["gather_actions"].values():
        if not g.get("enabled", 1):
            continue
        loot = next((l for l in g.get("loot") or [] if l["item"] == item_id), None)
        if not loot:
            continue
        tool = c["items"].get(g.get("tool") or "", {}).get("name")
        detail = f"{g['name']} — szansa {round(loot.get('chance', 1) * 100)}%" + (f", potrzebne: {tool}" if tool else "")
        t = g.get("terrain") or "*"
        if t == "*":
            add("gather", g["name"], detail, lat, lng, 0, "wszędzie", "⛏")
        elif t.startswith("power:"):
            k = t.split(":", 1)[1]
            best = _nearest(lat, lng, pl["power"], {k})
            if best:
                p, tl, tg, d = best
                kn = c["power_kinds"].get(k, {})
                add("gather", g["name"], detail, tl, tg, d, p.get("name") or kn.get("name", k), kn.get("glyph", "✶"))
        else:
            best = _nearest(lat, lng, pl["zones"], {t})
            if best:
                p, tl, tg, d = best
                tn = c["terrains"].get(t, {})
                add("gather", g["name"], detail, tl, tg, d, f"{tn.get('name', t)} · {p.get('name') or ''}".strip(" ·"), "⛏")

    # 2. eksploracja (zdarzenia i potwory)
    for ev, desc, chance, monster in _event_sources(item_id, c):
        tm = {k: v for k, v in (ev.get("terrain_mods") or {}).items() if float(v) > 1}
        pm = {k: v for k, v in (ev.get("power_mods") or {}).items() if float(v) > 1}
        best = None  # (wynik, p, tl, tg, d, nazwa)
        for p in pl["zones"]:
            if p["kind"] in tm:
                tl, tg, d = _toward(lat, lng, p, p.get("radius") or 0)
                score = (d + 50) / float(tm[p["kind"]])
                if best is None or score < best[0]:
                    best = (score, p, tl, tg, d, f"{c['terrains'].get(p['kind'], {}).get('name', p['kind'])} · {p.get('name') or ''}".strip(" ·"))
        for p in pl["power"]:
            if p["kind"] in pm:
                tl, tg, d = _toward(lat, lng, p, (p.get("radius") or 0) * 0.5)
                score = (d + 50) / float(pm[p["kind"]])
                if best is None or score < best[0]:
                    best = (score, p, tl, tg, d, p.get("name") or c["power_kinds"].get(p["kind"], {}).get("name", p["kind"]))
        if best:
            _, p, tl, tg, d, pname = best
        elif (ev.get("other_terrain") if ev.get("other_terrain") is not None else 1) > 0 and not tm:
            tl, tg, d, pname = lat, lng, 0, "dowolne miejsce"
        else:
            continue
        kind = "hunt" if monster else "explore"
        title = f"Poluj: {monster['name']}" if monster else f"Eksploruj: {ev['name']}"
        add(kind, title, desc + (f" (łup {round(chance * 100)}%)" if monster else ""), tl, tg, d, pname,
            monster["glyph"] if monster else "👁", event=ev["id"],
            night=(ev.get("night_mult", 1) > 1.5), day_only=(ev.get("night_mult", 1) < 0.2))

    # 3. sklepy w budynkach i przeszukiwanie (ruiny, groby)
    for b in pl["buildings"]:
        bt = c["building_types"].get(b["kind"])
        if not bt:
            continue
        d = dist_m(lat, lng, b["lat"], b["lng"])
        shop = next((s for s in bt.get("shop") or [] if s["item"] == item_id), None)
        if shop:
            add("shop", f"Kup: {bt['name']}", f"{b.get('name') or bt['name']} sprzedaje {it['name']} — {chm.money(shop['price'])}",
                b["lat"], b["lng"], d, b.get("name") or bt["name"], bt["glyph"], price=shop["price"], building=b["id"])
        if any(l["item"] == item_id for l in bt.get("search_loot") or []):
            l = next(l for l in bt["search_loot"] if l["item"] == item_id)
            add("search", f"Przeszukaj: {bt['name']}", f"przy przeszukiwaniu — szansa {round(l.get('chance', 0.5) * 100)}%, bywa groźnie",
                b["lat"], b["lng"], d, b.get("name") or bt["name"], bt["glyph"], building=b["id"])
        for a in bt.get("actions") or []:
            if a["type"] == "market":
                from .places import market_stock
                entry = next((s for s in market_stock(b["id"], a) if s["item"] == item_id), None)
                if entry:
                    add("market", "Targowisko", f"dziś ma to {entry['trader'].lower()} — {chm.money(entry['price'])}",
                        b["lat"], b["lng"], d, b.get("name") or bt["name"], bt["glyph"], price=entry["price"], building=b["id"])

    # 4. kramy graczy
    for m in trade.merchants_near(lat, lng, 6000, viewer_id=ch["user_id"]):
        s = next((s for s in m["stock"] if s["item"] == item_id), None)
        if s and not m["own"]:
            add("stall", f"Kram: {m['name']}", f"kupiec {m['owner']} ma {s['qty']} szt. po {chm.money(s['price'])}",
                m["lat"], m["lng"], dist_m(lat, lng, m["lat"], m["lng"]), m["name"], "🧺", price=s["price"], merchant=m["id"])

    # najlepszy trop każdego rodzaju i źródła, potem po odległości
    seen, uniq = set(), []
    for l in sorted(leads, key=lambda x: x["dist"]):
        key = (l["type"], l["title"])
        if key not in seen:
            seen.add(key)
            uniq.append(l)
    uniq = uniq[:8]

    # przybliżona szansa na zdarzenie w miejscu docelowym
    for l in uniq:
        if l.get("event"):
            try:
                ctx = context_at(l["lat"], l["lng"])
                probs = probabilities(ctx["terrains"], ctx["power_infl"], ctx["night"], ch["level"])
                l["pct"] = next((p["pct"] for p in probs if p["id"] == l["event"]), None)
            except Exception:  # bez szansy — nie szkodzi
                l["pct"] = None

    recipes = [{"id": r["id"], "name": r["name"]} for r in c["recipes"].values()
               if r.get("result_item") == item_id and r.get("enabled", 1)]
    return {"item": {"id": it["id"], "name": it["name"], "glyph": it["glyph"], "description": it["description"]},
            "leads": uniq, "recipes": recipes}
