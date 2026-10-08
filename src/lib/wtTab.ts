// WT Input .tab: binarni format (little-endian, Delphi packed record).
// Zaglavlje 165 B + N zapisa po 79 B. Vidi PROMPT.md i tests/fixtures/reference_writer.py.
import { decodeCp1250, encodeCp1250 } from './encoding';

export const HEADER_SIZE = 165;
export const RECORD_SIZE = 79;
export const NAME_MAX = 25;
/** Pascal stringovi: 06 'DAT5.0' 06 'TABDTA' 04 '1.00' (19 bajtova). */
const pascal = (s: string): number[] => [s.length, ...Array.from(s, (c) => c.charCodeAt(0))];
const MAGIC: number[] = [...pascal('DAT5.0'), ...pascal('TABDTA'), ...pascal('1.00')];

export interface WtPart {
  /** Dimenzija 1 (mm). */
  dim1: number;
  /** Dimenzija 2 (mm). */
  dim2: number;
  /** Šifra kantovanja za dve stranice uz dimenziju 1. */
  edge1: number;
  /** Šifra kantovanja za dve stranice uz dimenziju 2. */
  edge2: number;
  /** 1 = prati smer vlakna, 0 = rotacija dozvoljena. */
  grain: number;
  qty: number;
  /** Naziv (max 25 bajtova u windows-1250). */
  name: string;
}

/** Skraćuje naziv na 25 bajtova windows-1250; znakovi van cp1250 postaju '?'. */
export function fitName(name: string): { name: string; truncated: boolean; unmappable: number } {
  const enc = encodeCp1250(name);
  const truncated = enc.bytes.length > NAME_MAX;
  const bytes = enc.bytes.slice(0, NAME_MAX);
  return { name: decodeCp1250(bytes) ?? '', truncated, unmappable: enc.unmappable };
}

export const DEFAULT_MATERIAL_INDEX = 3;

/** materialIndex: bajt 20 zaglavlja (u primerima 3; verovatno indeks materijala iz WT padajuće liste). */
export function writeWtTab(parts: readonly WtPart[], materialIndex = DEFAULT_MATERIAL_INDEX): Uint8Array {
  if (parts.length > 0xffff) throw new Error('Previše zapisa za .tab (max 65535).');
  const out = new Uint8Array(HEADER_SIZE + parts.length * RECORD_SIZE);
  const dv = new DataView(out.buffer);
  out.set(MAGIC, 0);
  out[20] = materialIndex & 0xff;
  dv.setUint16(23, parts.length, true);
  parts.forEach((p, i) => {
    const o = HEADER_SIZE + i * RECORD_SIZE;
    dv.setUint32(o, p.dim1 >>> 0, true);
    dv.setUint32(o + 4, p.dim2 >>> 0, true);
    out[o + 8] = p.edge1 & 0xff;
    out[o + 9] = p.edge2 & 0xff;
    out[o + 29] = p.grain & 0xff;
    dv.setUint16(o + 31, p.qty & 0xffff, true);
    const nb = encodeCp1250(p.name).bytes.slice(0, NAME_MAX);
    out[o + 53] = nb.length;
    out.set(nb, o + 54);
  });
  return out;
}

export interface ReadResult {
  parts: WtPart[];
  materialIndex: number;
  warnings: string[];
}

export function readWtTab(data: Uint8Array): ReadResult {
  const warnings: string[] = [];
  if (data.length < HEADER_SIZE) throw new Error('Fajl je prekratak da bi bio WT Input .tab.');
  for (let i = 0; i < MAGIC.length; i++) {
    if (data[i] !== MAGIC[i]) throw new Error('Fajl nema WT Input (DAT5.0 / TABDTA) zaglavlje.');
  }
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const count = dv.getUint16(23, true);
  const avail = Math.floor((data.length - HEADER_SIZE) / RECORD_SIZE);
  if (avail < count) warnings.push(`Zaglavlje kaže ${count} zapisa, a u fajlu ih ima samo ${avail}.`);
  else if (avail > count) warnings.push(`Zaglavlje kaže ${count} zapisa, a u fajlu ima podataka za ${avail}.`);
  if ((data.length - HEADER_SIZE) % RECORD_SIZE !== 0) warnings.push('Veličina fajla nije celobrojni umnožak zapisa.');
  const n = Math.min(count, avail);
  const parts: WtPart[] = [];
  for (let i = 0; i < n; i++) {
    const o = HEADER_SIZE + i * RECORD_SIZE;
    const len = Math.min(data[o + 53], NAME_MAX);
    parts.push({
      dim1: dv.getUint32(o, true),
      dim2: dv.getUint32(o + 4, true),
      edge1: data[o + 8],
      edge2: data[o + 9],
      grain: data[o + 29],
      qty: dv.getUint16(o + 31, true),
      name: decodeCp1250(data.subarray(o + 54, o + 54 + len)) ?? '',
    });
  }
  return { parts, warnings, materialIndex: data[20] };
}
