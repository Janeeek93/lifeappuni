# Audyt spójności UI — LifeOS (zakładki/moduły)

## Zakres i metodologia
- Przeanalizowano wszystkie zakładki: `index`, `budget`, `tasks`, `trainings`, `fuel`, `loan`, `inventory`, `house`, `investments`.
- Oceniano: układ (layout), nagłówki i nawigację, system kolorów/tokenów, typografię, komponenty (przyciski/karty/tabs), stopień inline CSS, spójność semantyczną klas.
- Audyt oparto na aktualnym kodzie HTML/CSS i strukturze klas.

## TL;DR (najważniejsze problemy)
1. **Masz 3 równoległe „systemy UI”** zamiast jednego: 
   - globalny (`styles.css`),
   - modułowy „enterprise” (`tasks`),
   - modułowy „brandowany” (`house`) + uproszczony (`investments`).
2. **Bardzo wysoka liczba styli inline** (szczególnie `budget`, `tasks`, `house`) utrudnia skalowanie i kontrolę spójności.
3. **Niespójne top bary i page headers** — część modułów używa `site-header`, część `page-header`, część obu.
4. **Niespójny język komponentów**: różne rodziny przycisków (`.btn`, `.bm-btn`, `.action-btn`), różne style tabs/nav.
5. **Nawigacja boczna wizualnie niespójna**: Material Symbols vs emoji ikony (szczególnie `investments`).

## Twarde wskaźniki niespójności
| Zakładka | Bloki `<style>` | Atrybuty `style="..."` |
|---|---:|---:|
| `budget.html` | 1 | **409** |
| `tasks.html` | 1 | **255** |
| `house.html` | 2 | **184** |
| `index.html` | 1 | 94 |
| `inventory.html` | 1 | 34 |
| `loan.html` | 2 | 25 |
| `trainings.html` | 1 | 23 |
| `fuel.html` | 1 | 17 |
| `investments.html` | 1 | 4 |

> Wniosek: największy „dryf UI” generują moduły z ogromną liczbą inline styles (`budget`, `tasks`, `house`).

---

## Analiza per zakładka

### 1) Dashboard (`index.html`)
**Co jest ok:**
- Opiera się na aktualnym shellu (`app-shell`, `sidebar`, `site-header`) i tokenach globalnych.
- Używa Material Symbols i globalnych klas przycisków.

**Niespójności:**
- Dużo `style="..."` w strukturze bento (animacje, min-height, spacing), co obchodzi system komponentowy.
- Jest jedyną zakładką z aktywną mobilną nawigacją dolną (`mobile-bottom-nav`) — UX mobilny nie jest równy między modułami.

**Ryzyko UX:** średnie (wizualnie nowocześnie, ale trudniej utrzymać).

### 2) Budżet (`budget.html`)
**Co jest ok:**
- Funkcjonalnie bogaty moduł, rozbudowane widoki i stany.
- Częściowo trzyma się tokenów (`var(--line)`, `var(--surface)` itd.).

**Niespójności (krytyczne):**
- Ekstremalnie dużo inline styles.
- Ogromny lokalny CSS (własny mini-design-system inwestycji) — tabs, cards, modal, analytics nav itd. odseparowane od globalnych komponentów.
- Mieszanie wzorców (lokalne klasy `inv-*` + globalne `btn`, `card`) bez jasnych zasad warstw.

**Ryzyko UX:** bardzo wysokie (rozjazd estetyki i zachowań między sekcjami).

### 3) Zadania (`tasks.html`)
**Co jest ok:**
- Konsekwentna estetyka *wewnątrz* modułu (spójny „editorial/CRM look”).
- Wysoka jakość stanów i mikrokomponentów.

**Niespójności:**
- Definiuje własny zestaw tokenów i komponentów (de facto drugi design system), np. inne radiusy, inne nazewnictwo, inne kontrasty.
- Własna nawigacja modułowa (`module-nav`, `mod-tab`) odstaje od innych tabs w aplikacji.
- Bardzo dużo inline styles w HTML.

**Ryzyko UX:** wysokie (moduł wygląda profesjonalnie, ale „nie jak reszta LifeOS”).

### 4) Progres (`trainings.html`)
**Co jest ok:**
- Relatywnie umiarkowany poziom inline CSS.
- Używa globalnych tokenów i część globalnych utility.

**Niespójności:**
- Obok `.btn` występują też odrębne rodziny (`.action-btn`, `.icon-btn`, `quick-add-btn`), które duplikują znaczenia i styl.
- Własne warianty przycisków częściowo niespójne z globalnym `.btn.primary/.soft/.ghost`.

**Ryzyko UX:** średnie.

### 5) Paliwo (`fuel.html`)
**Co jest ok:**
- Trzyma `site-header`, `sidebar`, globalne `.btn`.
- Umiarkowana skala lokalnych rozszerzeń.

