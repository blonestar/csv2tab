import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HEADER_SIZE, RECORD_SIZE, fitName, readWtTab, writeWtTab } from '../src/lib/wtTab';

const fx = (n: string) => new Uint8Array(readFileSync(resolve(process.cwd(), 'tests/fixtures', n)));

describe('WT Input .tab: čitanje i pisanje', () => {
  for (const [file, count] of [
    ['Kronospan Kasmir.tab', 14],
    ['STONE OAK Kronospan.tab', 40],
  ] as const) {
    it(`${file}: read -> write je bajt-identično`, () => {
      const data = fx(file);
      const r = readWtTab(data);
      expect(r.warnings).toEqual([]);
      expect(r.parts).toHaveLength(count);
      expect(data.length).toBe(HEADER_SIZE + count * RECORD_SIZE);
      expect(r.materialIndex).toBe(3);
      expect(Buffer.from(writeWtTab(r.parts, r.materialIndex)).equals(Buffer.from(data))).toBe(true);
    });
  }

  it('čita poznate vrednosti', () => {
    const p = readWtTab(fx('Kronospan Kasmir.tab')).parts[12];
    expect(p).toEqual({ dim1: 2436, dim2: 40, edge1: 4, edge2: 4, grain: 0, qty: 1, name: 'NIK_HOL_Maska' });
  });

  it('naziv: cp1250 i ograničenje na 25 bajtova', () => {
    const name = 'Ćošak đavola šđčćž 1234567890123';
    const f = fitName(name);
    expect(f.truncated).toBe(true);
    expect(f.name).toHaveLength(25);
    const back = readWtTab(writeWtTab([{ dim1: 1, dim2: 2, edge1: 0, edge2: 0, grain: 1, qty: 3, name: f.name }])).parts[0];
    expect(back.name).toBe(f.name);
    expect(fitName('日本').unmappable).toBe(2);
  });

  it('odbija pogrešan fajl', () => {
    expect(() => readWtTab(new Uint8Array(10))).toThrow();
    expect(() => readWtTab(new Uint8Array(200))).toThrow(/zaglavlje/);
  });
});
