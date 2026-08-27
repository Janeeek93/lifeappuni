# Moduł Karty — kolekcja i odsprzedaż kart piłkarskich

Osobna sekcja LifeOS (`cards.html`) do prowadzenia kolekcji jak portfela
inwestycyjnego: co kupione, ile warte dziś, ile realnie wyszło z boxa,
gdzie zostaje najwięcej marży i co wymaga decyzji.

```bash
node server.js
# http://localhost:8787/cards.html
```

Pliki: `cards.html` (widok), `cards.css` (tokeny + komponenty), `cards.js` (logika).
System komponentów dziedziczy z `styles.css` i `trading.css` — tak samo jak moduł Zakłady.

Dane siedzą w `localStorage` pod kluczem **`lifeos_cards_v1`**.

## Co ogarnia

| Zakładka | Do czego służy |
|---|---|
| **Przegląd** | Wartość kolekcji, pasek odzysku kapitału, lejek kapitału od zakupu przez stock do sprzedaży, wynik łączny, krzywa wyceny vs koszt, lista „do zrobienia", ruchy wyceny, najcenniejsze karty |
| **Kolekcja** | Tabela kart z filtrami i sortowaniem, szczegóły karty z historią wyceny i osią zdarzeń |
| **Boxy i breaki** | Sealed na stanie, wynik każdego breaka, EV produktów, flipy sealed |
| **Sprzedaż** | Pipeline wystawionych, historia transakcji z rozbiciem na prowizje, analiza kanałów |
| **Grading** | Wysyłki do PSA/BGS/SGC/CGC, wynik gradingu, kalkulator opłacalności |
| **Koszty** | Struktura wszystkich kosztów, przepływy miesięczne, rejestr kosztów ogólnych |
| **Analityka** | Koncentracja portfela, wiek pozycji, rozkład ROI, rankingi, próg 6 miesięcy, płynność |
| **Watchlista** | Karty na celowniku z ceną docelową i luką do rynku |

Przycisk **Wgraj dane demo** w Ustawieniach wypełnia moduł przykładową kolekcją
(3 breaki, flip sealed, grading w toku i rozliczony, sprzedaże, koszty) — dobre
do obejrzenia wszystkich widoków przed pierwszym własnym wpisem.

## Cztery ścieżki, które moduł obsługuje

1. **Rip boxa.** Kupujesz box → *Otwieram box* → wpisujesz karty, które warto
   wpisać, plus wartość bulku. Moduł liczy zwrot, wynik i mnożnik breaka, a karty
   wchodzą do kolekcji z rozliczonym kosztem.
2. **Single z rynku wtórnego.** Vinted, eBay, Cardmarket. Osobno cena, wysyłka,
   prowizja, cło — bo prawdziwy koszt to nie jest kwota z ogłoszenia.
3. **Flip sealed.** Box kupiony w DE/UK oznaczasz jako sprzedany bez otwierania.
   Zakładka *Flipy sealed* pokazuje marżę po prowizjach i kursie waluty.
4. **Grading.** Wysyłasz surowe karty, rejestrujesz koszt, po powrocie wpisujesz
   oceny i nowe wyceny. Moduł liczy, czy przyrost wartości pokrył koszt.

## Wycena kolekcji

Wycena **nie jest polem karty, tylko wpisem w historii**. Każda sesja wyceny
dokłada punkt z datą, źródłem i wartością. Dzięki temu:

- wartość kolekcji da się odtworzyć na dowolny dzień wstecz, a nie tylko „na dziś",
- wykres wyceny vs koszt liczy się z tego samego źródła co tabele,
- karta ma własną krzywą wartości i widać, kiedy teza zaczęła się sprawdzać.

Sesja wyceny (przycisk w nagłówku) domyślnie pokazuje tylko karty z wyceną starszą
niż próg z ustawień. Puste pole = bez zmian. *Przenieś resztę bez zmian* zapisuje
bieżące wartości z nową datą — czyli „sprawdziłem, nic się nie ruszyło".

## Koszt boxa rozłożony na karty

Żeby ROI pojedynczej karty z boxa w ogóle coś znaczyło, cena boxa musi trafić na
wyciągnięte karty. Trzy metody (Ustawienia → Rozliczanie breaków):

| Metoda | Jak dzieli | Kiedy używać |
|---|---|---|
| **Proporcjonalnie do wartości** (domyślna) | droga karta bierze większą część kosztu | standard księgowy; wynik breaka i suma wyników kart zawsze się zgadzają |
| **Po równo** | każda karta tyle samo | gdy chcesz porównywać karty z różnych boxów po ROI |
| **Zerowy koszt** | karty wchodzą za 0 zł | gdy traktujesz box jako koszt rozrywki, a karty jako bonus |

