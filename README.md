# Cienie Navii

To webowa gra MMORPG oparta na GPS, w mrocznym klimacie dawnej Słowiańszczyzny. Chodzisz po prawdziwej mapie, a teren pod stopami (las, bagno, rzeka, góry), cmentarze, kapliczki i rozstaje zmieniają to, co możesz spotkać. Polujesz na strzygi i utopce, warzysz eliksiry, przechodzisz przemiany, rozbijasz obozy i budujesz własne siedlisko.

Grafiki nie ma celowo. Gra stoi na tekście i wyobraźni: przedmioty, potwory i zdarzenia mają słowne opisy, a ikony to stonowane emoji.

> Tytuł jest roboczy. Zmienisz go w `navia/config.py` (`GAME_NAME`) albo przez zmienną środowiskową `NAVIA_NAME`.

---

## Uruchomienie (Windows / PyCharm)

1. Otwórz folder `NaviaWorlds` w PyCharm. Projekt ma już środowisko `venv`.
2. W terminalu PyCharm zainstaluj zależność:
   ```
   pip install -r requirements.txt
   ```
3. Uruchom grę. Masz dwie drogi:
   - w PyCharm kliknij prawym przyciskiem plik `app.py` i wybierz **Run 'app'** (następnym razem wystarczy ▶ u góry);
   - albo w terminalu wpisz `python app.py`.
4. Otwórz **http://localhost:5000**. Konto admina tworzy się samo przy starcie: login **migu**, hasło **adminmigu** (zmienisz je w `navia/config.py` → `ADMIN_USERNAME` / `ADMIN_PASSWORD`; zmień przed publikacją gry w internecie).
5. Panel admina: **http://localhost:5000/admin**. W grze prowadzi do niego też przycisk ⚙.

Baza danych tworzy się sama w `instance/navia.db` i od razu dostaje całą treść startową: 103 przedmioty, 40 receptur, 16 potworów, 40 zdarzeń, 16 akcji zbieractwa, 9 rodzajów budynków, 9 rodzajów punktów mocy i 8 terenów.
Jeśli chcesz zacząć od zera, usuń plik `instance/navia.db`.

Testy uruchomisz poleceniem `python tests/test_flow.py`. Używają osobnej, tymczasowej bazy.

Po zmianie wymagań zainstaluj je ponownie: `pip install -r requirements.txt`. Lista zawiera `gunicorn` i `psycopg` dla serwera na Render, ale lokalnie nic nie trzeba konfigurować.

## Klucz do mapy (CARTO)

Od września 2026 kafelki CARTO wymagają **darmowego klucza** — bez niego na mapie widać napis „API KEY REQUIRED”.

1. Wejdź na https://carto.com/basemaps/apikey/ i wypełnij formularz „Request a key” (nie trzeba zakładać konta).
2. Wklej klucz w `navia/config.py` → `MAP_API_KEY = "twój-klucz"` albo ustaw zmienną środowiskową `NAVIA_MAP_KEY`.
3. Uruchom serwer ponownie i odśwież stronę (Ctrl+F5).

Bez klucza gra sama przełącza się na zwykłą mapę OpenStreetMap przyciemnioną filtrem — do testów wystarczy.
Limity CARTO: użytek niekomercyjny do 5 mln kafelków miesięcznie, komercyjny do 1 mln za darmo.

## Gra na telefonie

- Telefon i komputer muszą być w tej samej sieci Wi-Fi. Na telefonie wejdź na `http://<IP-komputera>:5000`. IP sprawdzisz w Windows poleceniem `ipconfig`.
- Po wdrożeniu na Render gra ma od razu adres https, więc GPS na telefonie działa bez kombinowania (patrz niżej).
- **GPS w przeglądarce działa tylko przez HTTPS** (oraz na `localhost`). Masz dwie możliwości:
  - `pip install pyopenssl`, potem `python app.py --https`. Przeglądarka ostrzeże o certyfikacie, wtedy wybierz „Zaawansowane → Przejdź”;
  - albo tunel, np. `cloudflared tunnel --url http://localhost:5000` lub `ngrok http 5000`. Dostajesz prawdziwy adres https.
