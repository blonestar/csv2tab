import { describe, expect, it } from 'vitest';
import { cleanCell, cleanTable, convertDecimalComma, defaultCleanOptions, stripUnit } from '../src/lib/clean';
import { analyze } from '../src/lib/analyze';

const opts = (o: Partial<ReturnType<typeof defaultCleanOptions>> = {}) => ({
  ...defaultCleanOptions(),
  ...o,
});

describe('decimalni zarez', () => {
  const o = opts({ decimalComma: true });
  it.each([
    ['1.234,56', '1234.56'],
    ['12,5', '12.5'],
    ['-0,75', '-0.75'],
    ['1.234.567,8', '1234567.8'],
  ])('%s -> %s', (a, b) => expect(cleanCell(a, o)).toBe(b));
  it.each(['abc, def', '12,', '1,2,3', '1.2,5x', '05.03.2024', 'Beograd, Srbija', '1234', '1.234'])(
    'ne dira "%s"',
    (a) => expect(cleanCell(a, o)).toBe(a),
  );
  it('convertDecimalComma', () => {
    expect(convertDecimalComma('x')).toBeNull();
  });
});

describe('separator hiljada u celim brojevima', () => {
  it('uključeno', () => {
    expect(cleanCell('1.234.567', opts({ thousandsInIntegers: true }))).toBe('1234567');
    expect(cleanCell('-12.000', opts({ thousandsInIntegers: true }))).toBe('-12000');
  });
  it('isključeno -> ne dira', () => {
    expect(cleanCell('1.234.567', opts())).toBe('1.234.567');
  });
  it('ne dira datume', () => {
    expect(cleanCell('1.12.2024', opts({ thousandsInIntegers: true }))).toBe('1.12.2024');
  });
});

describe('jedinice mere', () => {
  const units = opts({ stripUnits: true, decimalComma: true });
  it.each([
    ['12,5 mm', '12.5'],
    ['12,5mm', '12.5'],
    ['3 kg', '3'],
    ['100 RSD', '100'],
    ['1.234,50 din', '1234.50'],
    ['15 %', '15'],
    ['20€', '20'],
    ['7 KOM', '7'],
    ['5 m', '5'],
  ])('%s -> %s', (a, b) => expect(cleanCell(a, units)).toBe(b));
  it.each(['kg', 'mm 12', 'ima 5 kg', 'Kuća 12 m', '5 xyz'])('ne dira "%s"', (a) =>
    expect(cleanCell(a, units)).toBe(a),
  );
  it('bez decimalne konverzije zarez ostaje', () => {
    expect(cleanCell('12,5 mm', opts({ stripUnits: true }))).toBe('12,5');
  });
  it('prilagođena lista', () => {
    expect(stripUnit('4 lit', ['lit'])).toBe('4');
    expect(stripUnit('4 lit', ['mm'])).toBeNull();
  });
});

describe('ostalo čišćenje', () => {
  it('tab/novi red -> razmak (podrazumevano)', () => {
    expect(cleanCell('a\tb\r\nc', opts())).toBe('a b c');
  });
  it('trim, nbsp, BOM', () => {
    expect(cleanCell('﻿  x y ', opts({ trim: true, nbspToSpace: true, stripBom: true }))).toBe('x y');
  });
  it('mojibake', () => {
    expect(cleanCell('Ä\u008duvar', opts({ fixMojibake: true }))).toBe('čuvar');
    expect(cleanCell('Čuvar', opts({ fixMojibake: true }))).toBe('Čuvar');
  });
  it('izabrane kolone', () => {
    const t = cleanTable([['1,5', '2,5']], opts({ decimalComma: true, columns: new Set([1]) }));
    expect(t).toEqual([['1,5', '2.5']]);
  });
  it('prazni redovi i kolone', () => {
    const t = cleanTable(
      [['a', '', 'b'], ['', ' ', ''], ['c', '', 'd']],
      opts({ removeEmptyRows: true, removeEmptyCols: true }),
    );
    expect(t).toEqual([['a', 'b'], ['c', 'd']]);
  });
});

describe('analyze', () => {
  it('upozorenja', () => {
    const s = analyze([
      ['a', 'b'],
      ['1,5', 'x\ty'],
      ['só l'],
      ['Ä\u0087'.replace('\u0087', '‡'), 'ok'],
    ]);
    expect(s.raggedRows).toBe(1);
    expect(s.decimalCommaCells).toBe(1);
    expect(s.tabNewlineCells).toBe(1);
    expect(s.suspiciousCells).toBe(2);
    expect(s.mojibakeCells).toBe(1);
  });
});
