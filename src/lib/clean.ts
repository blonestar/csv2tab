// Čišćenje ćelija i tabela. Čisti moduli, bez DOM-a.
import { fixMojibake } from './encoding';

export interface CleanOptions {
  /** Tab / novi red unutar ćelije -> razmak. */
  replaceWhitespace: boolean;
  /** Decimalni zarez -> tačka (uklanja i separator hiljada u takvim brojevima). */
  decimalComma: boolean;
  /** Separator hiljada i u celim brojevima: 1.234.567 -> 1234567. */
  thousandsInIntegers: boolean;
  /** Ukloni jedinice mere iz numeričkih ćelija. */
  stripUnits: boolean;
  units: string[];
  trim: boolean;
  /** Nerazdvojivi razmak (U+00A0) -> običan razmak. */
  nbspToSpace: boolean;
  stripBom: boolean;
  fixMojibake: boolean;
  removeEmptyRows: boolean;
  removeEmptyCols: boolean;
  /** Indeksi kolona koje se čiste; null = sve. */
  columns: ReadonlySet<number> | null;
}

export const DEFAULT_UNITS = ['mm', 'cm', 'm', 'kg', 'g', 'kom', 'RSD', 'din', '€', '%'];

export function defaultCleanOptions(): CleanOptions {
  return {
    replaceWhitespace: true,
    decimalComma: false,
    thousandsInIntegers: false,
    stripUnits: false,
    units: [...DEFAULT_UNITS],
    trim: false,
    nbspToSpace: false,
    stripBom: false,
    fixMojibake: false,
    removeEmptyRows: false,
    removeEmptyCols: false,
    columns: null,
  };
}

export function parseUnits(s: string): string[] {
  return s
    .split(/[,;\n]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

const RE_DECIMAL_THOUSANDS = /^-?\d{1,3}(\.\d{3})+,\d+$/;
const RE_DECIMAL_PLAIN = /^-?\d+,\d+$/;
const RE_INT_THOUSANDS = /^-?\d{1,3}(\.\d{3})+$/;
/** Broj u bilo kom od podržanih zapisa (za ostatak posle skidanja jedinice). */
const RE_NUMBER_LIKE = /^[-+]?(\d{1,3}(\.\d{3})+|\d+)([.,]\d+)?$/;

/** Ako je s broj sa decimalnim zarezom, vraća broj sa tačkom; inače null. */
export function convertDecimalComma(s: string): string | null {
  if (RE_DECIMAL_THOUSANDS.test(s)) return s.replace(/\./g, '').replace(',', '.');
  if (RE_DECIMAL_PLAIN.test(s)) return s.replace(',', '.');
  return null;
}

export function convertThousands(s: string): string | null {
  return RE_INT_THOUSANDS.test(s) ? s.replace(/\./g, '') : null;
}

/** Skida jedinicu mere ako je ostatak čist broj; inače null. */
export function stripUnit(s: string, units: readonly string[]): string | null {
  const t = s.trim();
  const lower = t.toLowerCase();
  const sorted = [...units].sort((a, b) => b.length - a.length);
  for (const u of sorted) {
    const ul = u.toLowerCase();
    if (!ul || !lower.endsWith(ul)) continue;
    const rest = t.slice(0, t.length - ul.length).trim();
    if (RE_NUMBER_LIKE.test(rest)) return rest;
  }
  return null;
}

export function cleanCell(value: string, o: CleanOptions): string {
  let v = value;
  if (v === '') return v;
  if (o.stripBom && v.includes('﻿')) v = v.replace(/﻿/g, '');
  if (o.nbspToSpace && v.includes(' ')) v = v.replace(/ /g, ' ');
  if (o.fixMojibake) v = fixMojibake(v);
  if (o.replaceWhitespace) v = v.replace(/[\t\r\n]+/g, ' ');
  if (o.trim) v = v.trim();
  if (o.decimalComma || o.thousandsInIntegers || o.stripUnits) {
    let s = v.trim();
    if (o.stripUnits) {
      const r = stripUnit(s, o.units);
      if (r !== null) {
        s = r;
        v = r;
      }
    }
    if (o.decimalComma) {
      const r = convertDecimalComma(s);
      if (r !== null) return r;
    }
    if (o.thousandsInIntegers) {
      const r = convertThousands(s);
      if (r !== null) return r;
    }
  }
  return v;
}

/** Čisti ćeliju samo ako je kolona obuhvaćena. */
export function cleanCellAt(value: string, col: number, o: CleanOptions): string {
  if (o.columns && !o.columns.has(col)) return value;
  return cleanCell(value, o);
}

const BLANK = /^\s*$/;

export function isBlankRow(row: readonly string[]): boolean {
  for (const c of row) if (!BLANK.test(c)) return false;
  return true;
}

/** mask[i] === true -> kolona i ima bar jednu neprazno ćeliju. */
export function nonEmptyColumns(rows: readonly (readonly string[])[]): boolean[] {
  const mask: boolean[] = [];
  for (const row of rows) {
    for (let c = 0; c < row.length; c++) {
      if (!mask[c] && !BLANK.test(row[c])) mask[c] = true;
    }
  }
  for (let c = 0; c < mask.length; c++) mask[c] = !!mask[c];
  return mask;
}

export function cleanTable(rows: readonly (readonly string[])[], o: CleanOptions): string[][] {
  let out: string[][] = rows.map((row) => row.map((v, c) => cleanCellAt(v, c, o)));
  if (o.removeEmptyRows) out = out.filter((r) => !isBlankRow(r));
  if (o.removeEmptyCols) {
    const mask = nonEmptyColumns(out);
    out = out.map((r) => r.filter((_, c) => mask[c]));
  }
  return out;
}