- **Instalacja jako aplikacja (PWA):** w Chrome na Androidzie otwórz menu ⋮ i wybierz „Zainstaluj aplikację”. Na iPhonie w Safari: Udostępnij → „Do ekranu początkowego”. Gra ma ikonę, ekran startowy i działa w trybie pełnoekranowym.

## Wdrożenie na Render (gra w internecie)

Projekt zawiera gotowy plik **`render.yaml`**: serwis WWW z grą i API, podłączany do Twojej bazy PostgreSQL na Render.

### 1. Wrzuć projekt na GitHuba
W PyCharm: **VCS → Share Project on GitHub** albo w terminalu:
```
git init
git add .
git commit -m "Cienie Navii"
git branch -M main
git remote add origin https://github.com/<twoj-login>/cienie-navii.git
git push -u origin main
```
Plik `.gitignore` pomija `venv/` i lokalną bazę `instance/`, więc na GitHuba nie trafią hasła graczy z Twojego komputera.

### 2. Baza danych
Na darmowym planie Render pozwala mieć **jedną** bazę PostgreSQL, więc gra korzysta z bazy, którą już masz. Swoje tabele trzyma w osobnym schemacie `navia`, dlatego nie rusza danych innych projektów w tej samej bazie.
1. W Render otwórz swoją bazę → **Connect** i skopiuj **Internal Database URL**.
2. Sprawdź **region** bazy, np. Frankfurt albo Oregon. Serwis gry powinien stać w tym samym regionie. Jeśli to nie Frankfurt, zmień linijkę `region:` w `render.yaml`.
   Możesz też użyć **External Database URL**. Działa z każdego regionu, ale gra będzie wolniejsza.

### 3. Utwórz serwis z Blueprintu
1. Na https://dashboard.render.com wybierz **New → Blueprint** albo w istniejącym Blueprincie kliknij **Manual sync**.
2. Render zapyta o wartości:
   - **DATABASE_URL** — adres bazy z punktu 2.
   - **NAVIA_ADMIN_PASS** — hasło konta admina `migu` na serwerze. Daj inne niż lokalnie.
   - **NAVIA_MAP_KEY** — klucz CARTO. Możesz zostawić puste i dodać później w *Environment*.
3. Kliknij **Apply**. Po kilku minutach gra działa pod adresem `https://cienie-navii.onrender.com`, a w logach pojawi się `[navia] Baza danych: postgres`.
4. Wygeneruj na CARTO klucz produkcyjny ograniczony do tego adresu i wklej go w **Environment → NAVIA_MAP_KEY**.

Każdy `git push` na gałąź `main` automatycznie wdraża nową wersję.

### Jak działa „aplikacja + budzenie serwera”
- Darmowy serwis na Render **zasypia po 15 minutach** bez ruchu. Budzi się przy pierwszym wejściu, zwykle w mniej niż minutę.
- Gra jest aplikacją PWA. Po instalacji (⇩ na mapie albo Postać → Zainstaluj aplikację) jej szkielet, czyli wygląd, skrypty i ikony, ładuje się **od razu z pamięci telefonu**. W tym czasie aplikacja sama odpytuje `/api/health` i pokazuje ekran **„Budzenie świata”**. Grę odsłania dopiero wtedy, gdy serwer i baza odpowiadają.
- W trakcie gry aplikacja co kilka minut daje znać serwerowi, że ktoś gra, więc serwer nie zaśnie. Po powrocie do aplikacji, np. po godzinie w kieszeni, sama sprawdza, czy serwer nie zasnął, i w razie potrzeby go budzi.
- Jeśli chcesz, żeby serwer **nie zasypiał wcale**, ustaw darmowe pingowanie adresu `https://<twoja-gra>.onrender.com/api/health` co 10 minut, np. w UptimeRobot albo cron-job.org. Jeden serwis działający bez przerwy mieści się w 750 darmowych godzinach miesięcznie.

