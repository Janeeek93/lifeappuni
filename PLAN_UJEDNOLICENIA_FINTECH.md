# Plan uspójnienia UI do stylu `loan.html` (globalny fintech vibe)

## Cel
Ujednolicić wszystkie moduły (`index`, `budget`, `tasks`, `trainings`, `fuel`, `inventory`, `house`, `investments`) do jednego języka wizualnego wzorowanego na `loan.html`: czysty fintech, wysoka czytelność danych, konsekwentne KPI + wykresy + stany formularzy, spójne komponenty i nawigacja.

---

## 1) Docelowy wzorzec (source of truth)

### 1.1. Co bierzemy z `loan.html`
- **Główny klimat:** stonowane tła, klarowne karty, mocny kontrast treści finansowej, subtelne akcenty niebieskie/zielone.
- **Hierarchia informacji:**
  - poziom 1: kluczowe KPI,
  - poziom 2: trend / postęp,
  - poziom 3: szczegóły tabelaryczne i akcje.
- **Komponenty wzorcowe:**
  - zakładki typu pill (`loan-tab-btn`),
  - przełączniki trybów wykresu (`loan-chart-mode-btn`),
  - karty analityczne i sekcyjne (`loan-progress-stat`, chart cards),
  - filtry i badge statusów.

### 1.2. Zasady stylistyczne (global fintech)
- Maks. 1 główny kolor akcentu (blue), 1 kolor pozytywny (green), 1 ostrzegawczy (orange), 1 negatywny (red).
- Zero „krzykliwych” gradientów jako domyślny background kart KPI (gradient tylko pomocniczo).
- Border + shadow lekkie, bez ciężkich efektów glass/neon.
- Wszystkie wykresy na spójnym zestawie kolorów i typografii osi/legend.

---

## 2) Architektura docelowa CSS

### 2.1. Warstwy
1. **`styles.css`** – jedyne miejsce dla tokenów globalnych + bazowych komponentów.
2. **`styles.components.css`** (nowy) – wspólne komponenty fintech (`fin-card`, `fin-tabs`, `fin-kpi`, `fin-chart-card`, `fin-filter`).
3. **CSS modułów** – tylko layout i wyjątki domenowe (bez redefinicji button/tab/card core).

### 2.2. Konwencja nazewnicza
- Nowe shared klasy prefiksem `fin-`.
- Klasy legacy (`bm-*`, `inv-*`, część `tasks`) stopniowo mapowane do `fin-*` i usuwane.

### 2.3. Zakaz dalszego dryfu
- Nowe PR-y: brak nowych inline `style="..."` (wyjątek: dynamiczna pozycja wyliczana JS).
- Każdy nowy komponent musi mieć wariant shared lub uzasadniony wyjątek.

---

## 3) Design tokens (globalny kontrakt)

### 3.1. Kolory
- `--fin-bg`, `--fin-surface`, `--fin-card`, `--fin-ink`, `--fin-muted`, `--fin-line`
- `--fin-accent`, `--fin-success`, `--fin-warning`, `--fin-danger`
- Mapowanie starych tokenów (`--blue`, `--green`, `--line` itd.) do nowych aliasów.

### 3.2. Typografia i spacing
- Jedna skala font-size (np. 11/12/14/16/20/24).
- Jedna skala spacing (4/8/12/16/24/32).
- Jedna skala promieni (`8/12/16/20`) i shadow (`sm/md/lg`).

### 3.3. Wykresy (Chart.js)
- Wspólny `chartTheme` helper:
  - osie: muted,
  - grid: `--fin-line`,
  - tooltip: card + ink,
  - legenda: 12px.
- Stała paleta serii: `accent`, `success`, `warning`, `danger`, `purple`, `neutral`.

---

## 4) Komponenty shared do wdrożenia

1. **Header**: jeden standard (`site-header` + spójny subtitle + akcje).
2. **Button**: `fin-btn` (`primary`, `soft`, `ghost`, `danger`, `sm`).
3. **Card**:
   - `fin-card` (sekcja),
   - `fin-kpi-card` (liczba + label + trend),
   - `fin-chart-card` (nagłówek + canvas + legenda).
4. **Tabs/Filters**:
   - `fin-tabs` + `fin-tab` (zachowanie jak w `loan.html`),
   - `fin-filter-chip`.
5. **Badges/Pills**:
   - `fin-pill--success/warn/danger/info/neutral`.
6. **Tabela**:
   - `fin-table` (sticky head, zebra optional, gęstość compact/default).
