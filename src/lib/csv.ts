// CSV parser (RFC 4180): navodnici, "" escape, novi redovi unutar navodnika.

export const DELIMITERS = [',', ';', '\t', '|'] as const;

/**
 * Parsira CSV tekst u redove. Prazan red daje [''].
 * @param maxRows opciono ograničenje broja redova (za detekciju).
 */
export function parseCsv(text: string, delimiter = ',', maxRows = Infinity): string[][] {
  const rows: string[][] = [];
  const n = text.length;
  if (n === 0) return rows;
  const d = delimiter.charCodeAt(0);
  let i = 0;
  let row: string[] = [];

  while (i < n) {
    let field: string;
    if (text.charCodeAt(i) === 34) {
      i++;
      let out = '';
      for (;;) {
        const q = text.indexOf('"', i);
        if (q === -1) {
          out += text.slice(i); // nezatvoren navodnik: uzmi ostatak
          i = n;
          break;
        }
        out += text.slice(i, q);
        if (text.charCodeAt(q + 1) === 34) {
          out += '"';
          i = q + 2;
        } else {
          i = q + 1;
          break;
        }
      }
      // slučajni znakovi posle zatvorenog navodnika
      let j = i;
      while (j < n) {
        const c = text.charCodeAt(j);
        if (c === d || c === 10 || c === 13) break;
        j++;
      }
      out += text.slice(i, j);
      i = j;
      field = out;
    } else {
      let j = i;
      while (j < n) {
        const c = text.charCodeAt(j);
        if (c === d || c === 10 || c === 13) break;
        j++;
      }
      field = text.slice(i, j);
      i = j;
    }
    row.push(field);
    if (i >= n) break;
    const c = text.charCodeAt(i);
    if (c === d) {
      i++;
      if (i >= n) row.push('');
      continue;
    }
    i += c === 13 && text.charCodeAt(i + 1) === 10 ? 2 : 1;
    rows.push(row);
    row = [];
    if (rows.length >= maxRows) return rows;
  }
  if (row.length) rows.push(row);
  return rows;
}

/** Bira separator koji daje najkonzistentniji broj kolona u prvih ~50 redova. */
export function detectDelimiter(text: string, sampleRows = 50): string {
  const sample = text.length > 400_000 ? text.slice(0, 400_000) : text;
  // prioritet pri izjednačenju: tab, ;, ,, |
  const candidates = ['\t', ';', ',', '|'];
  let best = ',';
  let bestScore = -1;
  for (const d of candidates) {
    if (!sample.includes(d)) continue;
    const rows = parseCsv(sample, d, sampleRows).filter((r) => !(r.length === 1 && r[0] === ''));
    if (rows.length === 0) continue;
    const freq = new Map<number, number>();
    for (const r of rows) freq.set(r.length, (freq.get(r.length) ?? 0) + 1);
    let mode = 0;
    let modeCount = 0;
    for (const [len, cnt] of freq) {
      if (cnt > modeCount || (cnt === modeCount && len > mode)) {
        mode = len;
        modeCount = cnt;
      }
    }
    if (mode < 2) continue;
    const consistency = modeCount / rows.length;
    const headerMatch = rows[0].length === mode ? 0.01 : 0;
    const score = consistency + headerMatch;
    if (score > bestScore + 1e-9) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}
