# csv2tab

Web aplikacija koja pretvara **CSV** i **ODS** fajlove u **tab-delimited** (`.tab` / `.tsv` / `.txt`) fajl.
Sva obrada se izvršava u browseru — fajl nikad ne napušta korisnikov računar. UI je na srpskom (latinica).

Mogućnosti: automatska detekcija kodiranja (UTF-8 / windows-1250 / latin-1) i separatora (`, ; tab |`) sa ručnom izmenom,
izbor lista za ODS, pregled prvih 500 redova sa upozorenjima i obeleženim izmenama, opcije čišćenja sa uživo pregledom
(decimalni zarez, jedinice mere, separator hiljada, mojibake, prazni redovi/kolone, izbor kolona…) i izvoz
(UTF-8, UTF-8 sa BOM-om, windows-1250; LF/CRLF; kopiranje u clipboard; ZIP svih listova ODS-a).

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

- `src/lib/csv.ts` — RFC 4180 parser i detekcija separatora
- `src/lib/ods.ts` — ODS (fflate + `DOMParser`)
- `src/lib/clean.ts` — čišćenje ćelija/tabele
- `src/lib/tsv.ts` — serijalizacija u TSV
- `src/lib/encoding.ts` — detekcija/dekodiranje, ručni windows-1250 enkoder, popravka mojibake-a
- `src/lib/analyze.ts` — upozorenja za pregled
- `src/worker.ts` — Web Worker za parsiranje CSV-a
- `tests/` — vitest testovi (uključujući pravi `.ods` fajl napravljen LibreOffice-om)

## Deploy na Vercel

```sh
npx vercel --prod
```

Projekat nazovite `csv2tab` (→ `csv2tab.vercel.app`). Vercel sam prepoznaje Vite (build `npm run build`, izlaz `dist/`),
`vercel.json` nije potreban.

## Ograničenja

- ODS se parsira u glavnoj niti (`DOMParser` ne postoji u Web Workeru); CSV ide kroz Worker.
- Čišćenje i izvoz celog fajla rade u glavnoj niti (preview obrađuje samo prikazane redove).
- Fajlovi od više stotina MB mogu da premaše memoriju browsera.
