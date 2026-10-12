"""Główna konfiguracja gry. Zmień GAME_NAME, gdy wybierzesz ostateczny tytuł."""
import os

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

GAME_NAME = os.environ.get("NAVIA_NAME", "Cienie Navii")
GAME_SUBTITLE = "Kronika łowców zmierzchu"

# Ziarno świata — od niego zależy rozmieszczenie generowanych terenów, punktów mocy i budynków.
# Wszyscy gracze widzą ten sam świat, bo generator jest deterministyczny.
WORLD_SEED = os.environ.get("NAVIA_SEED", "navia-pierwsza-wiosna")

# Konto admina zakładane automatycznie przy starcie serwera (jeśli jeszcze nie istnieje).
# Przed publikacją gry w internecie zmień hasło (albo ustaw NAVIA_ADMIN_PASS).
ADMIN_USERNAME = os.environ.get("NAVIA_ADMIN_USER", "migu")
ADMIN_PASSWORD = os.environ.get("NAVIA_ADMIN_PASS") or "adminmigu"

DB_PATH = os.environ.get("NAVIA_DB", os.path.join(BASE_DIR, "instance", "navia.db"))

# Na Render (albo innym hostingu) ustaw DATABASE_URL — wtedy gra używa PostgreSQL zamiast pliku SQLite.
DATABASE_URL = os.environ.get("DATABASE_URL", "")
# Gra trzyma swoje tabele w osobnym schemacie, więc może dzielić bazę z innym projektem.
DB_SCHEMA = os.environ.get("NAVIA_DB_SCHEMA", "navia")

# Tryb debug: strzałki do zmiany pozycji, teleport kliknięciem, brak limitu prędkości.
DEBUG_MOVEMENT = os.environ.get("NAVIA_DEBUG", "1") == "1"

# Pozycja startowa, gdy przeglądarka nie poda GPS (Katowice, Rynek).
DEFAULT_START = (50.2590, 19.0213)

# Siatka generatora świata (stopnie). ~500 m x ~500 m na szerokości Polski.
CELL_LAT = 0.0045
CELL_LNG = 0.0070
VIEW_CELLS = 2            # ile komórek wokół gracza wysyłać na mapę

INTERACT_RADIUS_M = 70    # z jakiej odległości można korzystać z budynku
CAMP_RADIUS_M = 45        # zasięg obozu / bazy
CAMP_LIFETIME_H = 24      # ile godzin żyje nowy obóz
CAMP_MAX_H = 72
CAMP_COST = [{"item": "drewno", "qty": 4}]
CAMP_TOOL = "krzesiwo"
HOME_MOVE_COOLDOWN_H = 0 if DEBUG_MOVEMENT else 24 * 7

EXPLORE_COOLDOWN_S = 2 if DEBUG_MOVEMENT else 8

# Energia eksploracji: osobny zasób, odnawia się co godzinę.
ENERGY_MAX = 100
ENERGY_PER_HOUR = 10
ENERGY_START = 50

# Tryby eksploracji. cost = ile energii zużywa jedna eksploracja.
#   monster  – mnożnik szansy na potwora
#   strength – mnożnik siły potworów (HP / atak)
#   reward   – mnożnik łupów, monet i doświadczenia
#   rare     – mnożnik dla rzadkich zdarzeń (bazowa waga < 2)
EXPLORE_MODES = {
    "latwy":     {"name": "Łatwy",     "cost": 1, "monster": 0.5, "strength": 0.8,  "reward": 0.8, "rare": 0.5,
                  "desc": "Ostrożny marsz skrajem. Mniej potworów, słabsze łupy."},
    "normalny":  {"name": "Normalny",  "cost": 2, "monster": 1.0, "strength": 1.0,  "reward": 1.0, "rare": 1.0,
                  "desc": "Zwykły obchód okolicy."},
    "trudny":    {"name": "Trudny",    "cost": 3, "monster": 1.6, "strength": 1.35, "reward": 1.5, "rare": 1.6,
                  "desc": "Wchodzisz tam, gdzie inni nie chodzą. Silniejsze bestie, lepsze łupy."},
    "specjalny": {"name": "Specjalny", "cost": 5, "monster": 1.2, "strength": 1.2,  "reward": 2.0, "rare": 4.0,
                  "desc": "Wyprawa po rzadkie i legendarne. Dziwne rzeczy dzieją się częściej."},
}
MAX_SPEED_MS = 60         # anty-teleport poza trybem debug (m/s)

# Prawdziwe kościoły, cmentarze, ruiny, lasy itd. z OpenStreetMap (Overpass API).
# Gdy brak internetu, gra działa na samym generatorze.
USE_OSM = os.environ.get("NAVIA_OSM", "1") == "1"
OSM_CELL = 0.02
OSM_URL = "https://overpass-api.de/api/interpreter"

NIGHT_HOURS = (21, 5)     # od 21:00 do 5:00 jest noc

# ---------------------------------------------------------------- MAPA (kafelki)
# Od września 2026 kafelki CARTO wymagają darmowego klucza:
#   https://carto.com/basemaps/apikey/  (bez zakładania konta)
# Wklej klucz tutaj albo ustaw zmienną środowiskową NAVIA_MAP_KEY.
# Bez klucza gra użyje zapasowo zwykłej mapy OpenStreetMap, przyciemnionej filtrem.
MAP_API_KEY = os.environ.get("NAVIA_MAP_KEY", "")
MAP_TILE_URL = os.environ.get("NAVIA_TILES", "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png")
MAP_ATTRIBUTION = ('&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> '
                   '&copy; <a href="https://carto.com/attributions">CARTO</a>')
# Mapa zapasowa (bez klucza). Polityka OSM pozwala na lekki ruch — do testów, nie na produkcję.
MAP_FALLBACK_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
MAP_FALLBACK_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'


def map_tiles():
    """Ustawienia kafelków mapy wysyłane do przeglądarki."""
    if MAP_API_KEY:
        url = MAP_TILE_URL + ("&" if "?" in MAP_TILE_URL else "?") + "key=" + MAP_API_KEY
        return {"url": url, "attribution": MAP_ATTRIBUTION, "subdomains": "abcd", "dark": True}
    return {"url": MAP_FALLBACK_URL, "attribution": MAP_FALLBACK_ATTRIBUTION, "subdomains": "abc", "dark": False}
