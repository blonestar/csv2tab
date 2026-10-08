// Analiza tabele: upozorenja koja se prikazuju u pregledu.
import { fixMojibake, looksLikeMojibake } from './encoding';
import { nonEmptyColumns } from './clean';

export interface Stats {
  rows: number;
  cols: number;
  /** Redovi čiji se broj kolona razlikuje od zaglavlja (indeksi, ograničeno). */
  raggedRows: number;
  raggedSample: number[];
  tabNewlineCells: number;
  decimalCommaCells: number;
  suspiciousCells: number;
  mojibakeCells: number;
  /** Kolone koje imaju sadržaj. */
  nonEmptyCols: boolean[];
}

const RE_DECIMAL_LIKE = /^-?(\d{1,3}(\.\d{3})*|\d+),\d+$/;
const RE_SUSPICIOUS = /[﻿ �]/;

export function isDecimalComma(v: string): boolean {
  return RE_DECIMAL_LIKE.test(v.trim());
}
export function hasTabOrNewline(v: string): boolean {
  return /[\t\r\n]/.test(v);
}
export function isMojibake(v: string): boolean {
  return looksLikeMojibake(v) && fixMojibake(v) !== v;
}
export function isSuspicious(v: string): boolean {
  return RE_SUSPICIOUS.test(v) || isMojibake(v);
}

export function analyze(rows: readonly (readonly string[])[]): Stats {
  const width = rows.length ? rows[0].length : 0;
  const s: Stats = {
    rows: rows.length,
    cols: 0,
    raggedRows: 0,
    raggedSample: [],
    tabNewlineCells: 0,
    decimalCommaCells: 0,
    suspiciousCells: 0,
    mojibakeCells: 0,
    nonEmptyCols: [],
  };
  let maxCols = 0;
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    if (row.length > maxCols) maxCols = row.length;
    if (r > 0 && row.length !== width && !(row.length === 1 && row[0] === '')) {
      s.raggedRows++;
      if (s.raggedSample.length < 20) s.raggedSample.push(r);
    }
    for (let c = 0; c < row.length; c++) {
      const v = row[c];
      if (v === '') continue;
      if (hasTabOrNewline(v)) s.tabNewlineCells++;
      if (isDecimalComma(v)) s.decimalCommaCells++;
      if (RE_SUSPICIOUS.test(v)) s.suspiciousCells++;
      if (isMojibake(v)) {
        s.mojibakeCells++;
        s.suspiciousCells++;
      }
    }
  }
  s.cols = maxCols;
  s.nonEmptyCols = nonEmptyColumns(rows);
  return s;
}
