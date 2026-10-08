// XLSX (Excel, Office Open XML) parser: ZIP (fflate) + workbook/sheet XML (DOMParser).
// Elementi se porede po localName, pa radi i "transitional" i "strict" namespace.
import { unzipSync } from 'fflate';
import type { OdsSheet } from './ods';

function children(parent: Element | null | undefined, name: string): Element[] {
  const out: Element[] = [];
  if (!parent) return out;
  for (let n = parent.firstElementChild; n; n = n.nextElementSibling) if (n.localName === name) out.push(n);
  return out;
}

function child(parent: Element | null | undefined, name: string): Element | undefined {
  return children(parent, name)[0];
}

function parseXml(text: string, what: string): Element {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error(`Neispravan ${what} u XLSX fajlu.`);
  return doc.documentElement;
}

/** OOXML kodira kontrolne znakove kao _xHHHH_ (npr. _x000D_ za CR). */
function unescapeOoxml(s: string): string {
  return s.includes('_x') ? s.replace(/_x([0-9A-Fa-f]{4})_/g, (_, h: string) => String.fromCharCode(parseInt(h, 16))) : s;
}

/** Tekst iz <si> / <is>: direktan <t> ili niz <r><t>; fonetski <rPh> se preskače. */
function richText(el: Element | undefined): string {
  if (!el) return '';
  let out = '';
  for (let n = el.firstElementChild; n; n = n.nextElementSibling) {
    if (n.localName === 't') out += n.textContent ?? '';
    else if (n.localName === 'r') out += child(n, 't')?.textContent ?? '';
  }
  return unescapeOoxml(out);
}

/** Broj kako ga Excel prikazuje (15 značajnih cifara): "2.4500000000000002" -> "2.45". */
function excelNumber(v: string): string {
  const x = Number(v);
  if (v.trim() === '' || !Number.isFinite(x)) return v;
  return String(Number(x.toPrecision(15)));
}

/** "AB12" -> indeks kolone 27 (od nule); -1 ako referenca nedostaje. */
function colIndex(ref: string | null): number {
  if (!ref) return -1;
  let c = 0;
  let i = 0;
  for (; i < ref.length; i++) {
    const code = ref.charCodeAt(i);
    if (code >= 65 && code <= 90) c = c * 26 + code - 64;
    else if (code >= 97 && code <= 122) c = c * 26 + code - 96;
    else break;
  }
  return i === 0 ? -1 : c - 1;
}

function cellText(c: Element, shared: string[]): string {
  const t = c.getAttribute('t') ?? 'n';
  if (t === 'inlineStr') return richText(child(c, 'is'));
  const v = child(c, 'v')?.textContent ?? '';
  switch (t) {
    case 's':
      return shared[parseInt(v, 10)] ?? '';
    case 'b':
      return v === '1' ? 'true' : v === '0' ? 'false' : v;
    case 'n':
      return excelNumber(v);
    default: // str (rezultat formule), e (greška), d (ISO datum)
      return unescapeOoxml(v);
  }
}

export function parseSheetXml(xml: string, shared: string[] = []): string[][] {
  const sheetData = child(parseXml(xml, 'list'), 'sheetData');
  const rows: string[][] = [];
  let pendingBlankRows = 0;
  let nextRow = 1;
  for (const row of children(sheetData, 'row')) {
    const r = parseInt(row.getAttribute('r') ?? '', 10);
    const rowNum = r > 0 ? r : nextRow;
    if (rowNum > nextRow) pendingBlankRows += rowNum - nextRow; // izostavljeni (prazni) redovi
    nextRow = rowNum + 1;
    const cells: string[] = [];
    let col = 0;
    for (const c of children(row, 'c')) {
      const ci = colIndex(c.getAttribute('r'));
      if (ci >= col) col = ci;
      const text = cellText(c, shared);
      if (text !== '') {
        while (cells.length < col) cells.push(''); // prazne ćelije na kraju se odsecaju
        cells[col] = text;
      }
      col++;
    }
    if (cells.length === 0) {
      pendingBlankRows++; // prazni redovi na kraju se odsecaju
    } else {
      for (; pendingBlankRows > 0; pendingBlankRows--) rows.push([]);
      rows.push(cells);
    }
  }
  return rows;
}

export function parseSharedStrings(xml: string): string[] {
  return children(parseXml(xml, 'sharedStrings.xml'), 'si').map((si) => richText(si));
}

/** r:id atribut, bez obzira na prefiks i namespace (transitional ili strict). */
function relId(el: Element): string {
  for (const a of Array.from(el.attributes)) if (a.localName === 'id' && a.prefix) return a.value;
  return '';
}

/** Putanja cilja iz xl/_rels/workbook.xml.rels u odnosu na koren arhive. */
function resolveTarget(target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = ['xl'];
  for (const p of target.split('/')) {
    if (p === '..') parts.pop();
    else if (p && p !== '.') parts.push(p);
  }
  return parts.join('/');
}

export function parseXlsx(data: Uint8Array): OdsSheet[] {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(data, { filter: (f) => /\.(xml|rels)$/i.test(f.name) });
  } catch {
    throw new Error('Fajl nije ispravna ZIP/XLSX arhiva.');
  }
  const dec = new TextDecoder('utf-8');
  const text = (name: string) => (files[name] ? dec.decode(files[name]) : undefined);

  const workbook = text('xl/workbook.xml');
  if (!workbook) throw new Error('XLSX arhiva ne sadrži xl/workbook.xml.');
  const rels = new Map<string, string>();
  let sharedPath = 'xl/sharedStrings.xml';
  const relsXml = text('xl/_rels/workbook.xml.rels');
  if (relsXml) {
    for (const r of children(parseXml(relsXml, 'workbook.xml.rels'), 'Relationship')) {
      const target = resolveTarget(r.getAttribute('Target') ?? '');
      rels.set(r.getAttribute('Id') ?? '', target);
      if (/\/sharedStrings$/.test(r.getAttribute('Type') ?? '')) sharedPath = target;
    }
  }
  const sharedXml = text(sharedPath);
  const shared = sharedXml ? parseSharedStrings(sharedXml) : [];

  const sheets: OdsSheet[] = [];
  for (const s of children(child(parseXml(workbook, 'workbook.xml'), 'sheets'), 'sheet')) {
    const name = s.getAttribute('name') || `List${sheets.length + 1}`;
    const xml = text(rels.get(relId(s)) ?? `xl/worksheets/sheet${sheets.length + 1}.xml`);
    if (xml === undefined) continue; // npr. list sa grafikonom (chartsheet) nema ćelije
    sheets.push({ name, rows: parseSheetXml(xml, shared) });
  }
  return sheets;
}
