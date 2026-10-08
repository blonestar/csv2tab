// CSV / ODS / XLSX redovi -> zapisi za WT Input (.tab).
import { fitName, type WtPart } from './wtTab';

// ---------- mapiranje kolona ----------
export type Field =
  | 'material'
  | 'length'
  | 'width'
  | 'qty'
  | 'designation'
  | 'edgeL1'
  | 'edgeL2'
  | 'edgeW1'
  | 'edgeW2';

export const FIELDS: Field[] = ['material', 'length', 'width', 'qty', 'designation', 'edgeL1', 'edgeL2', 'edgeW1', 'edgeW2'];

export const FIELD_LABELS: Record<Field, string> = {
  material: 'Materijal',
  length: 'Dužina (dim 1)',
  width: 'Širina (dim 2)',
  qty: 'Količina',
  designation: 'Naziv',
  edgeL1: 'Kant dužina 1',
  edgeL2: 'Kant dužina 2',
  edgeW1: 'Kant širina 1',
  edgeW2: 'Kant širina 2',
};

export const REQUIRED_FIELDS: Field[] = ['length', 'width'];

export type ColumnMapping = Record<Field, number>;

const ALIASES: Record<Field, string[]> = {
  material: ['material', 'materijal', 'dekor'],
  length: ['length - raw', 'length', 'duzina', 'dužina', 'length raw'],
  width: ['width - raw', 'width', 'sirina', 'širina', 'width raw'],
  qty: ['quantity', 'kolicina', 'količina', 'qty', 'kom'],
  designation: ['designation', 'naziv', 'name', 'oznaka', 'opis'],
  edgeL1: ['edge length 1', 'kant duzina 1', 'kant dužina 1'],
  edgeL2: ['edge length 2', 'kant duzina 2', 'kant dužina 2'],
  edgeW1: ['edge width 1', 'kant sirina 1', 'kant širina 1'],
  edgeW2: ['edge width 2', 'kant sirina 2', 'kant širina 2'],
};