Uwaga przy metodzie proporcjonalnej: **wszystkie karty z jednego boxa mają wtedy
identyczne ROI**, równe mnożnikowi breaka minus 100%. To nie błąd, tylko własność
tego podziału — ROI pojedynczego pulla przestaje nieść informację. Jeśli chcesz
porównywać pulle między sobą, przełącz na „po równo".

Przełącznik **„Czy bulk pomniejsza koszt pulli"** decyduje, czy wartość reszty z
boxa najpierw obniża bazę kosztową kart (domyślnie tak), czy liczy się jako osobny
zysk breaka.

### Baza kosztowa jest zamrażana

Podział kosztu zapisuje się na kartach w momencie zamknięcia breaka i **nie zmienia
się przy późniejszych wycenach**. Bez tego każda nowa wycena karty B zmieniałaby
wstecznie zysk zrealizowany na karcie A sprzedanej pół roku wcześniej — a wynik
zamkniętego miesiąca nie ma prawa się ruszać.

Baza liczona jest od nowa tylko wtedy, gdy realnie się zmienia: przy edycji breaka,
dopięciu lub usunięciu karty z boxa, zmianie ceny boxa i przy zmianie metody podziału.

## Odzysk kapitału

Sekcja **Przegląd → Odzysk kapitału** odpowiada na pytanie „ile z tego, co
włożyłem, już wróciło i za ile jeszcze muszę sprzedać, żeby wyjść na zero".
Cały pasek to koszty poniesione lifetime, a dzieli się dokładnie na trzy części:

```
wydane lifetime = odzyskane gotówką + luka pokryta towarem + luka bez pokrycia
```

- **odzyskane gotówką** — netto ze wszystkich sprzedaży, po prowizjach i wysyłce,
- **luka pokryta towarem** — ta część niedoboru, którą da się zamknąć sprzedając
  dzisiejszy stan magazynu (po wycenie albo po cenie zakupu — patrz przełącznik niżej),
- **luka bez pokrycia** — to, czego nie pokrywa nawet sprzedaż całości. Zero w tym
  polu znaczy, że wyjście na zero jest w zasięgu ręki.

### Wycena rynkowa czy cena zakupu

Przełącznik **Towar licz po** w nagłówku sekcji decyduje, czym wypełnia się
niebieski segment. Wybór zapisuje się w ustawieniach modułu i przeżywa odświeżenie.

| Tryb | Co liczy | Po co |
|---|---|---|
| **wycenie** (domyślnie) | towar po dzisiejszej wycenie rynkowej | „ile realnie da się jeszcze wyciągnąć z rynku" |
| **cenie zakupu** | towar po tym, co za niego zapłaciłeś | pasek wypełniają **wyłącznie realnie wydane pieniądze** — podniesienie wyceny go nie ruszy |

Tryb *cenie zakupu* jest ostrzejszy z definicji: karta, która zdrożała, i tak
liczy się po cenie zakupu, więc pasek nie rośnie od samego mark-to-market.
Najlepiej widać to na **pokryciu luki** — ta sama kolekcja potrafi pokazać
`1,90×` po wycenie i `1,01×` po koszcie. Druga liczba mówi, że bez wzrostu cen
wyjście na zero wisi na włosku.

Drabina płynności liczy się w tym samym trybie co pasek, więc udziały w towarze
i w luce zawsze zgadzają się z liczbami nad nią. Po stronie ceny zakupu ostatni
szczebel to nieprzypisany koszt otwartych boxów — bulk nie ma własnego kosztu,
bo przy odliczaniu bulku baza pulli jest już o niego mniejsza.

### Segment towaru jest przycięty do luki

Pasek mierzy zwrot wydatków, więc nie ma prawa przekroczyć 100%. Jeśli towar
jest wart więcej, niż wynosi luka, nadmiar nie mieści się w pasku i pokazuje się
w legendzie jako **zapas towaru ponad lukę**. To ta pozycja najmocniej różni oba
tryby wyceny, kiedy sam pasek wygląda w nich identycznie.

### Sześć liczb pod paskiem

