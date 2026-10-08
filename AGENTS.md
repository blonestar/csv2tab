# Uputstva za agente

## Grane

- Svaka nova grana se pravi **iz `main`-a** (`git switch -c <grana> main`), nikad iz trenutne feature grane,
  čak i ako prethodna grana još nije spojena.

## Teme

- Na `<html>` su `data-theme="<id>"` i `data-scheme="light|dark"`, a postavlja ih `src/theme.ts`. Korisnik bira
  varijantu: Sistem / Svetla / Tamna. Izbor se čuva u localStorage pod ključem `csv2tab.theme`.
- Svaka tema ima **obe** varijante. Boje su CSS promenljive u `src/style.css`: blok `:root[data-theme='<id>']` za svetlu
  i blok `:root[data-theme='<id>'][data-scheme='dark']` za tamnu. U ostatku CSS-a i u `src/sketch.ts` koriste se samo
  promenljive, bez fiksnih boja i bez `prefers-color-scheme`.
- Nova tema: dodaj je u `THEMES` u `src/theme.ts` i napiši njena dva bloka promenljivih. Izbor teme u headeru se
  prikazuje sam čim postoji više od jedne teme.
- Postojeće teme: `sketch` („Skica“). Svetla varijanta je reciklirani papir, a tamna je blueprint.

## Verzija (SemVer)

Verzija aplikacije je `version` u `package.json`. Pri buildu se čita i prikazuje u footeru (`v0.1.0 - by Bojan`).
Agent je **sam podiže** kad promena to zahteva, bez posebnog zahteva korisnika. Format je
`MAJOR.MINOR.PATCH` ([semver.org](https://semver.org/lang/sr/)).

| Deo | Kada se podiže | Primeri u ovom projektu |
| --- | --- | --- |
| **MAJOR** (`x.0.0`) | Nekompatibilna promena: korisnik ili WT dobija drugačiji rezultat za isti ulaz ili gubi nešto na šta se oslanjao | promena binarnog `.tab` izlaza, drugačije imenovanje izvezenih fajlova, uklonjena funkcija, podešavanja u localStorage koja se više ne čitaju |
| **MINOR** (`0.x.0`) | Nova funkcija, kompatibilna sa postojećim | novi ulazni format, nova opcija izvoza, novi tab ili dugme u UI-u, Open Graph preview |
| **PATCH** (`0.0.x`) | Ispravka greške ili sitnica bez nove funkcionalnosti | pogrešno parsiranje broja, popravka stila, tekst/prevod, ažuriranje kataloga materijala |

Pravila:

- **Dok je verzija `0.y.z`** (projekat još nije stabilan): nekompatibilna promena podiže **MINOR**, a ne MAJOR.
  Prelazak na `1.0.0` je odluka korisnika.
- Podizanje briše niže delove: `0.2.3` → minor → `0.3.0`; `1.4.2` → major → `2.0.0`.
- **Jedno podizanje po grani/PR-u**, ne po commitu. Na početku proveri da li je verzija na grani već podignuta u
  odnosu na `main` (`git diff main -- package.json`). Ako jeste, a nova promena traži veći nivo (npr. bio je patch,
  dodata je funkcija), preračunaj ga od verzije na `main`-u.
- **Ne podiže se** za promene koje ne utiču na aplikaciju: samo testovi, dokumentacija (README, AGENTS.md),
  refaktorisanje bez promene ponašanja, dev zavisnosti, CI.
- Komanda (ažurira i `package-lock.json`, bez commita i taga):
  `npm version <major|minor|patch> --no-git-tag-version`
- Podizanje verzije ide u **poseban commit** na kraju grane, npr. `Verzija 0.2.0`.
- Git tag (`v0.2.0`) se pravi tek posle merge-a u `main` i samo na zahtev korisnika.
- U završnoj poruci korisniku navedi staru i novu verziju i zašto je izabran baš taj nivo.
