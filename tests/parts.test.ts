// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compareParts } from '../src/lib/compare';
import { parseCsv } from '../src/lib/csv';
import { decodeAuto } from '../src/lib/encoding';
import { padRows, parseOds } from '../src/lib/ods';
import {
  DEFAULT_EDGE_RULES,
  convertRows,
  defaultGrain,
  describePair,
  edgeLabel,
  detectMapping,
  lookupEdgeCode,
  parseEdgeThickness,
  parseNumber,
  type BuildOptions,
  type ConvertResult,
} from '../src/lib/parts';
import { readWtTab } from '../src/lib/wtTab';

const fx = (n: string) => new Uint8Array(readFileSync(resolve(process.cwd(), 'tests/fixtures', n)));
const csvRows = (n: string) => parseCsv(decodeAuto(fx(n)).text, ';');
const odsRows = (n: string) => padRows(parseOds(fx(n))[0].rows);
const opts: BuildOptions = { rules: DEFAULT_EDGE_RULES, merge: true };

describe('parsiranje vrednosti', () => {
  it('brojevi', () => {
    expect(parseNumber('2436,0 mm')).toBe(2436);
    expect(parseNumber('1.234,5')).toBe(1234.5);
    expect(parseNumber('2436.00')).toBe(2436);
    expect(parseNumber('abc')).toBeNaN();
    expect(parseNumber('')).toBeNaN();
  });
  it('debljina kanta', () => {
    expect(parseEdgeThickness('U702_22-1_kant (1,0 mm x 19,0 mm)')).toBe(1);
    expect(parseEdgeThickness('X (0,5 x 19,0)')).toBe(0.5);
    expect(parseEdgeThickness('012-010_22-0_5-Kant_0,5mm')).toBe(0.5);
    expect(parseEdgeThickness('012-010_22-1_kant_1 mm')).toBe(1);
    expect(parseEdgeThickness('')).toBe(0);
    expect(parseEdgeThickness('nesto')).toBeNull();
  });
  it('šifre kantova i vlakno', () => {
    expect(lookupEdgeCode(DEFAULT_EDGE_RULES, 0.5, 1)).toBe(5);
    expect(lookupEdgeCode(DEFAULT_EDGE_RULES, 1, 0.5)).toBe(5);
    expect(lookupEdgeCode(DEFAULT_EDGE_RULES, 0.5, 0.5)).toBe(2);
    expect(lookupEdgeCode(DEFAULT_EDGE_RULES, 0, 0.5)).toBe(1);
    expect(lookupEdgeCode(DEFAULT_EDGE_RULES, 1, 0)).toBe(3);
    expect(lookupEdgeCode(DEFAULT_EDGE_RULES, 1, 1)).toBe(4);
    expect(edgeLabel(3)).toBe('Jednostrano ABS trakom');
    expect(lookupEdgeCode(DEFAULT_EDGE_RULES, 2, 2)).toBeNull();
    expect(describePair(0.5, 1)).toBe('1 mm + 0,5 mm');
    expect(defaultGrain('U702')).toBe(0);
    expect(defaultGrain('Drvo_dezen')).toBe(1);
    expect(defaultGrain('012-010')).toBe(1);
  });
  it('mapiranje kolona po nazivu (BOM u zaglavlju)', () => {
    const m = detectMapping(['﻿Material', 'Length - raw', 'Width - raw', 'Quantity', 'x', 'Designation', 'Edge Length 1', 'Edge Length 2', 'Edge Width 1', 'Edge Width 2']);
    expect(m).toMatchObject({ material: 0, length: 1, width: 2, qty: 3, designation: 5, edgeL1: 6, edgeW2: 9 });
  });
});

describe('spajanje i greške', () => {
  const head = ['Material', 'Length - raw', 'Width - raw', 'Quantity', 'Designation', 'Edge Length 1', 'Edge Length 2', 'Edge Width 1', 'Edge Width 2'];
  const e = '(1,0 mm x 19,0 mm)';
  it('spaja iste delove, sabira količine, zadržava prvi naziv', () => {
    const rows = [head, ['U1', '100,0 mm', '50,0 mm', '1', 'A', e, e, e, e], ['U1', '100 mm', '50 mm', '2', 'B', e, e, e, e], ['U1', '100 mm', '50 mm', '2', 'C', '', e, e, e]];
    const r = convertRows(rows, opts);
    expect(r.parts.map((p) => [p.name, p.qty])).toEqual([['A', 3], ['C', 2]]);
    expect(r.parts[0].srcRows).toEqual([2, 3]);
    expect(convertRows(rows, { ...opts, merge: false }).parts).toHaveLength(3);
  });
  it('upozorenja: nepoznat kant, decimale, dug naziv, loš red', () => {
    const rows = [head, ['U1', '100,4 mm', '50 mm', '1', 'x'.repeat(30), '(2,0 mm x 19,0 mm)', e, e, e], ['U1', 'xx', '50', '1', 'a', '', '', '', '']];
    const r = convertRows(rows, opts);
    expect(r.parts).toHaveLength(1);
    expect(r.parts[0].name).toHaveLength(25);
    expect(r.parts[0].dim1).toBe(100);
    expect(r.parts[0].issues.length).toBe(3);
    expect(r.issues.filter((i) => i.level === 'error')).toHaveLength(1);
  });
  it('nepoznate kolone -> greška', () => {
    expect(convertRows([['a', 'b']], opts).issues[0].level).toBe('error');
  });
});

