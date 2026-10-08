// ODS (OpenDocument Spreadsheet) parser: ZIP (fflate) + content.xml (DOMParser).
import { unzipSync } from 'fflate';

const NS_TABLE = 'urn:oasis:names:tc:opendocument:xmlns:table:1.0';
const NS_TEXT = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0';
const NS_OFFICE = 'urn:oasis:names:tc:opendocument:xmlns:office:1.0';

export interface OdsSheet {
  name: string;
  rows: string[][];
}

function inlineText(node: Node): string {
  let out = '';
  for (let n = node.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 3 || n.nodeType === 4) {
      out += (n as CharacterData).data;
    } else if (n.nodeType === 1) {
      const el = n as Element;
      if (el.namespaceURI === NS_TEXT) {
        if (el.localName === 's') {
          out += ' '.repeat(parseInt(el.getAttributeNS(NS_TEXT, 'c') ?? '1', 10) || 1);
          continue;
        }
        if (el.localName === 'tab') {
          out += '\t';
          continue;
        }
        if (el.localName === 'line-break') {
          out += '\n';
          continue;
        }
      }
      if (el.namespaceURI === NS_OFFICE && el.localName === 'annotation') continue; // komentari
      out += inlineText(el);
    }
  }
  return out;
}

export function cellText(cell: Element): string {
  const vtype = cell.getAttributeNS(NS_OFFICE, 'value-type');
  const attr = (name: string) => cell.getAttributeNS(NS_OFFICE, name) ?? '';
  switch (vtype) {
    case 'float':
    case 'percentage':
    case 'currency':
      return attr('value');
    case 'date':
      return attr('date-value');
    case 'time':
      return attr('time-value');
    case 'boolean':
      return attr('boolean-value');
  }
  const paras: string[] = [];
  for (let n = cell.firstElementChild; n; n = n.nextElementSibling) {
    if (n.namespaceURI === NS_TEXT && (n.localName === 'p' || n.localName === 'h')) {
      paras.push(inlineText(n));
    }
  }
  return paras.join('\n');
}

function repeatCount(el: Element, attr: string): number {
  const v = parseInt(el.getAttributeNS(NS_TABLE, attr) ?? '1', 10);
  return v > 0 ? v : 1;
}

function* tableRows(parent: Element): Generator<Element> {
  for (let n = parent.firstElementChild; n; n = n.nextElementSibling) {
    if (n.namespaceURI !== NS_TABLE) continue;
    if (n.localName === 'table-row') yield n;
    else if (
      n.localName === 'table-row-group' ||
      n.localName === 'table-header-rows' ||
      n.localName === 'table-rows'
    ) {
      yield* tableRows(n);
    }
  }
}

function parseTable(table: Element): string[][] {
  const rows: string[][] = [];
  let pendingBlankRows = 0;
  for (const row of tableRows(table)) {
    const cells: string[] = [];
    let pendingEmpty = 0;
    for (let c = row.firstElementChild; c; c = c.nextElementSibling) {
      if (c.namespaceURI !== NS_TABLE) continue;
      if (c.localName !== 'table-cell' && c.localName !== 'covered-table-cell') continue;
      const rep = repeatCount(c, 'number-columns-repeated');
      const text = cellText(c);
      if (text === '') {
        pendingEmpty += rep; // prazne ćelije na kraju se odsecaju
      } else {
        for (; pendingEmpty > 0; pendingEmpty--) cells.push('');
        for (let k = 0; k < rep; k++) cells.push(text);
      }
    }
    const rowRep = repeatCount(row, 'number-rows-repeated');
    if (cells.length === 0) {
      pendingBlankRows += rowRep; // prazni redovi na kraju se odsecaju
    } else {
      for (; pendingBlankRows > 0; pendingBlankRows--) rows.push([]);
      for (let k = 0; k < rowRep; k++) rows.push(k === 0 ? cells : cells.slice());
    }
  }
  return rows;
}

export function parseOdsXml(xml: string): OdsSheet[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) {
    throw new Error('Neispravan content.xml u ODS fajlu.');
  }
  const sheets: OdsSheet[] = [];
  const spreadsheet = doc.getElementsByTagNameNS(NS_OFFICE, 'spreadsheet')[0];
  if (!spreadsheet) return sheets;
  for (let n = spreadsheet.firstElementChild; n; n = n.nextElementSibling) {
    if (n.namespaceURI === NS_TABLE && n.localName === 'table') {
      sheets.push({
        name: n.getAttributeNS(NS_TABLE, 'name') || `List${sheets.length + 1}`,
        rows: parseTable(n),
      });
    }
  }
  return sheets;
}

export function parseOds(data: Uint8Array): OdsSheet[] {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(data, { filter: (f) => f.name === 'content.xml' });
  } catch {
    throw new Error('Fajl nije ispravna ZIP/ODS arhiva.');
  }
  const content = files['content.xml'];
  if (!content) throw new Error('ODS arhiva ne sadrži content.xml.');
  return parseOdsXml(new TextDecoder('utf-8').decode(content));
}

/** Dopunjava redove praznim stringovima do iste širine (ODS odseca prazne ćelije s kraja). */
export function padRows(rows: string[][]): string[][] {
  let w = 0;
  for (const r of rows) if (r.length > w) w = r.length;
  return rows.map((r) => (r.length === w ? r : r.concat(new Array<string>(w - r.length).fill(''))));
}