**Niespójności:**
- Lokalny nomenklator sekcji/kafli (`fp`, `fct`, insight bubble) odbiega od innych modułów.
- Część spacing/typografii idzie inline.

**Ryzyko UX:** niskie/średnie.

### 6) Kredyt (`loan.html`)
**Co jest ok:**
- Czytelna struktura i dobre komponenty analityczne.
- Rozsądna liczba inline styli.

**Niespójności:**
- Mieszanie globalnych tokenów z lokalnym nadpisywaniem (`body[data-page="loan"]` + lokalne redefinicje) komplikuje przewidywalność.
- Własne warianty tabs (`loan-tab-btn`, `schedule-filter-btn`) podobne semantycznie do innych modułów, ale stylowane inaczej.

**Ryzyko UX:** średnie.

### 7) Magazyn (`inventory.html`)
**Co jest ok:**
- Relatywnie blisko globalnego stylu (`site-header`, `btn`, `card`).
- Struktura sekcji jest czytelna i dość lekka.

**Niespójności:**
- Widoczne wstawki inline w nagłówkach i formularzach.
- Mieszanie semantyki (`site-header` + elementy `page-header__badges`) może dawać efekt „sklejki”.

**Ryzyko UX:** niskie/średnie.

### 8) Budowa (`house.html`)
**Co jest ok:**
- Bardzo spójny *wewnętrznie* brand modułu „BuildMaster Pro”.

**Niespójności (krytyczne):**
- To osobny język wizualny (`bm-*`, własne buttony, inne tone-of-voice, branding i hierarchia).
- Dużo inline styles.
- Integruje się na poziomie shella, ale wizualnie zachowuje się jak osobna aplikacja.

**Ryzyko UX:** bardzo wysokie (największy „outlier” marki LifeOS).

### 9) Inwestycje (`investments.html`)
**Co jest ok:**
- Mało inline CSS.
- Czytelny, prosty układ.

**Niespójności:**
- Używa `page-header`, gdy większość modułów jest na `site-header`.
- Sidebar ma **emoji** zamiast Material Symbols — to najbardziej widoczny drift nawigacji.
- Część wzorców (sheet-card, filter-tabs) to osobny mikro-system.

**Ryzyko UX:** średnie/wysokie (przez nawigację i header).

---

## Główne źródła dryfu
1. **Brak jednego kontraktu komponentowego** (header/tab/card/button).
2. **Lokalne mini-design-systemy** w modułach (`inv-*`, `bm-*`, `tasks` tokens).
3. **Inline CSS jako domyślny sposób „szybkiego dowiezienia”** nowych funkcji.
4. **Brak centralnego governance** (np. checklista PR: „użyto globalnych tokenów?”, „nowy komponent trafił do shared?”).

## Priorytety naprawy (kolejność)

### Faza 1 — szybkie porządki (1–2 iteracje)
- Ujednolicić **sidebar icons** do jednej biblioteki (Material Symbols).
- Ustalić jeden wzorzec nagłówka stron (`site-header` albo `page-header`) i migrować odstępstwa.
- Wydzielić najczęściej powtarzane inline style do klas utility (`.mt-8`, `.h-260`, `.text-muted-sm`, itp.).

### Faza 2 — standaryzacja komponentów (2–4 iteracje)
- Zdefiniować oficjalne komponenty shared:
  - `Button` (primary/soft/ghost/danger + rozmiary),
  - `Tabs` (1 wspólny wariant),
  - `Card` (bazowa + KPI + section),
  - `Badge/Pill` (1 semantyka kolorów).
- Ograniczyć lokalne style do warstwy „feature skin”, nie „core ui”.

### Faza 3 — najtrudniejsze moduły
- Refactor `budget` i `tasks` (najpierw komponenty, potem layout).
- Dla `house`: decyzja produktowa:
  - albo celowo zostaje „brand satellite”,
  - albo redukcja brandingu do poziomu spójnego z LifeOS.

## Proponowane KPI spójności (mierzone co release)
- `inline_style_count` per moduł (target: -70% w 2–3 sprintach).
- `% ekranów korzystających z shared Button/Tabs/Card`.
- `# lokalnych tokenów kolorów` poza `styles.css`.
- `# wyjątków nawigacji` (np. inne ikony, inne headery).

## Rekomendacja końcowa
Twoja intuicja jest **w 100% trafna**: aplikacja jest funkcjonalnie bogata, ale UI składa się z kilku równoległych estetyk. Największe źródła niespójności to obecnie: `budget`, `tasks`, `house` oraz nawigacja w `investments`. Najszybszy efekt da Ci ujednolicenie nagłówków/nawigacji i wycięcie inline CSS do wspólnych klas utility oraz komponentów shared.
