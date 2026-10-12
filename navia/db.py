"""Warstwa bazy danych.

Lokalnie gra używa pliku SQLite (instance/navia.db). Gdy ustawiona jest zmienna
DATABASE_URL (np. baza Postgres na Render), ta sama logika działa na PostgreSQL —
zapytania pisane w stylu SQLite są tłumaczone automatycznie.
"""
import json
import os
import queue
import re
import sqlite3
import threading
import time

from flask import g

from . import config

# Pola przechowywane jako JSON w poszczególnych tabelach treści.
JSON_FIELDS = {
    "items": ["effects", "repair_cost"],
    "recipes": ["ingredients", "tools", "catalysts"],
    "monsters": ["weaknesses", "loot", "moves"],
    "events": ["terrain_mods", "power_mods", "outcome"],
    "gather_actions": ["loot"],
    "terrains": ["names"],
    "power_kinds": ["stat_mods", "names"],
    "building_types": ["actions", "shop", "teaches", "search_loot", "names"],
    "places": [],
    "characters": ["stats", "mutations", "effects", "cooldowns", "combat", "contracts"],
}

CONTENT_TABLES = ["items", "recipes", "monsters", "events", "gather_actions",
                  "terrains", "power_kinds", "building_types"]
# Tabele z danymi graczy (pełna kopia zapasowa).
PLAYER_TABLES = ["users", "characters", "inventory", "known_recipes", "journal",
                 "camps", "structures", "base_guests", "merchants", "merchant_stock"]

IS_PG = bool(config.DATABASE_URL)
BACKEND = "postgres" if IS_PG else "sqlite"

_content_cache = {"version": 0, "data": None}
_lock = threading.Lock()


# =========================================================================== PostgreSQL
# Klucze główne (potrzebne do INSERT OR REPLACE → ON CONFLICT ... DO UPDATE).
PRIMARY_KEYS = {
    "characters": "user_id", "inventory": "user_id,item_id", "known_recipes": "user_id,recipe_id",
    "base_guests": "owner_id,guest_id", "osm_cells": "cell", "sessions": "token",
    "merchant_stock": "merchant_id,item_id",
}
SERIAL_TABLES = {"users", "journal", "places", "camps", "structures", "merchants"}

_RE_OR_IGNORE = re.compile(r"^\s*INSERT\s+OR\s+IGNORE\s+INTO", re.I)
_RE_OR_REPLACE = re.compile(r"^\s*INSERT\s+OR\s+REPLACE\s+INTO\s+(\w+)\s*\(([^)]*)\)", re.I)
_RE_INSERT = re.compile(r"^\s*INSERT\s+INTO\s+(\w+)", re.I)


def translate_sql(sql):
    """Tłumaczy zapytanie w dialekcie SQLite na PostgreSQL. Zwraca (sql, czy_returning_id)."""
    s = sql.strip().rstrip(";")
    tail = ""
    m = _RE_OR_REPLACE.match(s)
    if m:
        table, cols = m.group(1), [c.strip() for c in m.group(2).split(",")]
        pk = PRIMARY_KEYS.get(table, "id")
        pk_cols = [c.strip() for c in pk.split(",")]
        upd = [c for c in cols if c not in pk_cols]
        s = re.sub(r"^\s*INSERT\s+OR\s+REPLACE\s+INTO", "INSERT INTO", s, flags=re.I)
        tail = f" ON CONFLICT ({pk}) DO " + (
            "UPDATE SET " + ", ".join(f"{c}=EXCLUDED.{c}" for c in upd) if upd else "NOTHING")
    elif _RE_OR_IGNORE.match(s):
        s = _RE_OR_IGNORE.sub("INSERT INTO", s)
        tail = " ON CONFLICT DO NOTHING"
    returning = False
    mi = _RE_INSERT.match(s)
    if mi and mi.group(1).lower() in SERIAL_TABLES and "RETURNING" not in s.upper():
        tail += " RETURNING id"
        returning = True
    s = s.replace("?", "%s")
    return s + tail, returning


class Row(dict):
    """Wiersz dostępny zarówno po nazwie kolumny, jak i po numerze (jak sqlite3.Row)."""

    def __getitem__(self, k):
        if isinstance(k, int):
            return list(self.values())[k]
        return super().__getitem__(k)


