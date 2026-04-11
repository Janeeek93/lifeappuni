# LifeOS — audyt spójności UI + plan naprawczy (fintech)

Data audytu: 2026-04-11.
Zakres: `index`, `budget`, `tasks`, `trainings`, `fuel`, `loan`, `inventory`, `house`, `investments` + globalne `styles.css`.

## 1) Diagnoza: gdzie i dlaczego aplikacja się „rozjechała”

### A. Fundament globalny jest dobry, ale nie jest konsekwentnie używany
- W `styles.css` masz już sensowny design-token system (`--accent`, `--bg`, `--card`, `--line`, `--radius`, `--topbar-height`) i bazowe komponenty layoutu (`.content`, `.sidebar`, `.site-header`, `.page-content`). To jest świetny punkt startowy pod pełną unifikację.  
- Problem: moduły masowo nadpisują ten fundament przez rozbudowane style lokalne i inline style, przez co każdy ekran robi się „osobnym światem”.

### B. Niespójna nawigacja i ikonografia
- Większość modułów używa Material Symbols w sidebarze, ale `investments.html` używa emoji jako ikon nawigacyjnych (`📊`, `💰`, `✅`, etc.), co wizualnie odcina ten ekran od reszty.  
- To samo dotyczy nagłówków i przycisków: część stron używa emoji jako elementu UX (`💾`, `🧹`, `⬇️`, `⬆️`, `⚙️`), część wyłącznie ikon systemowych.

### C. Różna odległość i relacja „header → subzakładki/menu modułu”
- `budget.html`: subzakładki mają lokalny sticky + dodatkowe `style="margin-top:12px"`, przez co dystans od headera jest inny niż gdzie indziej.  
- `tasks.html`: modułowy nav (`.module-nav`) startuje bezpośrednio pod headerem w innej strukturze i innej skali spacingu.  
- `loan.html`: używa jeszcze innego schematu (`.stack.tight`, własne taby), plus `main` bez `page-content`, co daje inny rytm pionowy.

### D. Skala palety i komponentów wymknęła się spod kontroli
- Każdy moduł ma duże bloki CSS lokalnego. Efekt: bardzo szeroka liczba lokalnych kolorów/gradientów, różne radiusy, różne cienie, różna typografia mikroelementów.
- Szczególnie `budget.html` i `loan.html` są bardzo rozbudowane i „projektowo autonomiczne”.

### E. Różny sposób wykorzystania szerokości strony
- Globalnie `.content` przewiduje układ 2-kolumnowy (main + right rail), ale moduły przełączają się między pełną szerokością i układem wielokolumnowym różnymi metodami (`.content-main`, własne gridy, hard-coded kolumny).  
- To powoduje, że percepcja „gęstości” i „oddechu” UI jest inna na każdym ekranie.

---

## 2) Rekomendowany styl docelowy („Global Fintech v1”)

### Styl wizualny
- **Ton**: nowoczesny fintech B2C/B2B — clean, data-first, spokojny, bez „krzyku” kolorystycznego.
- **Kolor przewodni**: jeden akcent (np. istniejący `--accent: #0057c0`) + semantyki success/warn/error tylko do statusów.
- **Zasada 80/20**: 80% UI neutralne (tło/karty/linia), 20% akcenty funkcyjne.
- **Ikony**: Material Symbols jako standard; emoji tylko jako _opcjonalny content user-generated_ (np. notatka), nie jako systemowe CTA/nav.

### System spacingu (obowiązkowy)
- Skala: `4, 8, 12, 16, 20, 24, 32`.
- Stała odległość: **header → subnav = 16 px** (desktop), 12 px (mobile).
- Stałe wewnętrzne paddings kart: 16 px (compact) / 20 px (standard).

### Siatka i layout
- Jeden kanoniczny schemat:
  - `site-header` sticky na górze,
  - `content` z max szerokością i przewidywalnym gutterem,
  - `page-content` jako główny kontener sekcji.
- Dla modułów „analitycznych” dopuszczony right rail, ale na tym samym mechanizmie i breakpointach.

---

## 3) Plan naprawczy (kolejność wdrożenia)

## Faza 0 — Zamrożenie stylu i kryteria akceptacji (1 dzień)
1. Ustalić „Definition of Done UI” dla każdego modułu:
   - 0 inline stylów strukturalnych,
   - 0 nowych hard-coded kolorów poza tokenami,
   - 100% ekranów na wspólnej siatce i header spacingu,
   - jednolity system ikon (bez emoji systemowych).
