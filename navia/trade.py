"""Kramy graczy: każdy łowca może postawić kupca, opłacić go za kilka dni z własnej
kieszeni i wystawić towar z torby. Inni gracze kupują na miejscu, a pieniądze trafiają
do szkatuły kramu, którą właściciel odbiera."""
import time

from . import character as chm
from . import config
from .character import GameError
from .db import content, execute, query
from .world import dist_m

DAY = 24 * 3600


def _active(m, t=None):
    t = t or time.time()
    return not m["closed"] and (m["paid_until"] or 0) > t


def _stock(mid):
    c = content()["items"]
    out = []
    for r in query("SELECT item_id, qty, price FROM merchant_stock WHERE merchant_id=? AND qty>0 ORDER BY item_id", (mid,)):
        it = c.get(r["item_id"])
        if it:
            out.append({"item": r["item_id"], "qty": r["qty"], "price": r["price"], "name": it["name"],
                        "glyph": it["glyph"], "description": it["description"], "rarity": it["rarity"]})
    return out


def view(m, viewer_id=None, with_stock=True):
    t = time.time()
    v = {"id": m["id"], "name": m["name"], "owner": m["owner_name"], "lat": m["lat"], "lng": m["lng"],
         "active": _active(m, t), "left_h": round(max(0, (m["paid_until"] or 0) - t) / 3600, 1),
         "own": viewer_id == m["owner_id"]}
    if with_stock:
        v["stock"] = _stock(m["id"])
    if v["own"]:
        v["till"] = m["till"]
    return v


def merchants_near(lat, lng, radius, viewer_id=None, with_stock=True):
    rows = query("SELECT * FROM merchants WHERE closed=0 AND paid_until>?", (time.time(),))
    out = [view(m, viewer_id, with_stock) for m in rows if dist_m(lat, lng, m["lat"], m["lng"]) <= radius]
    out.sort(key=lambda x: dist_m(lat, lng, x["lat"], x["lng"]))
    return out


def get(mid):
    m = query("SELECT * FROM merchants WHERE id=?", (int(mid),), one=True)
    if not m:
        raise GameError("Nie ma takiego kramu.")
    return m


def mine(uid):
    return [view(m, uid) for m in query("SELECT * FROM merchants WHERE owner_id=? AND closed=0 ORDER BY id", (uid,))]


def _near(ch, m, what="kramu"):
    d = dist_m(ch["lat"], ch["lng"], m["lat"], m["lng"])
    if d > config.INTERACT_RADIUS_M + 5:
        raise GameError(f"Jesteś za daleko od {what} ({int(d)} m).")


def _own(ch, mid):
    m = get(mid)
    if m["owner_id"] != ch["user_id"]:
        raise GameError("To nie twój kram.")
    return m


def _pay(ch, cost):
    if ch["coins"] < cost:
        raise GameError(f"Brakuje ci pieniędzy (masz {chm.money(ch['coins'])}, potrzeba {chm.money(cost)}).")
    ch["coins"] -= cost


# --------------------------------------------------------------------------- akcje właściciela
def create(ch, name, days):
    days = max(1, min(config.MERCHANT_MAX_DAYS, int(days or 1)))
    if len(mine(ch["user_id"])) >= config.MERCHANTS_PER_PLAYER:
        raise GameError("Masz już kram. Zamknij go, zanim postawisz następny.")
    name = (name or "").strip()[:40] or f"Kram {ch['name']}"
    _pay(ch, config.MERCHANT_DAY_COST * days)
    t = time.time()
    execute("INSERT INTO merchants(owner_id, owner_name, name, lat, lng, created_at, paid_until, till, closed) "
            "VALUES (?,?,?,?,?,?,?,0,0)", (ch["user_id"], ch["name"], name, ch["lat"], ch["lng"], t, t + days * DAY))
    dni = f"{days} {chm.plural(days, 'dzień', 'dni', 'dni')}"
    chm.journal(ch["user_id"], "trade", f"Najmujesz kupca i stawiasz kram „{name}” na {dni}.")
    return f"Kupiec rozkłada kram „{name}”. Opłacony na {dni} ({chm.money(config.MERCHANT_DAY_COST * days)})."


