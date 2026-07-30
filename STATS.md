# Moduł Statystyki — macierze pokrycia rynków

Narzędzie do deep-dive'u w statystyki meczowe: wybierasz ligę i mecz, dostajesz
komplet linii bukmacherskich z pokryciem w oknach **5 / 10 / 20** ostatnich
spotkań każdej z drużyn — w trafieniach (`8/10`) i w procentach.

## Uruchomienie

```bash
node server.js
# http://localhost:8787/stats.html
```

Serwer wymaga Node 18+ i nie ma żadnych zależności. Robi dwie rzeczy:
serwuje pliki aplikacji i pośredniczy w pobieraniu danych.

`server.js` wysyła `Access-Control-Allow-Origin: *`, więc **wystarczy, że
działa w tle** — stronę możesz otwierać skąd chcesz (inny port, Live Server).
Aplikacja wykryje proxy pod `http://localhost:8787` i użyje go.

Bez uruchomionego serwera moduł spada na publiczne proxy CORS, które są
zawodne: w lipcu 2026 `r.jina.ai` zaczął wymagać logowania (HTTP 401),
a `allorigins.win` i `codetabs.com` zwracały 522. W przeglądarce takie
odpowiedzi nie niosą nagłówka CORS, więc `fetch` nie może ich odczytać
i zgłasza generyczne **„Failed to fetch"** zamiast kodu HTTP — stąd cztery
identyczne komunikaty w błędzie. Nagłówek strony ostrzega wtedy
**„Bez lokalnego proxy"**.

## Dwa źródła i podział obowiązków

| | Terminarz | Historia do macierzy |
|---|---|---|
| **API-Football** | ✅ dziś i jutro, 39 lig, statusy live | ❌ zablokowane na planie Free |
| **football-data.co.uk** | ⚠️ ok. tygodnia, tylko w sezonie | ✅ bez limitów, komplet statystyk |

Terminarz idzie więc z API-Football, a macierze liczą się z CSV. Kliknięcie
**Analizuj** przy meczu z terminarza automatycznie wczytuje odpowiednią
dywizję CSV i dopasowuje nazwy drużyn.

### Klucz API-Football

