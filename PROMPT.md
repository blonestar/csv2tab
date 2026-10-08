# csv2tab — web aplikacija (prompt / specifikacija)

Napravi web aplikaciju **csv2tab** koja pretvara CSV i ODS fajlove u tab-delimited (.tab / .tsv) fajl. Hostuje se na Vercelu (cilj: `csv2tab.vercel.app`). UI je na srpskom (latinica, ekavica).

## Arhitektura
- Statička aplikacija: **Vite + TypeScript**, bez backenda. Sva obrada ide u browseru — fajl nikad ne napušta korisnikov računar (to istaći u UI-ju).
- Jedina runtime zavisnost: **fflate** (za raspakivanje ODS-a). ODS XML parsirati preko `DOMParser`. CSV parser napisati sam (RFC 4180: navodnici, `""` escape, novi redovi unutar navodnika).
- `vercel.json` nije neophodan (Vercel sam prepoznaje Vite), ali build mora da prođe sa `npm run build` → `dist/`.
- Logiku konverzije držati u zasebnim, čistim modulima (`src/lib/csv.ts`, `src/lib/ods.ts`, `src/lib/clean.ts`, `src/lib/tsv.ts`) i pokriti ih testovima (**vitest**).

## Šta su formati
- **CSV**: tekst, kolone razdvojene zarezom (u Srbiji/EU često **tačka-zarez**, jer je zarez decimalni separator). Vrednosti sa separatorom ili novim redom idu pod navodnike.
- **TAB/TSV**: isto, ali separator je tab (`\t`). Tab i novi red ne smeju biti unutar ćelije (zameniti razmakom).
- **ODS**: OpenDocument Spreadsheet (LibreOffice). ZIP arhiva; podaci su u `content.xml`:
  - `table:table` (list, atribut `table:name`) → `table:table-row` → `table:table-cell` / `table:covered-table-cell`.
  - `table:number-rows-repeated` i `table:number-columns-repeated` — ponavljanja; prazne ćelije/redove na kraju **odseći** (LibreOffice zna da stavi repeated=1048576).
  - Vrednost: ako je `office:value-type` float/percentage/currency → `office:value` (sirovi broj sa tačkom); date → `office:date-value`; time → `office:time-value`; boolean → `office:boolean-value`; inače tekst iz `text:p` (spojiti više paragrafa sa `\n`; `text:s` = `text:c` razmaka, `text:tab`, `text:line-break`).

## Tok rada (UI)
1. **Upload**: drag & drop zona + dugme; prihvata `.csv`, `.txt`, `.ods`. Više fajlova = lista, pa se bira aktivni.
2. **Detekcija** (prikazati i dozvoliti ručnu promenu):
   - Kodiranje: probaj UTF-8 (sa `fatal: true`, skini BOM), pa **windows-1250**, pa latin-1. Proveriti da č ć đ š ž izgledaju ispravno.
   - Separator CSV-a: auto između `,` `;` `\t` `|` (onaj koji daje najkonzistentniji broj kolona u prvih ~50 redova).
   - Za ODS: izbor lista (dropdown).
3. **Preview / inspekcija**: tabela sa prvih npr. 500 redova (sticky header, broj reda, horizontalni scroll), ukupno redova/kolona. Upozorenja:
   - redovi sa različitim brojem kolona od zaglavlja (istaći ih),
   - ćelije koje sadrže tab / novi red,
   - ćelije koje izgledaju kao brojevi sa decimalnim zarezom,
   - sumnjivi znakovi (BOM, ` `, mojibake tipa `Ä`, `Å¡`, `Ä‡`, `Ã`).
   - Ćelije koje će čišćenje promeniti označiti (npr. žuto), sa tooltipom stara → nova vrednost.
4. **Čišćenje (opciono, svaka opcija checkbox, podrazumevano isključeno osim prve)**:
   - Zameni tab/novi red unutar ćelije razmakom (podrazumevano uključeno — inače TSV puca).
   - **Decimalni zarez → tačka**: samo za ćelije koje su ceo broj u formatu broja (`-?\d{1,3}(\.\d{3})*,\d+` ili `-?\d+,\d+`); ukloniti separator hiljada (`1.234,56` → `1234.56`). Ne dirati tekst ni datume.
   - Ukloni separator hiljada i u celim brojevima (`1.234.567` → `1234567`) — zasebna opcija, jer je dvosmislena.
   - **Ukloni jedinice mere** iz numeričkih ćelija: polje sa listom sufiksa (podrazumevano `mm, cm, m, kg, g, kom, RSD, din, €, %`) — `12,5 mm` → `12.5` (ako je uključena i decimalna konverzija). Samo kad je ostatak čist broj.
   - Trim razmaka, ` ` → razmak, skini BOM.
   - Popravi mojibake (UTF-8 pročitan kao latin-1/cp1250 → ponovo dekodiraj) — samo ako detektovano.
   - Obriši potpuno prazne redove i kolone.
   - Opcija: kolone koje se čiste — sve ili izabrane (checkbox u zaglavlju preview tabele).
   - Preview se ažurira uživo kad se menjaju opcije.
5. **Export**:
   - Dugme „Preuzmi .tab" (i izbor ekstenzije `.tab` / `.tsv` / `.txt`).
   - Izlazno kodiranje: UTF-8 (podrazumevano), UTF-8 sa BOM-om (za Excel), windows-1250 (za stare Windows programe — enkoder napisati ručno preko mape znakova, jer `TextEncoder` podržava samo UTF-8).
   - Kraj reda: LF ili CRLF.
   - „Kopiraj u clipboard".
   - Za ODS sa više listova: „Preuzmi sve listove" (ZIP preko fflate).

## Kvalitet
- Mora raditi za fajlove od nekoliko desetina MB bez zamrzavanja (parsiranje u Web Workeru ili bar u delovima; preview renderuje samo vidljive/ograničene redove).
- Jednostavan, čist dizajn, svetla i tamna tema (`prefers-color-scheme`), responsive.
- Testovi za: CSV parser (navodnici, novi red u ćeliji, `;`), ODS (repeated redovi/kolone, float vrednosti, više listova), čišćenje decimala/jedinica, cp1250 enkoder/dekoder.
- README sa uputstvom za lokalno pokretanje i deploy: `npm i && npm run dev`; deploy `npx vercel --prod` (projekat nazvati `csv2tab` → `csv2tab.vercel.app`).

## Napomena
Postoji i CLI verzija iste logike u `~/bin/csv2tab` (Python, stdlib) — može da posluži kao referenca za ODS parsiranje.