describe('Kašmir (Kronospan 012-010)', () => {
  const csv = convertRows(csvRows('Kasmir Kronospan 012-010.csv'), opts);
  const tab = readWtTab(fx('Kronospan Kasmir.tab')).parts;
  const grain = { '012-010': 0 as const, U702: 0 as const };

  it('CSV -> tačno 14 zapisa, 18 izvornih redova', () => {
    expect(csv.issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(csv.pieces).toHaveLength(18);
    expect(csv.parts).toHaveLength(14);
    expect(csv.parts.reduce((s, p) => s + p.qty, 0)).toBe(csv.pieces.reduce((s, p) => s + p.qty, 0));
  });

  it('količine se poklapaju sa ručno pravljenim .tab-om (i smer vlakna)', () => {
    const diff = compareParts(csv.parts, tab);
    expect(diff.filter((d) => d.status === 'onlyA' || d.status === 'onlyB')).toEqual([]);
    for (const d of diff) {
      expect(d.a!.qty, d.a!.name).toBe(d.b!.qty);
      expect(d.a!.grain).toBe(0);
    }
  });

  it('vrednosti iz CSV-a su ono što CSV kaže', () => {
    const by = (n: string) => csv.parts.find((p) => p.name === n)!;
    expect(by('NIK_HOL_maska')).toMatchObject({ dim1: 2436, dim2: 40, edge1: 4, edge2: 4, qty: 1 });
    expect(by('NIK_T1_Front')).toMatchObject({ dim1: 2323, dim2: 414 }); // .tab ima 2423 (greška u kucanju)
    expect(by('NIK_Ledja_iza kreveta')).toMatchObject({ dim1: 1365, dim2: 519, edge1: 2, edge2: 2, qty: 2 });
    expect(by('NIK_M2_front2')).toMatchObject({ edge1: 2, edge2: 2, qty: 2 }); // .tab ima 4/4
    expect(by('NIK_Krevet_fioka_front#2')).toMatchObject({ edge1: 2, edge2: 2, qty: 4 });
    expect(by('NIK_PLA_Front')).toMatchObject({ qty: 2 });
    expect(by('NIK_PLVR_Front#5').qty).toBe(2);
  });

  it('ODS daje iste zapise kao CSV', () => {
    const ods = convertRows(odsRows('Kasmir Kronospan 012-010.ods'), { ...opts, grainByMaterial: grain });
    const csv2 = convertRows(csvRows('Kasmir Kronospan 012-010.csv'), { ...opts, grainByMaterial: grain });
    const strip = (r: ConvertResult) => r.parts.map(({ dim1, dim2, edge1, edge2, grain, qty, name }) => ({ dim1, dim2, edge1, edge2, grain, qty, name }));
    expect(ods.issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(strip(ods)).toEqual(strip(csv2));
  });
});

describe('Stone oak', () => {
  it('CSV se konvertuje bez grešaka', () => {
    const r = convertRows(csvRows('Stone oak Kronospan.csv'), opts);
    expect(r.issues.filter((i) => i.level === 'error')).toEqual([]);
    expect(r.parts.length).toBeGreaterThan(0);
    expect(r.parts.every((p) => p.grain === 1)).toBe(true);
    expect(r.parts[0]).toMatchObject({ dim1: 2730, dim2: 457, edge1: 5, edge2: 2 });
    expect(r.parts.reduce((s, p) => s + p.qty, 0)).toBe(r.pieces.reduce((s, p) => s + p.qty, 0));
  });
  it('ODS daje iste zapise kao CSV (različit naziv materijala)', () => {
    const a = convertRows(odsRows('Stone oak Kronospan 012-140.ods'), opts);
    const b = convertRows(csvRows('Stone oak Kronospan.csv'), opts);
    expect(a.issues.filter((i) => i.level === 'error')).toEqual([]);
    const strip = (r: ConvertResult) => r.parts.map(({ dim1, dim2, edge1, edge2, grain, qty, name }) => ({ dim1, dim2, edge1, edge2, grain, qty, name }));
    expect(strip(a)).toEqual(strip(b));
  });
});