| Kafelek | Co mówi |
|---|---|
| **Wydane lifetime** | wszystkie koszty razem: boxy, single, grading, koszty ogólne — plus średnia miesięczna od pierwszego zakupu |
| **Wróciło w gotówce** | suma netto ze sprzedaży; procent bywa większy niż 100%, gdy kapitał wrócił z nadwyżką |
| **Zostało do odzyskania** | ile jeszcze musi wpłynąć **netto** — i za ile trzeba wystawić **brutto**, bo prowizje policzone z własnej historii sprzedaży zjadają swoje |
| **Zamrożone w towarze** | stan w aktywnym trybie, a obok w podpisie ta sama pozycja policzona drugim sposobem |
| **Pokrycie luki towarem** | ile razy stan magazynu pokrywa lukę. Poniżej `1,00×` sprzedaż całości nie wystarcza, żeby wyjść na zero. Reaguje na przełącznik wyceny mocniej niż sam pasek |
| **Tempo netto (90 dni)** | wpływy minus wydatki z ostatniego kwartału w przeliczeniu na miesiąc. Dodatnie — pokazuje termin progu zwrotu; ujemne — mówi wprost, że luka rośnie |

Pod kafelkami to samo jednym zdaniem po polsku, żeby nie trzeba było czytać sześciu
liczb naraz.

### Płynność zamrożonego kapitału

Drabina pokazuje, gdzie stoi kapitał — w trybie wybranym przełącznikiem, uszeregowana od najbliższego gotówce:
**wystawione → karty na stanie → w gradingu → sealed → bulk z breaków**. Każdy
szczebel podaje swój udział w towarze i w luce do odzyskania — z tego widać, czy
lukę zamyka jedna wystawiona karta, czy dopiero rozpakowanie i sprzedaż wszystkiego.

To ta sama informacja, na którą patrzy się przy decyzji „kupować dalej czy najpierw
upłynnić": tempo netto mówi, w którą stronę idzie płynność, a drabina — co da się
zamienić na gotówkę najszybciej.

## Jak spina się rachunek

Podstawowa tożsamość, liczona wprost:

```
wynik łączny = majątek + wpływy − wydatki
```

gdzie majątek to wycena kart na stanie + sealed w cenie zakupu + wartość bulku.
Rozbicie na czynniki (pasek pod wykresem w Analityce):

```
wynik łączny = zysk zrealizowany
             + zysk na papierze
             + bulk
             − koszt breaków nieprzypisany do żadnej karty
             − koszty ogólne
```

Kolumna **Różnica** w tym pasku musi pokazywać `0 zł`. Jeśli pokazuje cokolwiek
innego, dane są niespójne — to celowy bezpiecznik, a nie ozdoba.

Karta wyciągnięta z boxa **nie generuje własnego wydatku** — pieniądze wyszły przy
zakupie boxa. Inaczej ten sam koszt liczyłby się dwa razy.

## Rzeczy, które łatwo przeoczyć, a moduł ich pilnuje

- **Prawdziwy koszt zakupu** — cena + wysyłka + prowizja + cło/VAT, przeliczone po
  kursie z dnia zakupu. Kursy z NBP jednym kliknięciem w Ustawieniach.
- **Prowizje sprzedaży** — każdy kanał ma własny procent, więc „sprzedane za 300 zł"
  na eBayu to nie to samo co na Vinted.
- **Koszty ogólne** — toplo, koperty, dojazd na giełdę, subskrypcje. Bez nich ROI
  jest zawyżone; osobny rejestr i udział w strukturze kosztów.
- **Koncentracja portfela** — udział największej pozycji, top 5 i indeks HHI.
  Alert, gdy jeden zawodnik przekroczy ustawiony próg.
- **Martwy stock** — karty leżące dłużej niż próg bez wystawienia. Kapitał śpi.
- **Wiek ogłoszeń** — ogłoszenie wiszące miesiącami to informacja, że cena jest za wysoka.
- **Próg 6 miesięcy (PIT)** — sprzedaż rzeczy ruchomych po pół roku od nabycia jest
  poza PIT. Moduł liczy dni i ostrzega, gdy karta zbliża się do progu.
- **Sealed bez decyzji** — box leżący ponad próg dostaje przypomnienie: rip czy flip.
- **EV produktów** — po kilku breakach widać, który produkt realnie się opłaca ripować,
  a który tylko wygląda atrakcyjnie.

## Połączenie z Budżetem

Moduł Karty jest źródłem prawdy, budżet dostaje odbicie. Wszystko dzieje się
automatycznie przy każdym zapisie; status i kwoty widać w zakładce **Koszty →
Połączenie z budżetem**, przełączniki w **Ustawieniach**.