def extend(ch, mid, days):
    m = _own(ch, mid)
    days = max(1, min(config.MERCHANT_MAX_DAYS, int(days or 1)))
    _pay(ch, config.MERCHANT_DAY_COST * days)
    base = max(time.time(), m["paid_until"] or 0)
    new = min(time.time() + config.MERCHANT_MAX_DAYS * DAY, base + days * DAY)
    execute("UPDATE merchants SET paid_until=? WHERE id=?", (new, m["id"]))
    return f"Kupiec zostaje na dłużej (+{days} {chm.plural(days, 'dzień', 'dni', 'dni')})."


def stock_add(ch, mid, item, qty, price):
    m = _own(ch, mid)
    if not _active(m):
        raise GameError("Kupiec odszedł — opłać kolejne dni, żeby znów handlował.")
    _near(ch, m)
    it = content()["items"].get(item)
    if not it:
        raise GameError("Nieznany przedmiot.")
    qty, price = int(qty), int(price)
    if qty < 1 or price < 1:
        raise GameError("Podaj ilość i cenę.")
    rows = query("SELECT item_id FROM merchant_stock WHERE merchant_id=?", (m["id"],))
    if item not in {r["item_id"] for r in rows} and len(rows) >= config.MERCHANT_MAX_STOCK:
        raise GameError(f"Na kramie zmieści się najwyżej {config.MERCHANT_MAX_STOCK} rodzajów towaru.")
    chm.remove_item(ch["user_id"], item, qty)
    execute("INSERT INTO merchant_stock(merchant_id, item_id, qty, price) VALUES (?,?,?,?) "
            "ON CONFLICT(merchant_id, item_id) DO UPDATE SET qty=merchant_stock.qty+excluded.qty, price=excluded.price",
            (m["id"], item, qty, price))
    return f"Wykładasz na kram: {it['name']} ×{qty} po {chm.money(price)}."


def stock_remove(ch, mid, item):
    m = _own(ch, mid)
    r = query("SELECT qty FROM merchant_stock WHERE merchant_id=? AND item_id=?", (m["id"], item), one=True)
    if not r:
        raise GameError("Tego nie ma na kramie.")
    execute("DELETE FROM merchant_stock WHERE merchant_id=? AND item_id=?", (m["id"], item))
    chm.add_item(ch["user_id"], item, r["qty"])
    return "Zdejmujesz towar z kramu do torby."


def collect(ch, mid):
    m = _own(ch, mid)
    till = m["till"] or 0
    if till <= 0:
        raise GameError("Szkatuła jest pusta.")
    execute("UPDATE merchants SET till=0 WHERE id=?", (m["id"],))
    ch["coins"] += till
    return f"Kupiec oddaje ci utarg: {chm.money(till)}."


def close(ch, mid):
    m = _own(ch, mid)
    for r in query("SELECT item_id, qty FROM merchant_stock WHERE merchant_id=?", (m["id"],)):
        chm.add_item(ch["user_id"], r["item_id"], r["qty"])
    execute("DELETE FROM merchant_stock WHERE merchant_id=?", (m["id"],))
    ch["coins"] += m["till"] or 0
    execute("UPDATE merchants SET closed=1, till=0 WHERE id=?", (m["id"],))
    return "Kupiec zwija kram. Niesprzedany towar i utarg wracają do ciebie."


# --------------------------------------------------------------------------- kupowanie
def buy(ch, mid, item, qty):
    m = get(mid)
    if not _active(m):
        raise GameError("Ten kram jest zamknięty.")
    if m["owner_id"] == ch["user_id"]:
        raise GameError("Nie kupisz od samego siebie — zdejmij towar z kramu.")
    _near(ch, m)
    qty = max(1, int(qty or 1))
    r = query("SELECT qty, price FROM merchant_stock WHERE merchant_id=? AND item_id=?", (m["id"], item), one=True)
    if not r or r["qty"] < qty:
        raise GameError("Kupiec nie ma tyle towaru.")
    cost = r["price"] * qty
    _pay(ch, cost)
    execute("UPDATE merchant_stock SET qty=qty-? WHERE merchant_id=? AND item_id=?", (qty, m["id"], item))
    execute("DELETE FROM merchant_stock WHERE merchant_id=? AND qty<=0", (m["id"],))
    execute("UPDATE merchants SET till=till+? WHERE id=?", (cost, m["id"]))
    chm.add_item(ch["user_id"], item, qty)
    name = content()["items"].get(item, {}).get("name", item)
    chm.journal(m["owner_id"], "trade", f"{ch['name']} kupił na twoim kramie: {name} ×{qty} za {chm.money(cost)}.")
    return f"Kupujesz od kupca {m['owner_name']}: {name} ×{qty} za {chm.money(cost)}."
