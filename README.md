# csv2tab

Web aplikacija koja pretvara **CSV** i **ODS** krojne liste (export iz programa za projektovanje) u binarni
**WT Input `.tab`** fajl (krojne liste za pločaste materijale). Sva obrada se izvršava u browseru — fajl nikad ne napušta
korisnikov računar. UI je na srpskom (latinica), u „sketch" stilu (rough.js, rukopisni fontovi, milimetarski papir,
tamna tema = blueprint).

## Šta radi

1. Učitava `.csv` (UTF-8/windows-1250, `;`) i `.ods`; kolone se mapiraju po nazivu zaglavlja (uz ručni izbor; fajl bez
   zaglavlja dobija podrazumevani raspored). Brojevi sa decimalnim zarezom i jedinicom `mm`, debljina kanta iz
   `(1,0 mm x 19,0 mm)` ili sufiksa `..._0,5mm`.
2. Pravi **zapise** (Dužina, Širina, Kant uz dužinu / širinu, Prati teksturu, Kom, Oznaka): iste delove spaja
   (količine se sabiraju), naziv skraćuje na 25 bajtova (windows-1250), upozorava na zaokruživanje dimenzija,
   nepoznate kombinacije kanta i znakove van cp1250.
3. Pregled zapisa je **editabilan** (ručno izmenjene ćelije su označene žutim markerom); dugme ⇄ po redu zamenjuje
   dimenzije (i kantove); „Prati teksturu" se bira po materijalu i po redu. Tab „Izvor" prikazuje sirove redove.
4. **Tabela šifara kantovanja** (par debljina → šifra) je izmenljiva, čuva se u localStorage; „Vrati podrazumevano".
5. **Uporedi sa postojećim .tab** — razlike po delovima (stariji fajlovi su kucani ručno). Postojeći `.tab` može i
   samo da se otvori radi pregleda/izmene.
6. **Materijal (WT)**: iz kataloga (`src/data/wt-catalog.json`, 860 materijala, 10 traka) bira se materijal po
   materijalu iz fajla (automatski predlog po šifri/nazivu; iz kataloga se uzima i podrazumevani „Prati teksturu",
   a ako materijala nema, pravilo `^U\d+` → 0). Predlaže se ime fajla `<šifra> <debljina> mm <traka>` (izmenljivo).
7. Izvoz: binarni `.tab` (zajednički ili poseban po materijalu u ZIP-u). Sporedno: TSV/tekst izvoz sa opcijama
   čišćenja, kodiranja i kraja reda.

## WT Input .tab format

Little-endian, Delphi packed record. Materijal se **ne čuva u fajlu** — WT ga prepoznaje po imenu fajla
(npr. `H1137 18 mm ABS.tab`).

- **Zaglavlje 165 B**, nule osim: `06 'DAT5.0' 06 'TABDTA' 04 '1.00'` (offset 0), bajt `3` na offsetu 20 (konstanta),
  `uint16` broj zapisa na offsetu 23.
- **Zapis 79 B**: `uint32` dim1 (mm; „Dužina" = dimenzija koja prati teksturu), `uint32` dim2 (mm), `uint8` kant uz dim1
  (offset 8), `uint8` kant uz dim2 (9), `uint8` prati teksturu (29), `uint16` količina (31), `uint8` dužina naziva (53) +
  naziv do 25 B windows-1250 (54). WT prikazuje cm sa jednom decimalom, a u fajlu su celobrojni mm.
- Šifre kantovanja: 0 = Bez kantovanja, 1 = Jednostrano (PVC 0,5), 2 = Dvostrano, 3 = Jednostrano ABS trakom (1 mm),
  4 = Dvostrano ABS trakom, 5 = 1: PVC + 1: ABS.
- Čitanje + pisanje je testirano bajt-identično na stvarnim primerima (`tests/fixtures/`). Referentni Python writer:
  `tests/fixtures/reference_writer.py`. Detalji: `PROMPT.md`.

## Pokretanje lokalno

```sh
npm i
npm run dev        # razvojni server
npm test           # vitest
npm run build      # produkcioni build u dist/
npm run preview    # lokalni pregled builda
```

Potreban je Node 20+.

## Struktura

- `src/lib/wtTab.ts` — čitanje/pisanje binarnog `.tab`
- `src/lib/parts.ts` — redovi → zapisi (mapiranje kolona, parsiranje, tabela kantova, spajanje)
- `src/lib/compare.ts` — poređenje dva skupa zapisa
- `src/lib/catalog.ts` + `src/data/wt-catalog.json` — WT katalog materijala/traka (JSON se ne menja ručno)
- `src/lib/csv.ts`, `ods.ts`, `clean.ts`, `tsv.ts`, `encoding.ts`, `analyze.ts` — ulaz, čišćenje, sporedni TSV izvoz
- `src/sketch.ts`, `src/fonts.ts`, `src/style.css` — „sketch" stil
- `src/worker.ts` — Web Worker za parsiranje CSV-a
- `tests/` — vitest testovi

## Deploy na Vercel

```sh
npx vercel --prod
```

Projekat nazovite `csv2tab` (→ `csv2tab.vercel.app`). Vercel sam prepoznaje Vite (build `npm run build`, izlaz `dist/`),
`vercel.json` nije potreban.

## Ograničenja

- ODS se parsira u glavnoj niti (`DOMParser` ne postoji u Web Workeru); CSV ide kroz Worker.
- Tabela zapisa prikazuje prvih 3000 zapisa (izvoz sadrži sve).
- Kombinacije kanta van tabele daju šifru 0 uz upozorenje.