| Zdarzenie w Kartach | Co ląduje w Budżecie |
|---|---|
| Zakup boxa | wydatek zmienny: pełny koszt z wysyłką, cłem i prowizją |
| Zakup karty single | wydatek zmienny: cena + wysyłka + prowizja + cło |
| Pull z boxa | **nic** — pieniądze wyszły już przy zakupie boxa |
| Wysyłka do gradingu | wydatek zmienny: opłaty + wysyłka + ubezpieczenie |
| Koszt ogólny | wydatek zmienny |
| Sprzedaż karty lub sealed | przychód w miesiącu sprzedaży, kwota **netto** po prowizjach i wysyłce |
| Karty i sealed na stanie | nie są kosztem, który przepadł — wchodzą do Sald EOM jako aktywo |

Kategoria wydatków dobiera się sama: moduł szuka istniejącej kategorii wydatków
zmiennych z „kart" w nazwie, a jeśli takiej nie ma, zakłada **Karty piłkarskie**.
W Ustawieniach można wskazać dowolną inną.

### Synchronizacja jest uzgadniająca, nie doklejająca

Każdy wpis w budżecie ma deterministyczne id (`tx_cards_box_…`, `inc_cards_card_…`),
więc przy każdym zapisie moduł liczy zbiór docelowy i doprowadza budżet do zgodności:
dodaje brakujące, poprawia zmienione, kasuje nieaktualne. W praktyce:

- zmiana ceny boxa aktualizuje istniejący wydatek zamiast dokładać drugi,
- usunięcie karty zabiera jej wpis z budżetu,
- kilkukrotny zapis niczego nie mnoży,
- wpisy spoza modułu (własne transakcje, przychody z pracy) są nietykalne.

**Dane demo wyłączają księgowanie**, żeby przykładowa kolekcja nie zaśmieciła
prawdziwego budżetu. Po wyczyszczeniu modułu przełącznik wraca na „tak".

### Salda EOM — konto „Karty"

Moduł publikuje podsumowanie do wspólnego magazynu `lifeos_kpis_v1` (klucz `cards`),
a Salda EOM tylko je odczytują — budżet nie musi znać modelu danych kolekcji.

Przy pierwszym wejściu w Salda EOM, gdy moduł Karty ma już jakieś dane, zakłada się
konto **Karty** typu Inwestycje. Przycisk **Pobierz aktualne** (globalny albo ⭳ przy
wierszu) wstawia w nie **majątek łącznie**: wycena kolekcji + sealed w cenie zakupu
+ wartość bulku. Konto Karty nigdy nie dostanie wartości portfela inwestycyjnego,
nawet gdy nie ma skonfigurowanego mostka.

W panelu *Połączenie z inwestycjami* można zmapować dokładniej — dostępne źródła:
majątek łącznie, sama wartość kolekcji, sam sealed, sama baza kosztowa.

Skasowane konto „Karty" nie wraca (flaga `cardsAccountSeeded` w budżecie).
Publikowanie wartości do EOM działa niezależnie od księgowania wydatków — można
wyłączyć jedno, zostawiając drugie.

> Obie zakładki czytają `localStorage` przy wejściu, więc jeśli trzymasz Budżet
> i Karty otwarte jednocześnie, odśwież Budżet, żeby zobaczyć świeże wpisy.

## Import, eksport, kopie

- **Import wklejką** (Kolekcja → Import): `zawodnik; produkt; parallel; nakład; cena; wartość dziś; data`.
  Wystarczy sam zawodnik. Można przypisać całą wklejkę do jednego boxa.
- **Eksport CSV** — pełna tabela kart z policzoną bazą kosztową, wyceną, P&L i ROI.
  Średnik jako separator i BOM, więc Excel otwiera bez kombinowania.
- **Eksport / import JSON** — kompletny backup modułu.
- **Backup całej aplikacji** (Dashboard → Eksport / Import) obejmuje też Karty —
  cały moduł siedzi w pliku pod kluczem `cards`, razem z historią wycen i ustawieniami.

## Czego moduł jeszcze nie robi

- Nie pobiera cen automatycznie. Wyceny są ręczne — świadomie, bo przy kilkunastu
  kartach miesięczna sesja to kilka minut, a żadne darmowe API nie poda sensownej
  ceny parallela z niskim nakładem.
- Nie obsługuje wielu egzemplarzy tej samej karty w jednym rekordzie — każda karta
  to osobna pozycja, bo każda ma własny stan, wycenę i historię.
