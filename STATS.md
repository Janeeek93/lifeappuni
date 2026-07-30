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

Aplikacja działa też bez serwera (otwarta z dowolnego innego hosta lokalnego),
ale wtedy przechodzi na publiczne proxy CORS — wolniejsze i zawodne. Nagłówek
strony pokazuje, które proxy jest aktualnie używane.

## Skąd biorą się dane

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

## Jak czytać dashboard

**1. Źródło danych** — liga, zakres historii (1–4 sezony), okno główne,
filtr dom–wyjazd. Pobrane pliki zostają w cache przeglądarki i na dysku
serwera, więc kolejne analizy w tej samej lidze są natychmiastowe.

**2. Terminarz** — nadchodzące mecze wybranej ligi razem z kursami. Plik
`fixtures.csv` obejmuje ok. tygodnia naprzód i bywa pusty w przerwie
międzysezonowej.

**3. Własne zestawienie** — dowolna para drużyn z wczytanej ligi. Działa
niezależnie od terminarza, więc analiza jest możliwa zawsze.

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
