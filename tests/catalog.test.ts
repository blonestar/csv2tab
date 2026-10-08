import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { matchMaterial, materialLabel, searchMaterials, suggestFilename, type WtCatalog } from '../src/lib/catalog';

const cat = JSON.parse(readFileSync(resolve(process.cwd(), 'src/data/wt-catalog.json'), 'utf8')) as WtCatalog;

describe('WT katalog', () => {
  it('učitava materijale i trake', () => {
    expect(cat.materials.length).toBeGreaterThan(800);
    expect(cat.edgeBands.length).toBeGreaterThan(5);
  });
  it('pretraga i automatski izbor po šifri', () => {
    const m = cat.materials[0];
    expect(searchMaterials(cat, m.code)[0].code).toBe(m.code);
    expect(matchMaterial(cat, m.code)?.code).toBe(m.code);
    expect(matchMaterial(cat, '???')).toBeUndefined();
    expect(materialLabel(m)).toContain(m.code);
  });
  it('predlog imena fajla', () => {
    const m = { name: 'Melamin H 1137', code: 'H1137', sheet: [2800, 2070] as [number, number], thickness: 18, grain: 1 };
    expect(suggestFilename(m, { name: 'ABS', code: 'ABS' })).toBe('H1137 18 mm ABS');
    expect(suggestFilename(m)).toBe('H1137 18 mm');
  });
});
