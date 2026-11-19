# Road to Glory 2027 (trainings.html)

Nowy moduł Progres, zbudowany od zera. Stary moduł (dane 2025–2026) działa dalej jako `trainings-legacy.html`
(klucze `lifeos_trainings_month_v1`, `lifeos_body_metrics_v1` — nietknięte, używane też do porównań).

Pliki: `rtg.js` (silnik, bez DOM), `rtg-ui.js` (widoki), `rtg.css`. Dane: `localStorage['lifeos_rtg_v1']`,
w backupie pod kluczem `rtg`.

## Cele (domyślne, edytowalne w Ustawieniach)
siłownia 3 treningi/tydz. (trening z zegarka < 20 min nie liczy się) · bieg 5 km/tydz. · czytanie 100 str./tydz. ·
kalorie: dzień „w widełkach” (domyślnie 2100–2400, wymaga potwierdzenia w Ustawieniach), min. 6 dni/tydz.
Tydzień = pon–nd. Tydzień „zamknięty” = wszystkie 4 cele zaliczone. Tygodnie wolne (`offWeeks`) nie psują serii.
Sezon: 52 tygodnie od `season.start` (pn 2027-01-04); wcześniejsze tygodnie to „rozgrzewka” (nie liczą się do sezonu).

## Format danych / paczki do wczytania
```
{ "rtg": {
  "workouts": [{ "id?", "date":"YYYY-MM-DD", "kind":"gym|run|other", "start":"HH:MM", "min":46, "km":5.2, "avgHr":120, "maxHr":150, "kcal":300, "src":"Apple Watch" }],
  "days":     { "YYYY-MM-DD": { "kcal":2250, "protein":150, "carbs":..., "fat":..., "pages":30, "steps":9000, "sleepH":7.1, "rhr":55, "hrv":60 } },
  "body":     [{ "date":"YYYY-MM-DD", "weight":71.2, "bf":18.5, "lean":58, "waist":80 }],
  "goals?":{}, "offWeeks?":{ "YYYY-MM-DD(pn)":"urlop" }, "season?":{} } }
```
Wczytanie (Ustawienia → „Wczytaj paczkę danych”, albo klucz `rtg` w pełnym backupie) scala dane:
treningi po `id`, dni i pomiary po dacie; niczego nie kasuje. Ponowne wczytanie tej samej paczki jest bezpieczne.
