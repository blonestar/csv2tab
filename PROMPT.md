# csv2tab — web aplikacija (prompt / specifikacija)

Napravi web aplikaciju **csv2tab** koja pretvara CSV i ODS fajlove u tab-delimited (.tab / .tsv) fajl. Hostuje se na Vercelu (cilj: `csv2tab.vercel.app`). UI je na srpskom (latinica, ekavica).

## Arhitektura
- Statička aplikacija: **Vite + TypeScript**, bez backenda. Sva obrada ide u browseru — fajl nikad ne napušta korisnikov računar (to istaći u UI-ju).
- Runtime zavisnosti: **fflate** (ODS/ZIP), **rough.js** (sketch stil) i `@fontsource` fontovi. ODS XML parsirati preko `DOMParser`. CSV parser napisati sam (RFC 4180: navodnici, `""` escape, novi redovi unutar navodnika).
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

## Vizuelni stil — „sketch" (kao ručni crtež / SketchUp skica)
Aplikacija mora biti lepa i zanimljiva, da podseća na crtež olovkom na papiru:
- Pozadina: papir (topla krem/bela, suptilna tačkasta ili milimetarska mreža preko CSS `background-image`); u tamnoj temi — „školska tabla" / plavi papir (blueprint) sa belim linijama.
- Linije i okviri izgledaju ručno nacrtano: koristi **rough.js** (dozvoljena druga runtime zavisnost) za okvire kartica, dugmad, upload zonu, strelice i podvlačenja; alternativno nepravilni `border-radius` (npr. `255px 15px 225px 15px / 15px 225px 15px 255px`) i SVG `feTurbulence` + `feDisplacementMap` filter za „drhtavu" liniju.
- Fontovi: rukopisni za naslove i dugmad (npr. **Caveat**, **Patrick Hand** ili **Architects Daughter** — self-hostovati preko `@fontsource`, ne Google CDN), čitljiv monospace za podatke u tabeli (npr. **JetBrains Mono**).
- Preview tabela kao tabela nacrtana na milimetarskom papiru; izmenjene ćelije „markirane" žutim markerom (poluprovidna nepravilna traka), upozorenja zaokružena crvenom olovkom / ručno nacrtana uzvičnik-ikona.
- Tok rada prikazati kao skicu: CSV/ODS → (ručno nacrtana strelica) → TAB, sa malim crtežima ikona fajlova.
- Animacije diskretne: linije se „crtaju" (SVG `stroke-dasharray` animacija) kad se pojavi novi element; dugme se blago „zatrese" na hover. Poštovati `prefers-reduced-motion`.
- I dalje mora biti pregledno i čitljivo — stil ne sme da smeta radu sa podacima.

## Kvalitet
- Mora raditi za fajlove od nekoliko desetina MB bez zamrzavanja (parsiranje u Web Workeru ili bar u delovima; preview renderuje samo vidljive/ograničene redove).
- Jednostavan, čist dizajn, svetla i tamna tema (`prefers-color-scheme`), responsive.
- Testovi za: CSV parser (navodnici, novi red u ćeliji, `;`), ODS (repeated redovi/kolone, float vrednosti, više listova), čišćenje decimala/jedinica, cp1250 enkoder/dekoder.
- README sa uputstvom za lokalno pokretanje i deploy: `npm i && npm run dev`; deploy `npx vercel --prod` (projekat nazvati `csv2tab` → `csv2tab.vercel.app`).

## Napomena
Postoji i CLI verzija iste logike u `~/bin/csv2tab` (Python, stdlib) — može da posluži kao referenca za ODS parsiranje.

---

# ⚠️ ISPRAVKA (ima prednost nad svim gore): izlaz je BINARNI WT Input `.tab`, ne TSV

Ciljni program je **WT Input** (krojne liste za iverica/pločaste materijale). Njegov `.tab` je binarni fajl. Format je dešifrovan i proveren round-trip testom — writer ispod daje **bajt-identične** fajlove primerima u `../Kronospan Kasmir.tab` i `../STONE OAK Kronospan.tab`.

## Format (little-endian, Delphi packed record)
- **Zaglavlje: 165 bajtova**, sve nule osim:
  - offset 0: `06 'DAT5.0' 06 'TABDTA' 04 '1.00'` (Pascal stringovi, 19 bajtova)
  - offset 20: bajt `3`
  - offset 23: `uint16` broj zapisa
