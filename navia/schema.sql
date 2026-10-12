-- Schemat bazy danych gry. Pola z JSON-em trzymane są jako TEXT.

CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL COLLATE NOCASE,
  pass_hash TEXT NOT NULL,
  is_admin INTEGER DEFAULT 0,
  created_at REAL
);

CREATE TABLE IF NOT EXISTS sessions(
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at REAL
);

CREATE TABLE IF NOT EXISTS characters(
  user_id INTEGER PRIMARY KEY,
  name TEXT,
  level INTEGER DEFAULT 1,
  xp INTEGER DEFAULT 0,
  stat_points INTEGER DEFAULT 0,
  hp REAL, vigor REAL, toxicity REAL DEFAULT 0,
  energy REAL DEFAULT 50,
  coins INTEGER DEFAULT 30,
  stats TEXT,
  mutations TEXT DEFAULT '[]',
  effects TEXT DEFAULT '[]',
  cooldowns TEXT DEFAULT '{}',
  combat TEXT,
  contracts TEXT DEFAULT '[]',
  lat REAL, lng REAL,
  home_lat REAL, home_lng REAL, home_set_at REAL,
  last_tick REAL, last_seen REAL, last_move REAL
);

CREATE TABLE IF NOT EXISTS inventory(
  user_id INTEGER, item_id TEXT, qty INTEGER,
  PRIMARY KEY(user_id, item_id)
);

CREATE TABLE IF NOT EXISTS known_recipes(
  user_id INTEGER, recipe_id TEXT,
  PRIMARY KEY(user_id, recipe_id)
);

CREATE TABLE IF NOT EXISTS journal(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER, ts REAL, kind TEXT, text TEXT
);

-- ===== Treści konfigurowane w panelu admina =====

CREATE TABLE IF NOT EXISTS items(
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT DEFAULT 'inne',
  rarity TEXT DEFAULT 'pospolity',
  glyph TEXT DEFAULT '•',
  description TEXT DEFAULT '',
  value INTEGER DEFAULT 1,
  usable INTEGER DEFAULT 0,
  effects TEXT DEFAULT '{}',
  is_tool INTEGER DEFAULT 0,
  tool_bonus REAL DEFAULT 0,
  catalyst_bonus REAL DEFAULT 0,
  placeable INTEGER DEFAULT 0,
  max_durability REAL DEFAULT 0,
  area_radius REAL DEFAULT 18,
  decay_per_hour REAL DEFAULT 0,
  repair_cost TEXT DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS recipes(
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  result_item TEXT,
  result_qty INTEGER DEFAULT 1,
  ingredients TEXT DEFAULT '[]',
  tools TEXT DEFAULT '[]',
  tool_mode TEXT DEFAULT 'any',
  station TEXT DEFAULT 'any',
  base_chance REAL DEFAULT 60,
  skill_bonus REAL DEFAULT 2,
  catalysts TEXT DEFAULT '[]',
  fail_item TEXT,
  min_level INTEGER DEFAULT 1,
  xp INTEGER DEFAULT 10,
  known_by_default INTEGER DEFAULT 1,
  enabled INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS monsters(
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  glyph TEXT DEFAULT '☠',
  family TEXT DEFAULT 'bestia',
  level INTEGER DEFAULT 1,
  hp INTEGER DEFAULT 30,
  attack INTEGER DEFAULT 5,
  defense INTEGER DEFAULT 1,
  description TEXT DEFAULT '',
  lore TEXT DEFAULT '',
  intro TEXT DEFAULT '',
  weaknesses TEXT DEFAULT '[]',
  moves TEXT DEFAULT '[]',
  speed INTEGER DEFAULT 5,
  loot TEXT DEFAULT '[]',
  xp INTEGER DEFAULT 20,
  coins INTEGER DEFAULT 0,
  flee_chance REAL DEFAULT 50
);

CREATE TABLE IF NOT EXISTS events(
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT DEFAULT 'story',
  ref TEXT,
  text TEXT DEFAULT '',
  base_weight REAL DEFAULT 10,
  terrain_mods TEXT DEFAULT '{}',
  other_terrain REAL DEFAULT 1,
  power_mods TEXT DEFAULT '{}',
  night_mult REAL DEFAULT 1,
  day_mult REAL DEFAULT 1,
  min_level INTEGER DEFAULT 1,
  max_level INTEGER DEFAULT 99,
  outcome TEXT DEFAULT '{}',
  enabled INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS gather_actions(
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  terrain TEXT,
  tool TEXT,
  text TEXT DEFAULT '',
  loot TEXT DEFAULT '[]',
  cooldown_s INTEGER DEFAULT 30,
  vigor_cost REAL DEFAULT 4,
  enabled INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS terrains(
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT DEFAULT '#556644',
  description TEXT DEFAULT '',
  weight REAL DEFAULT 1,
  min_r INTEGER DEFAULT 120,
  max_r INTEGER DEFAULT 360,
  names TEXT DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS power_kinds(
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  glyph TEXT DEFAULT '✶',
  color TEXT DEFAULT '#8b1e1e',
  description TEXT DEFAULT '',
  stat_mods TEXT DEFAULT '{}',
  radius INTEGER DEFAULT 200,
  weight REAL DEFAULT 1,
  names TEXT DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS building_types(
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  glyph TEXT DEFAULT '⌂',
  description TEXT DEFAULT '',
  actions TEXT DEFAULT '[]',
  shop TEXT DEFAULT '[]',
  teaches TEXT DEFAULT '[]',
  search_loot TEXT DEFAULT '[]',
  weight REAL DEFAULT 1,
  names TEXT DEFAULT '[]'
);

-- Miejsca postawione ręcznie przez admina lub pobrane z OpenStreetMap.
-- layer: zone (kind = id terenu) | power (kind = id punktu mocy) | building (kind = id typu budynku)
CREATE TABLE IF NOT EXISTS places(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  layer TEXT NOT NULL,
  kind TEXT NOT NULL,
  name TEXT,
  lat REAL, lng REAL,
  radius REAL DEFAULT 150,
  strength REAL DEFAULT 1,
  description TEXT DEFAULT '',
  source TEXT DEFAULT 'admin',
  ext_id TEXT UNIQUE
);
CREATE INDEX IF NOT EXISTS places_geo ON places(lat, lng);

CREATE TABLE IF NOT EXISTS osm_cells(
  cell TEXT PRIMARY KEY, fetched_at REAL, ok INTEGER
);

-- ===== Świat graczy =====

CREATE TABLE IF NOT EXISTS camps(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER, owner_name TEXT, name TEXT,
  lat REAL, lng REAL, created_at REAL, expires_at REAL
);

CREATE TABLE IF NOT EXISTS structures(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER,
  item_id TEXT,
  site TEXT,            -- camp | base
  camp_id INTEGER,
  lat REAL, lng REAL,
  durability REAL,
  updated_at REAL
);

-- Kramy graczy: kupiec opłacany z kieszeni właściciela na określoną liczbę dni.
CREATE TABLE IF NOT EXISTS merchants(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER, owner_name TEXT, name TEXT,
  lat REAL, lng REAL, created_at REAL, paid_until REAL,
  till INTEGER DEFAULT 0, closed INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS merchant_stock(
  merchant_id INTEGER, item_id TEXT, qty INTEGER, price INTEGER,
  PRIMARY KEY(merchant_id, item_id)
);

CREATE TABLE IF NOT EXISTS base_guests(
  owner_id INTEGER, guest_id INTEGER,
  PRIMARY KEY(owner_id, guest_id)
);
