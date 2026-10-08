// Poređenje dva skupa zapisa (npr. izvedeni iz CSV-a i postojeći .tab).
import type { WtPart } from './wtTab';

export interface DiffRow {
  status: 'same' | 'changed' | 'onlyA' | 'onlyB';
  a?: WtPart;
  b?: WtPart;
  /** Opisi razlika (na srpskom). */
  diffs: string[];
}

const dimKey = (p: WtPart) => [p.dim1, p.dim2].sort((x, y) => x - y).join('x');
const lc = (s: string) => s.toLowerCase();

/** Parove traži po (dimenzije bez obzira na redosled + naziv), pa po dimenzijama, pa po nazivu. */
export function compareParts(a: readonly WtPart[], b: readonly WtPart[]): DiffRow[] {
  const pairs: [number, number][] = [];
  const usedA = new Set<number>();
  const usedB = new Set<number>();
  const pass = (ok: (x: WtPart, y: WtPart) => boolean) => {
    a.forEach((x, i) => {
      if (usedA.has(i)) return;
      const j = b.findIndex((y, k) => !usedB.has(k) && ok(x, y));
      if (j >= 0) {
        pairs.push([i, j]);
        usedA.add(i);
        usedB.add(j);
      }
    });
  };
  pass((x, y) => dimKey(x) === dimKey(y) && lc(x.name) === lc(y.name));
  pass((x, y) => dimKey(x) === dimKey(y));
  pass((x, y) => lc(x.name) === lc(y.name) && x.name !== '');
  pass((x, y) => {
    const p = lc(x.name);
    const q = lc(y.name);
    return p !== '' && q !== '' && (p.startsWith(q) || q.startsWith(p));
  });

  const rows: DiffRow[] = [];
  const m = new Map(pairs);
  a.forEach((x, i) => {
    const j = m.get(i);
    if (j === undefined) {
      rows.push({ status: 'onlyA', a: x, diffs: ['nema u .tab fajlu'] });
      return;
    }
    const y = b[j];
    const diffs: string[] = [];
    const straight = x.dim1 === y.dim1 && x.dim2 === y.dim2;
    const swapped = x.dim1 === y.dim2 && x.dim2 === y.dim1;
    let e1 = y.edge1;
    let e2 = y.edge2;
    if (!straight && swapped) {
      diffs.push('dimenzije su zamenjene');
      [e1, e2] = [e2, e1];
    } else if (!straight) {
      diffs.push(`dimenzije: ${x.dim1} × ${x.dim2} ≠ ${y.dim1} × ${y.dim2}`);
    }
    if (x.edge1 !== e1) diffs.push(`kant 1: ${x.edge1} ≠ ${e1}`);
    if (x.edge2 !== e2) diffs.push(`kant 2: ${x.edge2} ≠ ${e2}`);
    if (x.grain !== y.grain) diffs.push(`vlakno: ${x.grain} ≠ ${y.grain}`);
    if (x.qty !== y.qty) diffs.push(`količina: ${x.qty} ≠ ${y.qty}`);
    if (lc(x.name) !== lc(y.name)) diffs.push(`naziv: „${x.name}" ≠ „${y.name}"`);
    rows.push({ status: diffs.length ? 'changed' : 'same', a: x, b: y, diffs });
  });
  b.forEach((y, k) => {
    if (!usedB.has(k)) rows.push({ status: 'onlyB', b: y, diffs: ['nema u trenutnim zapisima'] });
  });
  return rows;
}