- **Zapis: 79 bajtova** (posle zaglavlja, jedan za drugim), sve nule osim:
  - 0: `uint32` dimenzija 1 (mm, ceo broj)
  - 4: `uint32` dimenzija 2 (mm)
  - 8: `uint8` šifra kantovanja za dve stranice uz dimenziju 1
  - 9: `uint8` šifra kantovanja za dve stranice uz dimenziju 2
  - 29: `uint8` smer vlakna (1 = pratiti smer/dezen, 0 = može rotacija; jednobojni dekori npr. `U702` imaju 0)
  - 31: `uint16` količina
  - 53: `uint8` dužina naziva, 54..78: naziv (max **25** bajtova, **windows-1250**), ostatak nule
- Referentni Python writer: `tests/fixtures/reference_writer.py` (prepisati logiku u `src/lib/wtTab.ts` + test koji parsira oba primera i proverava da writer daje identične bajtove — kopirati primere u `tests/fixtures/`).

## Ulazni CSV (export iz programa za projektovanje)
```
Material;Length - raw;Width - raw;Quantity;Textura;Designation;Edge Length 1;Edge Length 2;Edge Width 1;Edge Width 2
U702;2436,0 mm;40,0 mm;1;18,0 mm;NIK_HOL_maska;U702_22-1_kant (1,0 mm x 19,0 mm);...
```
- `;`, UTF-8 sa BOM-om, brojevi sa decimalnim zarezom i jedinicom `mm`; prazan kant = `""`.
- Debljina kanta se čita iz zagrade: `(1,0 mm x 19,0 mm)` → 1.0; `(0,5 x 19,0)` → 0.5.
- ODS ima iste kolone (primeri `../*.ods`). Mapiranje kolona po nazivu zaglavlja, uz ručni izbor ako se naziv ne prepozna.

## Konverzija CSV → zapis
- dim1 = Length, dim2 = Width (zaokružiti na ceo mm; upozoriti ako nije ceo broj). Dugme po redu „zameni dimenzije" (zameni i šifre kanta).
- Šifra kanta po paru stranica = **redni broj tipa kantovanja u WT Input-u**. Kombinacija debljina (neuređen par) → šifra, preko **tabele koja se može menjati u UI-ju** (čuva se u localStorage, dugme „vrati podrazumevano"). Podrazumevano (zaključeno iz primera; 0, 2, 4, 5 sigurni, 1 i 3 pretpostavka):
  - nema kanta → 0
  - jedna stranica 1 mm → 1 (?)
  - obe 0,5 mm → 2
  - jedna stranica 0,5 mm → 3 (?)
  - obe 1 mm → 4
  - 1 mm + 0,5 mm → 5
  - Nepoznata debljina → upozorenje u preview-u.
- Smer vlakna: po materijalu (lista materijala iz fajla sa checkbox-om); podrazumevano 0 za materijale koji liče na jednobojne (`^U\d+`), 1 za ostale. Može se menjati i po redu.
- **Spajanje istih delova** (podrazumevano uključeno): redovi sa istim (dim1, dim2, šifra1, šifra2, smer) → jedan zapis, količine se sabiraju, zadržava se prvi naziv. Primer: Kašmir CSV 18 redova → 14 zapisa (poklapa se sa ručno pravljenim .tab).
- Naziv: Designation, skratiti na 25 znakova (upozorenje), znakovi van cp1250 → upozorenje/zamena.
- Ako ima više materijala u fajlu: ponuditi poseban `.tab` po materijalu (ime fajla = materijal), ili jedan zajednički.

## UI izmene
- Preview prikazuje **finalne zapise** (dim1, dim2, kant1 sa opisom npr. „1 mm + 0,5 mm (5)", kant2, smer, količina, naziv) — editabilne ćelije za ispravke pre izvoza; pored toga i originalni redovi (tab „Izvor").
- Opcija „Uporedi sa postojećim .tab" — učitaj stari `.tab`, prikaži razlike po delovima (korisno jer su raniji fajlovi ručno prekucavani i imaju greške).
- Opcija i da se otvori postojeći `.tab` samo radi pregleda.
- Export: binarni `.tab` (Blob, `application/octet-stream`). Opcioni TSV/CSV export ostaje kao sporedna opcija.
- Generičke TSV opcije iz gornjeg dela (izlazno kodiranje, CRLF…) važe samo za sporedni TSV export.
