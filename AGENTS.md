# Uputstva za agente

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

## Pull request i merge

Posle otvaranja PR-a agent ga **sam mergeuje** u `main` kad provere prođu, bez posebnog zahteva korisnika.
GitHub-ov ugrađeni auto-merge ne radi u ovom repou (privatan repo na besplatnom planu nema branch protection),
pa agent sam čeka provere:

1. `gh pr checks <broj> --watch --fail-fast` — čeka da se završe sve provere (Vercel build i preview).
2. Ako su sve prošle: `gh pr merge <broj> --merge --delete-branch`, pa lokalno `git switch main && git pull`.
3. Ako neka provera padne ili PR ima konflikt: **ne mergeuje**. Javi korisniku šta je palo (sa linkom) i predloži
   ispravku.

- Merge commit (`--merge`), ne squash/rebase: istorija grana ostaje vidljiva, kao u dosadašnjim PR-ovima.
- Ne mergeuje se ako korisnik kaže da PR treba da sačeka (pregled, testiranje) ili ako je PR draft.
- U završnoj poruci navedi link PR-a i da je mergeovan (ili zašto nije).