class Result:
    def __init__(self, rows, lastrowid=None):
        self.rows = rows
        self.lastrowid = lastrowid

    def fetchall(self):
        return self.rows

    def fetchone(self):
        return self.rows[0] if self.rows else None

    def __iter__(self):
        return iter(self.rows)


class PgConn:
    """Opakowanie połączenia psycopg udające interfejs sqlite3."""

    def __init__(self):
        self.raw = self._open()

    @staticmethod
    def _open():
        import psycopg
        conn = psycopg.connect(config.DATABASE_URL, autocommit=True, connect_timeout=15)
        # własny schemat = tabele gry nie mieszają się z innymi projektami w tej samej bazie
        schema = re.sub(r"[^a-z0-9_]", "", config.DB_SCHEMA.lower()) or "navia"
        conn.execute(f"CREATE SCHEMA IF NOT EXISTS {schema}")
        conn.execute(f"SET search_path TO {schema}")
        return conn

    @property
    def healthy(self):
        return not (getattr(self.raw, "closed", False) or getattr(self.raw, "broken", False))

    def execute(self, sql, args=()):
        q, returning = translate_sql(sql)
        params = tuple(args) if args else None
        try:
            cur = self.raw.execute(q, params)
        except Exception as exc:  # zerwane połączenie (np. restart bazy) — jedna próba ponowienia
            if self.healthy:
                raise
            print(f"[navia] ponowne łączenie z bazą: {exc}")
            self.raw = self._open()
            cur = self.raw.execute(q, params)
        rows = []
        if cur.description:
            cols = [d.name for d in cur.description]
            rows = [Row(zip(cols, r)) for r in cur.fetchall()]
        last = rows[0]["id"] if returning and rows else None
        return Result(rows, last)

    def executescript(self, script):
        self.raw.execute(script)

    def commit(self):
        pass  # autocommit

    def close(self):
        try:
            self.raw.close()
        except Exception:
            pass


def _pg_schema(sqlite_schema):
    s = sqlite_schema
    s = re.sub(r"INTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT", "SERIAL PRIMARY KEY", s, flags=re.I)
    s = re.sub(r"\bREAL\b", "DOUBLE PRECISION", s)
    s = re.sub(r"\s+COLLATE\s+NOCASE", "", s, flags=re.I)
    s += "\nCREATE UNIQUE INDEX IF NOT EXISTS users_lower_name ON users (LOWER(username));\n"
    return s


_pool = queue.LifoQueue(maxsize=10)