### Baza danych na Render — ważne
- Darmowa baza PostgreSQL ma 1 GB, czyli dużo jak na tę grę. **Wygasa jednak 30 dni po utworzeniu.** Potem jest jeszcze 14 dni na przejście na płatny plan, a po tym czasie Render ją usuwa.
- Zanim minie 30 dni, wejdź w **Panel admina → Eksport / import → „Pełna kopia (z graczami)”**. Następnie utwórz nową darmową bazę (starą usuń, bo limit to jedna), wklej jej adres w zmiennej `DATABASE_URL` serwisu i zaimportuj plik. Konta, postacie, ekwipunek i siedliska wrócą na swoje miejsca.
- Druga droga to płatny plan bazy, który nie wygasa.
- Darmowa baza nie ma automatycznych kopii zapasowych, dlatego pełną kopię warto pobierać regularnie.

### Lokalnie bez zmian
Na komputerze gra dalej używa pliku SQLite i `python app.py`. Bazy PostgreSQL używa tylko wtedy, gdy ustawisz zmienną `DATABASE_URL`.

## Tryb debug: strzałki zamiast chodzenia

W `navia/config.py` ustawienie `DEBUG_MOVEMENT = True` (domyślne) daje:
- **strzałki** w lewym dolnym rogu. Środkowy przycisk zmienia krok: 10 / 25 / 100 / 400 m. Na komputerze działają też strzałki klawiatury;
- przycisk **✥ teleport**: po jego włączeniu kliknięcie mapy przenosi postać;
- przycisk **⌖ GPS**, który włącza i wyłącza prawdziwą lokalizację;
- krótszy czas odnowienia eksploracji i brak blokady „za szybkiego” ruchu.

Na produkcji ustaw `NAVIA_DEBUG=0`. Plik `render.yaml` robi to sam. **Admin ma strzałki i teleport zawsze**, także na serwerze, więc możesz testować bez chodzenia.

---

## Jak działa gra

### Świat
- **Generator świata** stawia wokół gracza obszary terenu, punkty mocy i budynki. Jest deterministyczny (ziarno `WORLD_SEED`), więc wszyscy gracze widzą ten sam świat.
- **OpenStreetMap:** prawdziwe kościoły, cmentarze, kapliczki przydrożne, źródła, ruiny, lasy, jeziora i mokradła stają się punktami mocy i terenami. Przy okazji puby zamieniają się w karczmy, apteki w chaty zielarek, a biblioteki w biblioteki. Dane pobierają się w tle i zostają zapisane w bazie. Bez internetu gra działa na samym generatorze.
- **Punkty mocy** (świątynia, cmentarz, rozstaje, kurhan, święty gaj, źródło, szubienica, pobojowisko, kamienny krąg) działają w okręgu. **Im bliżej środka, tym silniejszy wpływ:** zmieniają cechy gracza i szanse na konkretne zdarzenia. Na mapie pokazują to trzy pierścienie.
- **Budynki:** karczma, klasztor, kuźnia, cmentarz, biblioteka, ruiny, a do tego trzy nowe: **chata zielarki**, **gontyna** (chram starych bogów) i **strażnica** (tablica zleceń). Każdy ma własne akcje: sklep, skup, naukę receptur, nocleg, oczyszczenie z toksyn, ofiary dające błogosławieństwa, przeszukiwanie z ryzykiem walki, plotki, bestiariusz i zlecenia.