7. **Form controls**:
   - `fin-input`, `fin-select`, `fin-textarea`, `fin-field`.

---

## 5) Plan migracji per moduł

## Etap A (największy efekt wizualny, niski koszt)
### A1. `investments.html`
- Zamienić emoji w sidebar na Material Symbols.
- Przepiąć `page-header` na wspólny `site-header` stylizowany fintech.
- Zmienić lokalne `.sheet-card`, `.filter-tabs` na `fin-card` + `fin-tabs`.

### A2. `fuel.html` i `inventory.html`
- Ujednolicić nazwy i wygląd lokalnych kafli do `fin-card`.
- Ograniczyć inline style; przenieść spacing/size do utility/shared klas.
- Spiąć wykresy i statystyki pod wspólny `chartTheme`.

## Etap B (średni koszt, duży wpływ)
### B1. `trainings.html`
- Zredukować równoległe rodziny buttonów (`action-btn`, `icon-btn`) do `fin-btn` + ewentualne modyfikatory.
- Ujednolicić panele i listy do struktury kart jak w `loan`.

### B2. `index.html` (dashboard)
- Zostawić bento layout, ale wymusić fintech skin:
  - wspólne promienie,
  - wspólne karty KPI,
  - jednolita typografia liczb i trendów.

## Etap C (największy koszt, największy dryf)
### C1. `budget.html`
- Rozbić ogromny lokalny CSS na sekcje i zastąpić komponentami `fin-*`.
- W pierwszym kroku migrować nav/tab/btn/card; dopiero potem szczegółowe widoki inwestycji.

### C2. `tasks.html`
- Migracja z lokalnego „editorial CRM” do fintech skinu bez ruszania logiki.
- Zostawić strukturę informacji, ale podmienić warstwę wizualną na shared (`fin-card`, `fin-tabs`, `fin-btn`).

### C3. `house.html`
- Decyzja produktowa:
  - **Wariant 1 (rekomendowany):** pełna migracja BuildMaster do fintech skin.
  - **Wariant 2:** pozostawienie „sub-brandu”, ale na wspólnych tokenach i komponentach bazowych.

---

## 6) Harmonogram (propozycja 6 sprintów)

### Sprint 1
- Ustalenie tokenów `fin-*`, `chartTheme`, definicja komponentów shared.
- Migracja `investments` + sidebar icons globalnie.

### Sprint 2
- Migracja `fuel`, `inventory`.
- Wspólny standard headerów (koniec mixu `site-header/page-header`).

### Sprint 3
- Migracja `trainings` (buttony/tabs/cards).
- Refactor dashboard skin (`index`).

### Sprint 4–5
- `budget` etapami (najpierw shell i komponenty bazowe, potem widoki analityczne).

### Sprint 6
- `tasks` + decyzja i wdrożenie dla `house`.
- Ostateczny cleanup legacy klas i inline styles.

---

## 7) Definition of Done (dla każdego modułu)
- [ ] Header zgodny ze standardem shared.
- [ ] Buttons/tabs/cards tylko z `fin-*` (lub oficjalnych globalnych aliasów).
- [ ] Wykresy podłączone do wspólnego `chartTheme`.
- [ ] Inline style zredukowane min. o 80% vs baseline.
- [ ] Brak lokalnych redefinicji core tokenów kolorów.
- [ ] Test visual regression (desktop + mobile).

---

## 8) Metryki sukcesu
- Spadek `style="..."` w HTML o min. **70%** globalnie.
- Co najmniej **90% ekranów** używa shared `fin-btn`, `fin-card`, `fin-tabs`.
- 100% modułów ma ten sam wzorzec headera i sidebar iconografii.
- 100% wykresów ma wspólny theme i legendę.

---

## 9) Ryzyka i zabezpieczenia
- **Ryzyko:** regresje wizualne i „rozsypanie” gęstych widoków (`budget`, `tasks`).
  - **Mitigacja:** migracja warstwowa (shell → komponenty → detale).
- **Ryzyko:** opór przed zmianą w `house` (tożsamość modułu).
  - **Mitigacja:** decyzja product/brand na starcie Sprintu 4.
- **Ryzyko:** duże PR-y trudne do review.
  - **Mitigacja:** małe PR-y per komponent + per moduł.

## 10) Najbliższy krok (od jutra)
1. Zatwierdzić ten plan i docelowy styl referencyjny (`loan.html`).
2. Wydzielić `fin-*` komponenty shared i `chartTheme`.
3. Zacząć od `investments` + globalnych ikon/sidebar, żeby szybko domknąć najbardziej widoczne niespójności.