2. Dodać checklistę PR dla UI consistency.

## Faza 1 — Design tokens + primitive components (2–3 dni)
1. Wydzielić w `styles.css` warstwy:
   - `tokens` (kolory, spacing, radius, shadow, typography),
   - `primitives` (`.card`, `.btn`, `.badge`, `.tab`, `.input`, `.table`),
   - `layout` (`.site-header`, `.content`, `.page-content`, `.right-rail`).
2. Dodać brakujące tokeny semantyczne:
   - `--surface-1/2`, `--text-1/2/3`, `--border-1/2`, `--focus-ring`,
   - `--space-*`, `--radius-*`, `--elevation-*`.
3. Wprowadzić lint rule / prosty skrypt CI wykrywający nowe kolory hex/rgb poza tokenami.

## Faza 2 — Unifikacja nawigacji i headerów (2 dni)
1. Ujednolicić sidebar:
   - wszędzie Material Symbols,
   - ten sam markup + ten sam active state.
2. Ujednolicić page header:
   - jeden komponent nagłówka + sloty (`title`, `subtitle/badge`, `actions`).
3. Ujednolicić subnawigację modułów:
   - jeden komponent tabs/pills,
   - stały odstęp od headera.

## Faza 3 — Migracja modułów (kolejność ryzyka)
1. **investments** (najmniejszy, szybki „pilot”)  
   - usunąć emoji z nav i CTA,
   - podpiąć komponentowe tabs/badges/buttons.
2. **fuel + inventory + tasks**  
   - zunifikować gęstość kart i tabel,
   - usunąć rozjazdy w gap/padding.
3. **loan + trainings + house**  
   - największe lokalne style; migracja sekcjami.
4. **budget** (na końcu)  
   - największy wolumen i liczba lokalnych wzorców; rozbić na podmoduły i przenosić iteracyjnie.

## Faza 4 — Porządki techniczne (2 dni)
1. Ograniczyć inline style do absolutnego minimum (np. dynamiczne style z JS tylko gdy konieczne).
2. Rozdzielić CSS per warstwa (base/components/modules) i usuwać duplikaty.
3. Dodać wizualne testy regresji (zrzuty porównawcze kluczowych ekranów).

## Faza 5 — QA spójności (1–2 dni)
1. Checklisty per ekran:
   - kolory tylko z tokenów,
   - spacing zgodny ze skalą,
   - identyczne zachowanie hover/focus/active,
   - spójna ikonografia i copy tone.
2. Przegląd mobile/tablet/desktop na tych samych breakpointach.

---

## 4) Priorytety „quick wins” (możesz zrobić od razu)
1. Wyrzuć emoji z systemowej nawigacji i systemowych CTA (zostaw Material Symbols).
2. Ustal jedną odległość `header -> tabs` i zastosuj w `budget/tasks/loan`.
3. Zastąp lokalne hard-coded blues/greens tokenami (`--accent`, `--green`, `--red`).
4. Usuń inline `style="margin-top:12px"` dla tabsów i przenieś spacing do klasy komponentu.

---

## 5) Konkretne obserwacje per moduł
- **Budget**: bardzo duży scope lokalnych styli, własne sticky tabs i inline spacing; najwyższe ryzyko niespójności.  
- **Loan**: własny rozbudowany subsystem kart/tabs + odmienna struktura `main` i spacing.  
- **Tasks**: duża liczba stylów inline i osobny styl „work hub”, który odcina się tonem od fintech core.  
- **Investments**: najsilniejsza niespójność ikonograficzna (emoji w sidebar/nav i przyciskach).  
- **Fuel**: mocno customowy gradient hero / mozaikowy grid; wizualnie atrakcyjny, ale niezgodny z resztą pod względem komponentów.

---

## 6) Proponowana metryka postępu
- `% widoków na komponentach systemowych` (cel: 90%+).
- `% deklaracji kolorów spoza tokenów` (cel: <5%).
- `liczba inline stylów` per moduł (cel: -80%).
- `UI drift score` (manualna ocena 1–5 na: header, tabs, spacing, buttons, tables, icons).

---

## 7) Dane źródłowe użyte w audycie
- Analiza struktury i tokenów globalnych: `styles.css`.
- Analiza implementacji modułów: `index.html`, `budget.html`, `tasks.html`, `trainings.html`, `fuel.html`, `loan.html`, `inventory.html`, `house.html`, `investments.html`.
- Dodatkowo użyto skryptów terminalowych do policzenia liczby kolorów, inline style i emoji na plik.
