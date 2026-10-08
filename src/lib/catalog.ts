// Katalog WT Input materijala i traka (src/data/wt-catalog.json). Materijal se u .tab-u NE čuva:
// WT ga prepoznaje po imenu fajla ("H1137 18 mm ABS").

export interface WtMaterial {
  name: string;
  code: string;
  sheet: [number, number];
  thickness: number;
  /** 1 = tekstura prati smer. */
  grain: number;
}
export interface WtBand {
  name: string;
  code: string;
}
export interface WtCatalog {
  materials: WtMaterial[];
  edgeBands: WtBand[];
}

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9ŠĐČĆŽ]/g, '');

/** Tekst opcije u padajućoj listi. */
export const materialLabel = (m: WtMaterial) => `${m.code} — ${m.name} (${m.thickness} mm)`;

/** Traži materijal po šifri/nazivu; tačno poklapanje šifre ima prednost. */
export function searchMaterials(cat: WtCatalog, query: string, limit = 20): WtMaterial[] {
  const q = norm(query);
  if (!q) return [];
  const scored: [number, WtMaterial][] = [];
  for (const m of cat.materials) {
    const c = norm(m.code);
    const n = norm(m.name);
    let s = 0;
    if (c === q) s = 100;
    else if (c.startsWith(q)) s = 80;
    else if (c.includes(q)) s = 60;
    else if (n.startsWith(q)) s = 50;
    else if (n.includes(q)) s = 30;
    if (s) scored.push([s - (m.thickness === 18 ? 0 : 1), m]);
  }
  return scored.sort((a, b) => b[0] - a[0]).slice(0, limit).map((x) => x[1]);
}

/** Automatski izbor za naziv materijala iz CSV-a (npr. "U702"): samo ako je poklapanje šifre jednoznačno dobro. */
export function matchMaterial(cat: WtCatalog, csvMaterial: string, thickness?: number): WtMaterial | undefined {
  const q = norm(csvMaterial);
  if (q.length < 2) return undefined;
  const exact = cat.materials.filter((m) => norm(m.code) === q);
  const pool = exact.length ? exact : searchMaterials(cat, csvMaterial, 50).filter((m) => norm(m.code).startsWith(q) || norm(m.code).includes(q));
  if (!pool.length) return undefined;
  return pool.find((m) => thickness !== undefined && m.thickness === thickness) ?? pool.find((m) => m.thickness === 18) ?? pool[0];
}

const fmtT = (n: number) => String(n).replace('.', ',');

/** "H1137 18 mm ABS" (bez ekstenzije). */
export function suggestFilename(m: WtMaterial, band?: WtBand): string {
  return [m.code, `${fmtT(m.thickness)} mm`, band?.code].filter(Boolean).join(' ');
}

export const safeFileName = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').trim();