# =========================================================================== wspólne
def connect():
    if IS_PG:
        return PgConn()
    os.makedirs(os.path.dirname(config.DB_PATH), exist_ok=True)
    conn = sqlite3.connect(config.DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def get_db():
    if "db" not in g:
        conn = None
        if IS_PG:
            try:
                conn = _pool.get_nowait()
                if not conn.healthy:
                    conn.close()
                    conn = None
            except queue.Empty:
                conn = None
        g.db = conn or connect()
    return g.db


def close_db(_exc=None):
    db = g.pop("db", None)
    if db is None:
        return
    if IS_PG and db.healthy:
        try:
            _pool.put_nowait(db)
            return
        except queue.Full:
            pass
    db.close()


def row_to_dict(row, table=None):
    if row is None:
        return None
    d = dict(row)
    for f in JSON_FIELDS.get(table, []):
        if f in d:
            d[f] = loads(d[f])
    return d


def loads(v, default=None):
    if v is None or v == "":
        return default
    if isinstance(v, (dict, list)):
        return v
    try:
        return json.loads(v)
    except (TypeError, ValueError):
        return default


def dumps(v):
    return json.dumps(v, ensure_ascii=False)


def query(sql, args=(), table=None, one=False):
    cur = get_db().execute(sql, args)
    rows = cur.fetchall()
    out = [row_to_dict(r, table) for r in rows]
    return (out[0] if out else None) if one else out


def execute(sql, args=()):
    db = get_db()
    cur = db.execute(sql, args)
    db.commit()
    return cur


def table_columns(table):
    if IS_PG:
        rows = get_db().execute("SELECT column_name AS name FROM information_schema.columns "
                                "WHERE table_name=? AND table_schema=current_schema() ORDER BY ordinal_position", (table,)).fetchall()
    else:
        rows = get_db().execute(f"PRAGMA table_info({table})").fetchall()
    return [r["name"] for r in rows]


def upsert(table, data, bump=True):
    """Wstawia lub nadpisuje rekord (panel admina, seed, import kopii)."""
    cols = table_columns(table)
    data = {k: v for k, v in data.items() if k in cols}
    for f in JSON_FIELDS.get(table, []):
        if f in data and data[f] is not None and not isinstance(data[f], str):
            data[f] = dumps(data[f])
    keys = list(data.keys())
    sql = (f"INSERT OR REPLACE INTO {table} ({','.join(keys)}) "
           f"VALUES ({','.join('?' for _ in keys)})")
    cur = execute(sql, [data[k] for k in keys])
    if bump:
        bump_content()
    return cur


def fix_sequences():
    """Po imporcie z jawnymi id ustawia liczniki SERIAL w Postgresie."""
    if not IS_PG:
        return
    for t in SERIAL_TABLES:
        execute(f"SELECT setval(pg_get_serial_sequence('{t}', 'id'), COALESCE((SELECT MAX(id) FROM {t}), 0) + 1, false)")


def bump_content():
    with _lock:
        _content_cache["version"] += 1
        _content_cache["data"] = None


def content():
    """Cała treść gry (przedmioty, receptury, potwory...) jako słowniki — z cache."""
    with _lock:
        if _content_cache["data"] is not None:
            return _content_cache["data"]
    data = {}
    for t in CONTENT_TABLES:
        rows = query(f"SELECT * FROM {t}", table=t)
        data[t] = {r["id"]: r for r in rows}
    data["version"] = _content_cache["version"]
    with _lock:
        _content_cache["data"] = data
    return data


def content_version():
    return _content_cache["version"]


# Nowe kolumny w istniejących bazach (aktualizacje gry): (tabela, kolumna, typ z wartością domyślną)
MIGRATIONS = [
    ("items", "area_radius", "REAL DEFAULT 18"),
]


def migrate():
    for table, col, typ in MIGRATIONS:
        if col not in table_columns(table):
            if IS_PG:
                typ = re.sub(r"\bREAL\b", "DOUBLE PRECISION", typ)
            get_db().execute(f"ALTER TABLE {table} ADD COLUMN {col} {typ}")
            get_db().commit()
            print(f"[navia] Migracja: dodano kolumnę {table}.{col}")


def init_db(app):
    with app.app_context():
        db = get_db()
        with open(os.path.join(os.path.dirname(__file__), "schema.sql"), encoding="utf-8") as f:
            schema = f.read()
        db.executescript(_pg_schema(schema) if IS_PG else schema)
        db.commit()
        migrate()
        empty = db.execute("SELECT COUNT(*) FROM items").fetchone()[0] == 0
        if empty:
            from .seed import seed_all
            seed_all()
            print("[navia] Zasiano treść gry (przedmioty, receptury, potwory, zdarzenia).")
        else:
            from .seed import seed_missing
            n = seed_missing()
            if n:
                print(f"[navia] Dodano {n} nowych elementów treści z aktualizacji gry.")
        bump_content()
        ensure_admin()
        print(f"[navia] Baza danych: {BACKEND}")


def ensure_admin():
    """Zakłada konto admina z config.py, a istniejącemu nadaje uprawnienia admina."""
    if not config.ADMIN_USERNAME:
        return
    from werkzeug.security import generate_password_hash
    db = get_db()
    row = db.execute("SELECT id FROM users WHERE LOWER(username)=LOWER(?)", (config.ADMIN_USERNAME,)).fetchone()
    if row:
        db.execute("UPDATE users SET is_admin=1 WHERE id=?", (row["id"],))
        db.commit()
        return
    cur = db.execute("INSERT INTO users(username, pass_hash, is_admin, created_at) VALUES (?,?,1,?)",
                     (config.ADMIN_USERNAME, generate_password_hash(config.ADMIN_PASSWORD), time.time()))
    db.commit()
    from .character import create
    create(cur.lastrowid, config.ADMIN_USERNAME)
    print(f"[navia] Utworzono konto admina: {config.ADMIN_USERNAME}")


def now():
    return time.time()