### Eksploracja i energia
- Energia eksploracji to osobny pasek. **+10 pkt co godzinę**, maksymalnie 100.
- Tryby eksploracji:

  | Tryb | Koszt | Potwory | Siła potworów | Łupy | Rzadkie zdarzenia |
  |---|---|---|---|---|---|
  | Łatwy | 1 | ×0,5 | ×0,8 | ×0,8 | ×0,5 |
  | Normalny | 2 | ×1 | ×1 | ×1 | ×1 |
  | Trudny | 3 | ×1,6 | ×1,35 | ×1,5 | ×1,6 |
  | Specjalny | 5 | ×1,2 | ×1,2 | ×2 | ×4 |

  Wszystkie wartości zmienisz w `navia/config.py` → `EXPLORE_MODES`.
- **Wzór losowania:** `waga = waga bazowa × mnożnik terenu × mnożniki punktów mocy (zależne od odległości) × pora dnia × tryb`. Gra zamienia wagi na procenty. W grze zobaczysz je pod „Szepty okolicy”, a w panelu admina w **Symulatorze szans**.
- Zdarzenia z puli mają trzy rodzaje: **potwór**, **znalezisko** albo **zdarzenie fabularne**. Fabularne mogą mieć rozgałęzienia, na przykład dobre zakończenie, złe zakończenie albo potwora na końcu.

### Waluta: dobroty i grosze
1 dobrota = 100 groszy. Gra pokazuje kwoty jako „2 dobroty 40 gr”. W bazie i w panelu admina ceny wpisujesz w groszach.

### Tropiciel: strzałki do towarów
Przycisk 🧭 na mapie, „Gdzie zdobyć więcej?” przy przedmiocie albo kliknięcie brakującego składnika w recepturze. Gra pokazuje w promieniu kilku kilometrów, gdzie zdobyć dany towar:
- **zbieractwo**: najbliższy las, łąka, rzeka… i potrzebne narzędzie;
- **eksploracja i polowanie**: miejsca, gdzie zdarzenie albo potwór z tym łupem trafia się najczęściej, z przybliżoną szansą i podpowiedzią „częściej nocą”;
- **sklepy w budynkach**, **targowiska** (dzisiejszy asortyment) i **kramy innych łowców**;
- receptury, z których można to wytworzyć.

Na mapie pojawiają się kolorowe strzałki wokół gracza. Dotknięcie strzałki pokazuje dymek z opisem: dokąd prowadzi, jak daleko i w jakim kierunku. Po dotarciu na miejsce gra daje znać.

### Targowiska i kramy łowców
- **Targowisko** to nowy budynek. W prawdziwym świecie pojawia się na rynkach, placach i przy ratuszach, czyli w centrach miast. Każdego dnia przyjeżdżają tam inni kupcy z innym towarem i innymi cenami. Są też stałe kramy i skup.
- **Kram łowcy**: w Obozowisku możesz nająć kupca, który stanie tam, gdzie jesteś. Płacisz z góry z własnej sakiewki (domyślnie 50 gr za dzień, najwyżej 14 dni). Wykładasz towar z torby i ustalasz ceny. Inni gracze kupują przy kramie, a pieniądze trafiają do szkatuły, którą odbierasz w każdej chwili. Zwinięcie kramu oddaje niesprzedany towar i utarg.

### Energia i wigor
- **Energia** to „paliwo” przycisku **Eksploruj**: każda eksploracja kosztuje 1–5 pkt zależnie od trybu, a odnawia się +10 pkt na godzinę.
- **Wigor** to siły łowcy na zbieractwo i przeszukiwanie (w walce wigor nie jest zużywany). Odnawia się sam, a **każdy przebyty metr daje +1 wigoru** (`VIGOR_PER_METER` w `config.py` albo zmienna `NAVIA_VIGOR_PER_M`). Gra pomija drgania GPS (poniżej 4 m), jazdę szybszą niż ok. 29 km/h, skoki i teleporty powyżej 200 m oraz chodzenie w trakcie walki.

### Walka (turowa, jak w Pokémonach)
W każdej turze wybierasz jedną z czterech opcji:
- **Atak:** cięcie, szybkie pchnięcie (zawsze pierwsze), potężny cios, finta (osłabia obronę wroga);
- **Czary:** Żar Swaroga, Tchnienie Strzyboga, Tarcza Peruna, Pęta Welesa, Szept Mokoszy;
- **Torba:** eliksiry, jedzenie, oleje na ostrze (premia przeciw rodzinie potworów) i rzuty, np. święta woda na upiory;
- **Ucieczka.**