Wklej klucz z [dashboard.api-football.com](https://dashboard.api-football.com)
w sekcji **Klucz API-Football**. Zostaje wyłącznie w `localStorage` tej
przeglądarki — nie ma go w żadnym pliku repozytorium. Przycisk **Sprawdź
połączenie** pokazuje plan i zużycie limitu.

Bez klucza moduł działa dalej, tylko terminarz live jest wyłączony.

### Ograniczenia planu Free (sprawdzone na żywo)

- `/fixtures?date=` — **tylko dziś ±1 dzień**. Dalsze daty: *„Free plans do not
  have access to this date"*.
- Sezony — **wyłącznie 2022–2024**. Sezon bieżący: *„Free plans do not have
  access to this season"*.
- Parametr `last` — zablokowany, więc „ostatnie N meczów drużyny" jest
  nieosiągalne.
- Budżet — 100 zapytań na dobę, 10 na minutę.

Dlatego **statystyki za ostatnie mecze nie idą z API-Football**: najnowszy
dostępny sezon skończył się w maju 2025. Płatny plan zdejmuje te limity, ale
przy 20-meczowym oknie jedna analiza to ok. 41 zapytań (1 na listę meczów + 1
na statystyki każdego meczu), więc CSV pozostaje sensowniejszym źródłem
historii nawet wtedy.

Licznik zapytań w nagłówku jest **lokalny**. api-sports.io wysyła wprawdzie
nagłówki `x-ratelimit-*`, ale bez `Access-Control-Expose-Headers`, więc
przeglądarka ich nie ujawnia — wartość autorytatywną pobiera przycisk
**Sprawdź połączenie**.

### Mostek nazw drużyn

API-Football pisze „Manchester City", CSV — „Man City". Dopasowanie idzie
tokenami: równe, prefiks, albo skrót jako podciąg ze wspólnym prefiksem
(„nottm" wewnątrz „nottingham"). Sam podciąg nie wystarcza — bez wymogu
prefiksu „real" pasowałoby do „arsenal". Gdy pewności brak, moduł prosi
o ręczne wskazanie zamiast zgadywać.

Sprawdzone na pełnych składach Premier League i Serie A: 40/40 automatycznie,
w tym „Nottingham Forest" → „Nott'm Forest", „AC Milan" → „Milan",
„Hellas Verona" → „Verona".

## Skąd biorą się dane historyczne

[football-data.co.uk](https://www.football-data.co.uk) — darmowe pliki CSV,
bez klucza API i bez limitów zapytań. Jeden plik to cały sezon ligi z kompletem
statystyk meczowych:

| Kolumna    | Znaczenie                          |
|------------|------------------------------------|
| `FTHG/FTAG`| gole (koniec meczu)                |
| `HTHG/HTAG`| gole do przerwy                    |
| `HS/AS`    | strzały                            |
| `HST/AST`  | strzały celne                      |
| `HC/AC`    | **rzuty rożne**                    |
| `HF/AF`    | faule                              |
| `HY/AY`    | żółte kartki                       |
| `HR/AR`    | czerwone kartki                    |
| `PSCH…`    | kursy zamknięcia 1X2, O/U 2.5, AH  |

**22 ligi z pełną statystyką**: Anglia (5 poziomów), Szkocja (4), Niemcy (2),
Włochy (2), Hiszpania (2), Francja (2), Holandia, Belgia, Portugalia, Turcja,
Grecja.

**16 lig dodatkowych** (m.in. Ekstraklasa, MLS, Brazylia, Japonia) — tam
źródło publikuje wyłącznie gole i kursy. Moduł wykrywa to sam i zamiast
pustych tabel pokazuje informację, których kategorii brakuje.

### Dlaczego nie TheSportsDB

Poprzednia wersja korzystała z TheSportsDB z darmowym kluczem `123`. Ten klucz
obcina **każdą** odpowiedź do 3 rekordów — `eventsday.php` dla pełnej kolejki
ligowej zwracał 3 mecze, przez co terminarz był praktycznie pusty. Endpoint
`lookupeventstats.php` tnie z kolei do 5 pozycji i zwraca same strzały:
rożnych, kartek ani fauli nie ma tam w ogóle.

## Przepływ pracy

**Historia z CSV dociąga się sama** przy pierwszej analizie danej ligi. Nie ma
kroku „najpierw pobierz wyniki".

```
1. Klucz API          jednorazowo, zostaje w przeglądarce
2. Pobierz terminarz  1 zapytanie · dziś albo jutro
3. Skanuj  ────────►  ranking typów z całego dnia   ─┐
   albo Analizuj ───► pojedynczy mecz               ─┴─► 4. Macierze pokrycia
```

Krok 3 i 4 nie kosztują ani jednego zapytania API. Realne zużycie to
**2 zapytania dziennie** ze 100 dostępnych: jedno na terminarz na dziś, drugie
na jutro.

Sekcja **Źródło danych** (wybór ligi, zakres sezonów, „Wczytaj ligę") jest
potrzebna wyłącznie do **własnego zestawienia** — pary drużyn spoza terminarza,
np. gdy chcesz przejrzeć mecz z przyszłej kolejki albo porównać dwie dowolne
ekipy. Przy pracy z terminarza możesz ją całkowicie pominąć.

### Panele zwijane i filtr terminarza

Terminarz na jutro potrafi mieć ponad 300 meczów, więc:

- **„Tylko z analizą"** — chip przy filtrze pokazuje, ile meczów ma historię
  w CSV, i zawęża listę wyłącznie do nich. Na przykładowym dniu: 341 → 16
  meczów, wysokość strony spada z 7410 do 2371 px.
- **Ligi bez historii startują zwinięte** — to one robią większość
  przewijania, a i tak nic z nich nie policzymy.
- **Każdy panel ma strzałkę zwijania** w nagłówku sekcji. Stan jest
  zapamiętywany między wizytami.
- **Terminarz zwija się sam** po wejściu w analizę meczu, żeby powrót do
  macierzy nie wymagał przewijania przez całą listę.

### Co się cachuje

| Warstwa | Czas życia | Uwagi |
|---|---|---|
| Terminarz API-Football | 3 min | ponowne kliknięcie w tym oknie nie kosztuje zapytania |
| CSV w przeglądarce | 12 h | `localStorage`, budżet 3,5 MB |
| CSV na serwerze | 6 h | katalog `.stats-cache/` |
| Sparsowane ligi | do przeładowania strony | pula w pamięci, zerowy koszt |

W praktyce: pierwsza analiza z danej ligi trwa chwilę (pobranie 1–3 plików
CSV), każda kolejna z tej samej ligi jest natychmiastowa.

## Jak czytać dashboard

**1. Źródło danych** — liga, zakres historii (1–4 sezony), okno główne,
filtr dom–wyjazd. Pobrane pliki zostają w cache przeglądarki i na dysku
serwera, więc kolejne analizy w tej samej lidze są natychmiastowe.

**2. Terminarz** — nadchodzące mecze wybranej ligi razem z kursami. Plik
`fixtures.csv` obejmuje ok. tygodnia naprzód i bywa pusty w przerwie
międzysezonowej.

**3. Własne zestawienie** — dowolna para drużyn z wczytanej ligi. Działa
niezależnie od terminarza, więc analiza jest możliwa zawsze.

**Skaner dnia** — jeden ranking rynków ze **wszystkich** meczów terminarza,
zamiast otwierania meczu po meczu. Przeliczenie nie zużywa limitu API: dane
historyczne siedzą już w cache, liczy się tylko procesor.

```
Mecz                              Rynek                     5     10     20    najsłabsze  Wilson
Talleres – Velez    22:00  GOLE   Gole w meczu pon. 3,5    90%    90%    95%      90%       89%
                                                          9/10  18/20  38/40                38/40
```

- **Najsłabsze okno** — najniższe pokrycie wśród okien 5/10/20. Odsiewa typy
  oparte na jednej dobrej serii.
- **Wilson** — dolna granica przedziału na **najszerszej** próbce (okno 20 ×
  dwie drużyny, czyli do 40 obserwacji). To po niej idzie ranking: okno główne
  daje zbyt wiele remisów, bo przy próbce 18/20 każdy typ wychodzi na 78%.
- **Filtry** — minimalne pokrycie, grupa rynków, pomijanie meczów rozegranych.
- Strzałka w ostatniej kolumnie otwiera pełne macierze dla danego meczu.

Skaner działa tylko dla lig obecnych w CSV — pozostałe mecze terminarza są
oznaczone „brak historii w CSV" i pomijane.

**4. Macierze pokrycia** — sedno narzędzia. Dla każdej linii:

```
Rożne w meczu pow. 8,5 │ Arsenal          │ Chelsea          │ Razem  │ Model
                       │ 5     10    20   │ 5     10    20   │        │
                       │ 20%   50%   50%  │ 60%   70%   75%  │  60%   │  66%
                       │ 1/5   5/10  10/20│ 3/5   7/10  15/20│ 12/20  │  1.51
```

- **kolumny 5/10/20** — pokrycie w ostatnich N meczach każdej z drużyn osobno
- **Razem** — obie próbki złączone (2 × okno główne)
- **Model** — rozkład Poissona na projekcji + kurs godziwy pod spodem
- **kolor** — im ciemniejsza zieleń, tym częściej linia była przekraczana

Rozjazd między oknami jest sygnałem sam w sobie: `20% / 50% / 50%` u Arsenalu
oznacza, że ostatnie pięć meczów wyraźnie odstaje od dłuższego trendu.

**Pasek formy** pod każdą macierzą pokazuje przebieg mecz po meczu (od
najstarszego), żeby odróżnić stabilne pokrycie od jednej serii.

**5. Skrót typów** — rynki, które utrzymały poziom **we wszystkich** oknach,
uszeregowane wg dolnej granicy przedziału Wilsona (kara za małą próbkę).
Zdarzenia o pokryciu powyżej 93% są odcinane — kurs godziwy poniżej 1,08 nie
jest zakładem, na który da się zagrać.

**6. Wynik meczu** — model bramkowy zestawiony z kursem bukmachera po zdjęciu
marży. Kolumna „Przewaga" pokazuje różnicę w punktach procentowych.

**7. Profile, H2H, Historia** — średnie zdobyte/stracone dla każdej metryki,
bezpośrednie starcia i pełne dane źródłowe stojące za macierzami.

## Metodyka — co warto wiedzieć

- **Projekcja** metryki liczy średnią z tego, co drużyna kreuje, i z tego, na
  co pozwala rywal, na oknie 10 meczów.
- **Model Poissona** jest sensowny dla goli, rożnych, strzałów i fauli.
  Świadomie nie jest liczony dla punktów kartkowych, czerwonych kartek i goli
  do przerwy — tam rozkład jest zbyt skokowy i model by kłamał.
- **Filtr dom–wyjazd** zawęża próbkę o połowę. Przy oknie 20 bywa, że
  realna liczba meczów jest mniejsza — nagłówek komórki zawsze pokazuje
  faktyczne `trafienia/próbka`.
- **Drużyny po awansie** mają krótką historię w swojej lidze. Moduł
  automatycznie dobiera mecze z ligi sąsiedniej (np. Championship dla
  beniaminka Premier League) i informuje o tym w nagłówku analizy.
- Pokrycie historyczne **nie jest** prognozą. To rozkład tego, co się wydarzyło.

## Cache

- **Przeglądarka** — `localStorage`, budżet ok. 3,5 MB, najstarsze wpisy
  usuwane automatycznie. Terminarz 30 minut, sezony 12 godzin.
- **Serwer** — katalog `.stats-cache/` (poza repozytorium). Terminarz 30 minut,
  sezony 6 godzin. Gdy źródło nie odpowiada, serwer oddaje ostatnią znaną
  wersję zamiast błędu.

Przycisk **Cache** w nagłówku czyści oba naraz.
