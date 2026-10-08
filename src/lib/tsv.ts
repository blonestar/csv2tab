// Serijalizacija u tab-delimited tekst.

export type LineEnding = 'lf' | 'crlf';

export interface TsvOptions {
  lineEnding: LineEnding;
  /**
   * true: ćelije sa tabom/novim redom/navodnikom stavljaju se pod navodnike (kao Python csv writer).
   * false: tab i novi red se zamenjuju razmakom (ne mogu da pokvare TSV).
   */
  quoteSpecial: boolean;
}

export const defaultTsvOptions: TsvOptions = { lineEnding: 'lf', quoteSpecial: false };

const SPECIAL = /[\t\r\n"]/;
const WS_RUN = /[\t\r\n]+/g;

export function tsvCell(value: string, quoteSpecial: boolean): string {
  if (!SPECIAL.test(value)) return value;
  if (quoteSpecial) return '"' + value.replace(/"/g, '""') + '"';
  return value.replace(WS_RUN, ' ');
}

export function toTsv(rows: readonly (readonly string[])[], opts: TsvOptions = defaultTsvOptions): string {
  const eol = opts.lineEnding === 'crlf' ? '\r\n' : '\n';
  const lines: string[] = new Array(rows.length);
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    const cells = new Array<string>(row.length);
    for (let c = 0; c < row.length; c++) cells[c] = tsvCell(row[c], opts.quoteSpecial);
    lines[r] = cells.join('\t');
  }
  return lines.length ? lines.join(eol) + eol : '';
}