**Walka nie zużywa wigoru.** Silniejsze ruchy mają **odnowienie** liczone w turach: potężny cios 2, finta 3, Żar i Tchnienie 3, Tarcza i Pęta 4, Szept 5 (`cd` w `navia/combat.py`). Cięcie i pchnięcie są dostępne zawsze.

Każdy przycisk pokazuje **statystyki ruchu**: przewidywane obrażenia po pancerzu wroga, szansę trafienia, szansę na krytyk, odnowienie, działanie (np. „ogłuszenie 60%”) i trafione słabości ★. Na kartach widać atak, obronę i szybkość obu stron, a „ⓘ Wróg” pokazuje ruchy potwora z celnością i obrażeniami. Dziennik walki pod każdym ciosem wypisuje rzut: celność, siłę, pancerz, krytyk i zdrowie po trafieniu.

Kolejność w turze zależy od Zręczności i szybkości potwora. Potwory mają własne ataki z efektami: krwawienie, trucizna, ogłuszenie, wysysanie, osłabienie. Działają też słabości: olej, srebro, ogień, światło.

### Auto-walka i plan walki
- Przycisk **▶ Auto** w walce: łowca sam wybiera ruchy, a ty patrzysz. Wyłączasz go tym samym przyciskiem.
- **⚙ Plan** to lista priorytetów. W każdej turze gra sprawdza kroki od góry i bierze pierwszy możliwy: ruch nie jest w odnowieniu, przedmiot jest w torbie, a warunek **„HP < x%”** (jeśli go wpiszesz) jest spełniony. Gdy nic nie pasuje, łowca tnie.
- Kroki specjalne: **najlepsze leczenie** (najpierw jadło bez toksyn, nigdy ponad limit toksyczności), **pasujący olej** (tylko na właściwą rodzinę, raz na walkę) i **najlepszy pocisk**. Można też dodać konkretny przedmiot albo ucieczkę.
- Plan zapisuje się w przeglądarce. Domyślny: leczenie przy HP < 35%, Szept przy HP < 40%, olej, Pęta, Żar, finta, potężny cios, cięcie.

### Auto-skan (farmienie)
Przycisk **⟳ Auto-skan** pod trybami eksploracji. Łowca sam przeczesuje okolicę w wybranym trybie:
- eksploruje co kilka sekund (tak często, jak pozwala serwer);
- zbiera to, co rośnie pod nogami, jeśli ma narzędzie i wigor;
- potwory bije **auto-walką według planu**. Może też najpierw próbować uciec przed silniejszymi;
- zatrzymuje się, gdy zdrowie spadnie poniżej progu, skończy się energia (z opcjonalnym zapasem), minie zadana liczba skanów albo przy porażce.

Na dole widać pasek z postępem i przyciskiem **■ Stop**, a na końcu podsumowanie: skany, walki, doświadczenie, monety i wszystkie łupy. Na telefonie auto-skan nie pozwala zgasnąć ekranowi.

### Dymki „jak to miejsce na mnie działa”
Dotknij czipa pozycji pod paskami: terenu, punktu mocy albo nocy. Pojawi się dymek:
- **wpływ na cechy** (np. cmentarz: +2,6 Moc, −1,3 Witalność; wartość zależy od odległości od środka);
- **zmiana szans na zdarzenia**: „było → jest” z mnożnikiem, czyli porównanie z tym samym miejscem bez tego terenu, punktu mocy albo nocy;
- co można tu **zbierać** i jaka jest siła działania.

Czip efektu (eliksiru, błogosławieństwa) pokazuje jego cechy i czas trwania.