export function normHeader(s: string): string {
  return s
    .replace(/^(﻿|ï»¿|ď»ż)+/, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function detectMapping(header: readonly string[]): ColumnMapping {
  const norm = header.map(normHeader);
  const m = {} as ColumnMapping;
  for (const f of FIELDS) {
    let idx = -1;
    for (const alias of ALIASES[f]) {
      idx = norm.indexOf(alias);
      if (idx >= 0) break;
    }
    m[f] = idx;
  }
  return m;
}

export function missingFields(m: ColumnMapping): Field[] {
  return REQUIRED_FIELDS.filter((f) => m[f] < 0);
}

// ---------- parsiranje vrednosti ----------
/** "2436,0 mm" -> 2436; "1.234,5" -> 1234.5; "2436.00" -> 2436. NaN ako nije broj. */
export function parseNumber(s: string): number {
  const t0 = s.replace(/[\s ]/g, '').replace(/mm$/i, '');
  if (!/^-?[\d.,]+$/.test(t0)) return NaN;
  let t = t0;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if ((t.match(/\./g) ?? []).length > 1) t = t.replace(/\./g, '');
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Debljina kanta iz opisa. "" -> 0 (nema kanta).
 * "U702_22-1_kant (1,0 mm x 19,0 mm)" -> 1; "(0,5 x 19,0)" -> 0.5; "..._Kant_0,5mm" -> 0.5.
 * null = nije prepoznato.
 */
export function parseEdgeThickness(s: string): number | null {
  const t = s.trim();
  if (t === '') return 0;
  let m = /\(\s*(\d+(?:[.,]\d+)?)\s*(?:mm)?\s*[x×*]/i.exec(t);
  if (!m) m = /(\d+(?:[.,]\d+)?)\s*mm\s*\)?\s*$/i.exec(t);
  if (!m) return null;
  const n = parseNumber(m[1]);
  return Number.isNaN(n) ? null : n;
}

// ---------- tabela šifara kantovanja ----------
export interface EdgeRule {
  /** Debljine (mm) dve stranice; redosled nije bitan. 0 = bez kanta. */
  a: number;
  b: number;
  code: number;
}

export const DEFAULT_EDGE_RULES: EdgeRule[] = [
  { a: 0, b: 0, code: 0 },
  { a: 0, b: 0.5, code: 1 }, // jednostrano (PVC 0,5 mm)
  { a: 0.5, b: 0.5, code: 2 }, // dvostrano
  { a: 0, b: 1, code: 3 }, // jednostrano ABS (1 mm)
  { a: 1, b: 1, code: 4 }, // dvostrano ABS
  { a: 0.5, b: 1, code: 5 },
];

const same = (x: number, y: number) => Math.abs(x - y) < 0.001;

export function lookupEdgeCode(rules: readonly EdgeRule[], t1: number, t2: number): number | null {
  for (const r of rules) {
    if ((same(r.a, t1) && same(r.b, t2)) || (same(r.a, t2) && same(r.b, t1))) return r.code;
  }
  return null;
}

export const fmtMm = (n: number) => `${String(Math.round(n * 1000) / 1000).replace('.', ',')} mm`;

/** "1 mm + 0,5 mm"; "bez kanta"; "1 mm (jedna stranica)". */
export function describePair(a: number, b: number): string {
  if (a === 0 && b === 0) return 'bez kanta';
  if (a === 0 || b === 0) return `${fmtMm(Math.max(a, b))} (jedna stranica)`;
  const [hi, lo] = a >= b ? [a, b] : [b, a];
  return `${fmtMm(hi)} + ${fmtMm(lo)}`;
}

/** Nazivi tipova kantovanja kako ih prikazuje WT Input. */
export const EDGE_LABELS: Record<number, string> = {
  0: 'Bez kantovanja',
  1: 'Jednostrano',
  2: 'Dvostrano',
  3: 'Jednostrano ABS trakom',
  4: 'Dvostrano ABS trakom',
  5: '1: PVC + 1: ABS',
};
export const edgeLabel = (code: number) => EDGE_LABELS[code] ?? `Šifra ${code}`;

/** Debljine koje odgovaraju šifri po tabeli (npr. „1 mm + 0,5 mm"); prazno ako šifre nema u tabeli. */
export function describeCode(rules: readonly EdgeRule[], code: number): string {
  const r = rules.find((x) => x.code === code);
  return r ? describePair(r.a, r.b) : '';
}

export function sanitizeRules(v: unknown): EdgeRule[] | null {
  if (!Array.isArray(v)) return null;
  const out: EdgeRule[] = [];
  for (const r of v) {
    if (r && typeof r === 'object' && Number.isFinite(r.a) && Number.isFinite(r.b) && Number.isInteger(r.code) && r.code >= 0 && r.code <= 255) {
      out.push({ a: Number(r.a), b: Number(r.b), code: r.code });
    } else return null;
  }
  return out;
}

// ---------- ulazni delovi ----------
export interface Issue {
  level: 'warn' | 'error';
  msg: string;
  /** Broj reda u izvoru (1 = zaglavlje). */
  row?: number;
}

export interface Piece {
  row: number;
  material: string;
  designation: string;
  length: number;
  width: number;
  qty: number;
  /** Debljine: dužina1, dužina2, širina1, širina2 (null = nije prepoznato). */
  edges: [number | null, number | null, number | null, number | null];
  issues: string[];
}

const cell = (row: readonly string[], idx: number) => (idx >= 0 && idx < row.length ? row[idx] : '');

export function extractPieces(
  rows: readonly (readonly string[])[],
  mapping: ColumnMapping,
  firstRow = 1,
): { pieces: Piece[]; issues: Issue[] } {
  const pieces: Piece[] = [];
  const issues: Issue[] = [];
  for (let r = firstRow; r < rows.length; r++) {
    const row = rows[r];
    if (row.every((c) => c.trim() === '')) continue;
    const rowNo = r + 1;
    const length = parseNumber(cell(row, mapping.length));
    const width = parseNumber(cell(row, mapping.width));
    if (Number.isNaN(length) || Number.isNaN(width)) {
      issues.push({ level: 'error', row: rowNo, msg: `Red ${rowNo}: dimenzije nisu brojevi („${cell(row, mapping.length)}" × „${cell(row, mapping.width)}"), red je preskočen.` });
      continue;
    }
    const pissues: string[] = [];
    let qty = 1;
    if (mapping.qty >= 0) {
      qty = parseNumber(cell(row, mapping.qty));
      if (Number.isNaN(qty)) {
        pissues.push(`količina „${cell(row, mapping.qty)}" nije broj, uzeto 1`);
        qty = 1;
      } else if (!Number.isInteger(qty)) {
        pissues.push(`količina ${qty} nije ceo broj, zaokruženo`);
        qty = Math.round(qty);
      }
    }
    const edge = (f: Field): number | null => {
      if (mapping[f] < 0) return 0;
      const raw = cell(row, mapping[f]);
      const t = parseEdgeThickness(raw);
      if (t === null) pissues.push(`debljina kanta nije prepoznata u „${raw}"`);
      return t;
    };
    pieces.push({
      row: rowNo,
      material: cell(row, mapping.material).trim(),
      designation: cell(row, mapping.designation).trim(),
      length,
      width,
      qty,
      edges: [edge('edgeL1'), edge('edgeL2'), edge('edgeW1'), edge('edgeW2')],
      issues: pissues,
    });
  }
  return { pieces, issues };
}

// ---------- zapisi ----------
export interface PartRecord extends WtPart {
  material: string;
  /** Debljine iz izvora (za opis). Prazno za zapise otvorene iz .tab-a. */
  thick1?: [number, number];
  thick2?: [number, number];
  /** Redovi izvora koji čine ovaj zapis (1-based). */
  srcRows: number[];
  issues: string[];
  /** Stabilan ključ za izmene korisnika. */
  key: string;
}

export function defaultGrain(material: string): 0 | 1 {
  return /^U\d+/i.test(material.trim()) ? 0 : 1;
}

export interface BuildOptions {
  rules: readonly EdgeRule[];
  /** Ručno izabran smer vlakna po materijalu (ostalo: podrazumevano). */
  grainByMaterial?: Readonly<Record<string, 0 | 1>>;
  merge: boolean;
}

export function buildParts(pieces: readonly Piece[], o: BuildOptions): { parts: PartRecord[]; issues: Issue[] } {
  const issues: Issue[] = [];
  const out: PartRecord[] = [];
  const byKey = new Map<string, PartRecord>();
  for (const p of pieces) {
    const pissues = [...p.issues];
    const dim = (v: number, label: string) => {
      const r = Math.round(v);
      if (Math.abs(r - v) > 0.001) pissues.push(`${label} ${String(v).replace('.', ',')} mm zaokruženo na ${r}`);
      if (r <= 0) pissues.push(`${label} je ${r}`);
      return Math.max(0, r);
    };
    const dim1 = dim(p.length, 'dužina');
    const dim2 = dim(p.width, 'širina');
    const code = (t1: number | null, t2: number | null): number => {
      const a = t1 ?? 0;
      const b = t2 ?? 0;
      const c = lookupEdgeCode(o.rules, a, b);
      if (c === null) {
        pissues.push(`nepoznata kombinacija kanta ${fmtMm(a)} + ${fmtMm(b)} (šifra 0)`);
        return 0;
      }
      return c;
    };
    const edge1 = code(p.edges[0], p.edges[1]);
    const edge2 = code(p.edges[2], p.edges[3]);
    const grain = o.grainByMaterial?.[p.material] ?? defaultGrain(p.material);
    if (p.qty > 0xffff) pissues.push('količina veća od 65535');
    const fit = fitName(p.designation);
    if (fit.truncated) pissues.push(`naziv skraćen na 25 znakova („${p.designation}")`);
    if (fit.unmappable) pissues.push(`${fit.unmappable} znak(ova) u nazivu ne postoji u windows-1250 (zamenjeno sa „?")`);

    const key = `${p.material}|${dim1}|${dim2}|${edge1}|${edge2}|${grain}`;
    const prev = o.merge ? byKey.get(key) : undefined;
    if (prev) {
      prev.qty += p.qty;
      prev.srcRows.push(p.row);
      for (const i of pissues) if (!prev.issues.includes(i)) prev.issues.push(i);
      continue;
    }
    const rec: PartRecord = {
      dim1,
      dim2,
      edge1,
      edge2,
      grain,
      qty: p.qty,
      name: fit.name,
      material: p.material,
      thick1: [p.edges[0] ?? 0, p.edges[1] ?? 0],
      thick2: [p.edges[2] ?? 0, p.edges[3] ?? 0],
      srcRows: [p.row],
      issues: pissues,
      key: '',
    };
    out.push(rec);
    if (o.merge) byKey.set(key, rec);
  }
  out.forEach((r) => {
    r.key = `${r.material}#${r.srcRows.join(',')}`;
    if (r.qty > 0xffff) r.qty = 0xffff;
    for (const i of r.issues) issues.push({ level: 'warn', row: r.srcRows[0], msg: `Red ${r.srcRows.join(', ')} (${r.name || '—'}): ${i}.` });
  });
  return { parts: out, issues };
}

/** Podrazumevani raspored kolona kada fajl nema zaglavlje (isti kao u izvozu programa). */
export const POSITIONAL_MAPPING: ColumnMapping = {
  material: 0, length: 1, width: 2, qty: 3, designation: 5, edgeL1: 6, edgeL2: 7, edgeW1: 8, edgeW2: 9,
};

export interface ConvertResult {
  mapping: ColumnMapping;
  /** true: prvi red nije zaglavlje (već podatak), uzet je podrazumevani raspored kolona. */
  headerless: boolean;
  pieces: Piece[];
  parts: PartRecord[];
  materials: string[];
  issues: Issue[];
}

/** Ceo tok: zaglavlje -> mapiranje -> delovi -> zapisi. */
export function convertRows(
  rows: readonly (readonly string[])[],
  o: BuildOptions,
  mapping?: ColumnMapping,
): ConvertResult {
  let m = mapping ?? detectMapping(rows[0] ?? []);
  let headerless = false;
  const issues: Issue[] = [];
  if (!mapping && missingFields(m).length && rows[0] && !Number.isNaN(parseNumber(rows[0][1] ?? '')) && !Number.isNaN(parseNumber(rows[0][2] ?? ''))) {
    m = POSITIONAL_MAPPING;
    headerless = true;
    issues.push({ level: 'warn', msg: 'Fajl nema zaglavlje: uzet je podrazumevani raspored kolona (Materijal, Dužina, Širina, Količina, Tekstura, Naziv, 4 kanta).' });
  }
  const miss = missingFields(m);
  if (miss.length) {
    issues.push({ level: 'error', msg: `Nije prepoznata kolona: ${miss.map((f) => FIELD_LABELS[f]).join(', ')}. Izaberite je ručno u mapiranju kolona.` });
    return { mapping: m, headerless, pieces: [], parts: [], materials: [], issues };
  }
  const ex = extractPieces(rows, m, headerless ? 0 : 1);
  const built = buildParts(ex.pieces, o);
  const materials: string[] = [];
  for (const p of ex.pieces) if (!materials.includes(p.material)) materials.push(p.material);
  return { mapping: m, headerless, pieces: ex.pieces, parts: built.parts, materials, issues: [...issues, ...ex.issues, ...built.issues] };
}

/** Zapisi iz pročitanog .tab-a (bez izvora). */
export function partsFromTab(parts: readonly WtPart[]): PartRecord[] {
  return parts.map((p, i) => ({ ...p, material: '', srcRows: [i + 1], issues: [], key: `tab#${i + 1}` }));
}