### Zlecenia ze strażnicy: strzałka do celu
Przy każdym zleceniu na tablicy jest **🧭 Gdzie?**, a w Postaci przy przyjętych zleceniach **🧭 Prowadź**. Gra wskazuje miejsce, gdzie najłatwiej spotkać danego stwora: teren albo punkt mocy, który on lubi, z szansą na każdy skan. Podpowiada też budynki, w których przeszukiwanie może go zbudzić (cmentarz, ruiny). Na mapie pojawia się strzałka z odległością i azymutem. Po pokonaniu stwora trop sam się kończy.

### Crafting
- Przeciągnij w Torbie **przedmiot na przedmiot**. Pojawi się dymek z pasującymi recepturami i szansą powodzenia. Na telefonie przytrzymaj przedmiot i przeciągnij, albo wybierz „Połącz z…”.
- Przy narzędziu przycisk „Użyj narzędzia” pokazuje receptury, które go wymagają.
- **Szansa** = baza + Alchemia × premia receptury + premie narzędzi + **katalizatory**. Katalizatory to dodatkowe substancje (miód, siarka, jemioła, kwiat paproci…) albo pomocnicze konstrukcje, np. stół zielarza czy ołtarzyk Welesa.
- Narzędzia mogą być **w torbie**, **postawione w obozie lub siedlisku** albo dostępne w **budynku-warsztacie**: kuźnia ma kowadło i palenisko, zielarka ma stół, klasztor ma alembik.
- Receptura może wymagać konkretnego miejsca: wszędzie, obóz, siedlisko, wybrany budynek albo wybrany punkt mocy.

### Mutacje
Wywary przemiany zmieniają cechy **na zawsze**. Dodają toksyczność i niosą ryzyko porażki, które rośnie, gdy przekroczysz limit toksyn. Liczba przemian zależy od poziomu postaci.

### Rozbudowa obozu i siedliska („ośmiornica”)
- Dotknij swojego obozu albo siedliska na mapie (albo w Obozowisku wybierz **Plan i rozbudowa**). Zobaczysz budynki i opcje rozbudowy.
- Budynki (kamienne palenisko, stół zielarza, suszarnia, ołtarzyk Welesa, kocioł, kowadło) stawiasz **tam, gdzie stoisz**, albo **wskazujesz miejsce na mapie**: do 60 m od siebie i do 250 m od centrum.
- Każdy budynek ma **mały krąg** (15–24 m; admin ustawia go w polu „Zasięg budynku”). Krąg centrum ma 45 m. Gdy krąg budynku styka się z centrum albo z innym połączonym budynkiem, ich obszary **zlewają się w jeden kształt** z odnóżami, czyli w „ośmiornicę”. W całym tym obszarze jesteś „w obozie” i korzystasz z każdego połączonego budynku.
- Budynek postawiony osobno działa tylko wtedy, gdy stoisz w jego własnym kręgu. Żeby go połączyć, postaw coś pomiędzy.
- **Przenoszenie:** „Wskaż na mapie” albo „Przenieś tutaj” przenosi cały obóz lub siedlisko w wybrane miejsce. Budynki przenoszą się razem z nim i zachowują układ.

### Strzałka z Księgi receptur
Dotknij składnika albo narzędzia w recepturze. Na mapie od razu pojawi się strzałka do najbliższego miejsca, gdzie go zdobędziesz, a gra poda odległość i **azymut** (np. „298 m, azymut 58°, północny wschód”).

### Torba
Widok „Wszystko” jest podzielony na grupy (Surowce, Alchemia, Wyposażenie, Obozowisko, Prowiant i skarby), a w nich na sekcje kategorii z liczbą rodzajów i sztuk. Sekcje zwijasz dotknięciem nagłówka, a gra to zapamiętuje.

### Wylogowanie
Okrągły przycisk **⏻** na prawym pasku mapy, a także na dole panelu Postać i w panelu admina.

### Obóz i siedlisko
- **Obóz** budujesz z 4 drewna; potrzebne jest też krzesiwo w torbie. Widzą go wszyscy, podpisany Twoim imieniem. Po 24 h wygasa i na mapie stopniowo blednie. Drewno dorzucone do ogniska wydłuża mu życie.
- **Siedlisko** (baza) jest prywatne i widzisz je tylko Ty oraz zaproszeni gracze. Stawiasz w nim konstrukcje: kocioł, stół zielarza, suszarnię, ołtarzyk, palenisko, kowadło. Każda ma wytrzymałość, która spada co godzinę, a naprawa wymaga składników.

---

## Panel admina (`/admin`)
- **Przedmioty**: opis słowny, ikona, kategoria, efekty (wstawiane z gotowych wzorów: leczenie, efekt czasowy, mutacja, olej, rzut, broń, pancerz), narzędzia, katalizatory i konstrukcje.
- **Receptury**: konfigurator łączenia przedmiotów. Składniki z ilościami, narzędzia, miejsce, suwak szansy bazowej, katalizatory z premią, przedmiot przy porażce i podgląd szans na żywo.
- **Pula zdarzeń**: nowe akcje eksploracji z wagą, mnożnikami dla każdego terenu i punktu mocy, porą dnia, poziomami i skutkami.
- **Potwory**: statystyki, ataki z efektami, słabości i łup.
- **Zbieractwo**, **Tereny**, **Punkty mocy**, **Budynki**: akcje, sklep, nauka receptur, łup z przeszukiwania.
- **Symulator szans**: suwaki terenu i odległości od punktów mocy, a obok procent dla każdego zdarzenia.
- **Mapa miejsc**: kliknij mapę, żeby postawić własny punkt mocy, obszar albo budynek.
- **Gracze**: dawanie przedmiotów, groszy i energii, leczenie, nauka wszystkich receptur, nadawanie uprawnień admina.
- **Eksport / import** całej treści do pliku JSON. Przydaje się na kopie zapasowe.

## Struktura projektu
```
app.py                 – uruchomienie serwera (lokalnie: python app.py, na Render: gunicorn app:app)
render.yaml            – konfiguracja wdrożenia na Render (serwis + baza PostgreSQL)
navia/config.py        – ustawienia (nazwa gry, energia, tryby, debug, OSM)
navia/schema.sql       – schemat bazy (SQLite; dla PostgreSQL tłumaczony automatycznie)
navia/db.py            – warstwa bazy: SQLite lokalnie, PostgreSQL gdy jest DATABASE_URL
navia/seed.py          – treść startowa (przedmioty, receptury, potwory, zdarzenia…)
navia/world.py         – generator świata, punkty mocy, OpenStreetMap
navia/explore.py       – losowanie zdarzeń
navia/combat.py        – walka turowa
navia/crafting.py      – receptury, narzędzia, katalizatory
navia/camp.py          – obozy, siedlisko, konstrukcje
navia/places.py        – budynki, targowiska i zbieractwo
navia/trade.py         – kramy łowców (kupcy graczy)
navia/finder.py        – tropiciel: gdzie zdobyć dany towar
navia/character.py     – postać, cechy, ekwipunek, mutacje
navia/api.py, admin.py – REST API gry i panelu
static/                – interfejs (HTML/CSS/JS), PWA, ikony
static/js/auto.js      – auto-skan (farmienie)
tests/test_flow.py     – testy całej pętli gry
```

## Prawa autorskie
Teksty w grze są oryginalne. Klimat wziął się z mitologii i demonologii słowiańskiej (strzygi, utopce, południce, leszy, bogowie: Perun, Weles, Mokosz, Swaróg), a wierzenia ludowe są dobrem wspólnym. W grze nie ma cytatów z powieści, nazw własnych ani znaków towarowych cudzych serii, więc cała treść należy do Ciebie i bezpiecznie ją zastrzeżesz.
Mapa korzysta z danych © OpenStreetMap i kafelków © CARTO. Przy publikacji gry zostaw te podpisy, bo wymagają tego licencje.
