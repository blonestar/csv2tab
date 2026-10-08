import './style.css';
import { zipSync } from 'fflate';
import { analyze, hasTabOrNewline, isDecimalComma, isSuspicious, type Stats } from './lib/analyze';
import {
  cleanCellAt,
  cleanTable,
  defaultCleanOptions,
  isBlankRow,
  parseUnits,
  type CleanOptions,
} from './lib/clean';
import { encodeOutput, type InputEncoding, type OutputEncoding } from './lib/encoding';
import { padRows, parseOds, type OdsSheet } from './lib/ods';
import { toTsv, type LineEnding } from './lib/tsv';
import type { WorkerRequest, WorkerResponse } from './worker';

const PREVIEW_ROWS = 500;
const MAX_PREVIEW_COLS = 200;

interface FileEntry {
  id: number;
  name: string;
  kind: 'csv' | 'ods';
  size: number;
  bytes: Uint8Array;
  encodingSel: 'auto' | InputEncoding;
  delimSel: string;
  sheetIdx: number;
  loading: boolean;
  error?: string;
  // CSV
  rows?: string[][];
  stats?: Stats;
  detectedEnc?: InputEncoding;
  detectedDelim?: string;
  hadBom?: boolean;
  // ODS
  sheets?: OdsSheet[];
  sheetStats?: (Stats | undefined)[];
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const state = {
  files: [] as FileEntry[],
  activeId: -1,
  clean: defaultCleanOptions(),
  onlySelected: false,
  selectedCols: new Set<number>(),
  selectedFor: '' as string, // ključ tabele za koju važi selectedCols
};
let nextFileId = 1;

// ---------- worker ----------
const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
let nextReq = 1;
const pending = new Map<number, (r: WorkerResponse) => void>();
worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
  const cb = pending.get(e.data.reqId);
  if (cb) {
    pending.delete(e.data.reqId);
    cb(e.data);
  }
};
worker.onerror = (e) => {
  for (const [id, cb] of pending) cb({ reqId: id, ok: false, error: e.message || 'Greška u radniku.' });
  pending.clear();
};

function parseCsvInWorker(entry: FileEntry): Promise<WorkerResponse> {
  return new Promise((resolve) => {
    const reqId = nextReq++;
    pending.set(reqId, resolve);
    const buffer = entry.bytes.slice().buffer; // kopija; original ostaje za ponovno parsiranje
    const msg: WorkerRequest = { reqId, buffer, encoding: entry.encodingSel, delimiter: entry.delimSel };
    worker.postMessage(msg, [buffer]);
  });
}

// ---------- fajlovi ----------
function active(): FileEntry | undefined {
  return state.files.find((f) => f.id === state.activeId);
}

function currentRows(f: FileEntry): string[][] | undefined {
  if (f.kind === 'ods') return f.sheets?.[f.sheetIdx]?.rows;
  return f.rows;
}

function currentStats(f: FileEntry): Stats | undefined {
  if (f.kind === 'ods') {
    if (!f.sheets) return undefined;
    f.sheetStats ??= [];
    return (f.sheetStats[f.sheetIdx] ??= analyze(f.sheets[f.sheetIdx].rows));
  }
  return f.stats;
}

async function loadCsv(f: FileEntry) {
  f.loading = true;
  f.error = undefined;
  renderAll();
  const r = await parseCsvInWorker(f);
  f.loading = false;
  if (r.ok) {
    f.rows = r.rows;
    f.stats = r.stats;
    f.detectedEnc = r.encoding;
    f.detectedDelim = r.delimiter;
    f.hadBom = r.hadBom;
  } else {
    f.error = r.error;
  }
  renderAll();
}

async function addFiles(list: FileList | File[]) {
  for (const file of Array.from(list)) {
    const lower = file.name.toLowerCase();
    const bytes = new Uint8Array(await file.arrayBuffer());
    const f: FileEntry = {
      id: nextFileId++,
      name: file.name,
      kind: lower.endsWith('.ods') ? 'ods' : 'csv',
      size: file.size,
      bytes,
      encodingSel: 'auto',
      delimSel: 'auto',
      sheetIdx: 0,
      loading: true,
    };
    state.files.push(f);
    state.activeId = f.id;
    renderAll();
    if (f.kind === 'ods') {
      // DOMParser nije dostupan u Web Workeru, pa se ODS parsira u glavnoj niti.
      await new Promise((r) => setTimeout(r, 10));
      try {
        f.sheets = parseOds(bytes).map((s) => ({ name: s.name, rows: padRows(s.rows) }));
        if (f.sheets.length === 0) f.error = 'ODS fajl ne sadrži nijedan list.';
      } catch (err) {
        f.error = err instanceof Error ? err.message : String(err);
      }
      f.loading = false;
      renderAll();
    } else {
      await loadCsv(f);
    }
  }
}

function removeFile(id: number) {
  state.files = state.files.filter((f) => f.id !== id);
  if (state.activeId === id) state.activeId = state.files[0]?.id ?? -1;
  renderAll();
}

// ---------- opcije ----------
function readOptions() {
  const o = state.clean;
  o.replaceWhitespace = $<HTMLInputElement>('o-ws').checked;
  o.decimalComma = $<HTMLInputElement>('o-dec').checked;
  o.thousandsInIntegers = $<HTMLInputElement>('o-thou').checked;
  o.stripUnits = $<HTMLInputElement>('o-units').checked;
  o.units = parseUnits($<HTMLInputElement>('o-units-list').value);
  o.trim = $<HTMLInputElement>('o-trim').checked;
  o.nbspToSpace = $<HTMLInputElement>('o-nbsp').checked;
  o.stripBom = $<HTMLInputElement>('o-bom').checked;
  o.fixMojibake = $<HTMLInputElement>('o-moji').checked;
  o.removeEmptyRows = $<HTMLInputElement>('o-erows').checked;
  o.removeEmptyCols = $<HTMLInputElement>('o-ecols').checked;
  state.onlySelected = $<HTMLInputElement>('o-sel').checked;
  $<HTMLInputElement>('o-units-list').disabled = !o.stripUnits;
}

function effectiveOptions(): CleanOptions {
  return { ...state.clean, columns: state.onlySelected ? state.selectedCols : null };
}

function exportSettings() {
  return {
    ext: $<HTMLSelectElement>('x-ext').value,
    enc: $<HTMLSelectElement>('x-enc').value as OutputEncoding,
    eol: $<HTMLSelectElement>('x-eol').value as LineEnding,
  };
}

// ---------- render ----------
const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function show(s: string): string {
  return esc(s)
    .replace(/\t/g, '<span class="ctl">⇥</span>')
    .replace(/\r\n|\r|\n/g, '<span class="ctl">↵</span>')
    .replace(/ /g, '<span class="ctl">⍽</span>')
    .replace(/﻿/g, '<span class="ctl">BOM</span>');
}

const plain = (s: string) => s.replace(/\t/g, '\\t').replace(/\r/g, '\\r').replace(/\n/g, '\\n');

const fmtSize = (n: number) =>
  n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;

const nf = (n: number) => n.toLocaleString('sr-Latn');

const ENC_LABEL: Record<InputEncoding, string> = {
  'utf-8': 'UTF-8',
  'windows-1250': 'windows-1250',
  'latin-1': 'latin-1',
};
const DELIM_LABEL: Record<string, string> = { ',': 'zarez ( , )', ';': 'tačka-zarez ( ; )', '\t': 'tab', '|': 'uspravna crta ( | )' };

function renderAll() {
  const f = active();
  $('workspace').hidden = !f;
  renderFileList();
  if (!f) return;
  renderDetect(f);
  const table = currentRows(f);
  const stats = currentStats(f);
  const key = `${f.id}:${f.sheetIdx}:${f.rows ? f.rows.length : 0}`;
  if (stats && state.selectedFor !== key) {
    state.selectedFor = key;
    state.selectedCols = new Set(Array.from({ length: stats.cols }, (_, i) => i));
  }
  renderWarnings(f, stats);
  renderPreview(f, table, stats);
  $('btn-all').hidden = !(f.kind === 'ods' && (f.sheets?.length ?? 0) > 1);
  updateDownloadLabel();
}

function renderFileList() {
  const ul = $('file-list');
  ul.hidden = state.files.length === 0;
  ul.innerHTML = state.files
    .map(
      (f) => `<li class="${f.id === state.activeId ? 'active' : ''}">
        <button type="button" class="file-pick" data-id="${f.id}">
          <span class="badge">${f.kind.toUpperCase()}</span>
          <span class="fname">${esc(f.name)}</span>
          <span class="muted">${fmtSize(f.size)}</span>
        </button>
        <button type="button" class="file-rm" data-rm="${f.id}" aria-label="Ukloni ${esc(f.name)}">×</button>
      </li>`,
    )
    .join('');
}

function fillSelect(sel: HTMLSelectElement, opts: [string, string][], value: string) {
  sel.innerHTML = opts.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('');
  sel.value = value;
}

function renderDetect(f: FileEntry) {
  document.querySelectorAll<HTMLElement>('.csv-only').forEach((e) => (e.hidden = f.kind !== 'csv'));
  document.querySelectorAll<HTMLElement>('.ods-only').forEach((e) => (e.hidden = f.kind !== 'ods'));
  const info = $('detect-info');
  if (f.loading) {
    info.textContent = 'Učitavam i obrađujem…';
    return;
  }
  if (f.error) {
    info.textContent = '';
    return;
  }
  if (f.kind === 'csv') {
    const enc = f.detectedEnc ?? 'utf-8';
    const delim = f.detectedDelim ?? ',';
    info.textContent = `Detektovano: ${ENC_LABEL[enc]}${f.hadBom ? ' (sa BOM-om)' : ''}, separator: ${DELIM_LABEL[delim] ?? delim}.`;
    fillSelect(
      $('sel-encoding') as HTMLSelectElement,
      [
        ['auto', `Automatski (${ENC_LABEL[enc]})`],
        ['utf-8', 'UTF-8'],
        ['windows-1250', 'windows-1250'],
        ['latin-1', 'latin-1'],
      ],
      f.encodingSel,
    );
    fillSelect(
      $('sel-delimiter') as HTMLSelectElement,
      [['auto', `Automatski (${DELIM_LABEL[delim] ?? delim})`], ...Object.entries(DELIM_LABEL)],
      f.delimSel,
    );
  } else {
    const n = f.sheets?.length ?? 0;
    info.textContent = `ODS fajl: ${n} ${n === 1 ? 'list' : 'listova'}.`;
    fillSelect(
      $('sel-sheet') as HTMLSelectElement,
      (f.sheets ?? []).map((s, i) => [String(i), `${i + 1}. ${s.name}`] as [string, string]),
      String(f.sheetIdx),
    );
  }
}

function renderWarnings(f: FileEntry, s: Stats | undefined) {
  const items: string[] = [];
  if (f.error) items.push(`<li class="err">Greška: ${esc(f.error)}</li>`);
  if (s) {
    if (s.rows === 0) items.push('<li>Fajl je prazan.</li>');
    if (s.raggedRows > 0) {
      const sample = s.raggedSample.map((r) => r + 1).join(', ');
      items.push(
        `<li>${nf(s.raggedRows)} ${s.raggedRows === 1 ? 'red ima' : 'redova ima'} drugačiji broj kolona od zaglavlja (red ${esc(sample)}${s.raggedRows > s.raggedSample.length ? ', …' : ''}). Možda je pogrešan separator.</li>`,
      );
    }
    if (s.tabNewlineCells > 0)
      items.push(`<li>${nf(s.tabNewlineCells)} ćelija sadrži tab ili novi red (uključite zamenu razmakom).</li>`);
    if (s.decimalCommaCells > 0)
      items.push(`<li>${nf(s.decimalCommaCells)} ćelija izgleda kao broj sa decimalnim zarezom.</li>`);
    if (s.mojibakeCells > 0)
      items.push(`<li>${nf(s.mojibakeCells)} ćelija izgleda kao mojibake (pogrešno kodiranje). Probajte drugo kodiranje ili uključite „Popravi mojibake".</li>`);
    const other = s.suspiciousCells - s.mojibakeCells;
    if (other > 0)
      items.push(`<li>${nf(other)} ćelija sadrži sumnjive znakove (BOM, nerazdvojivi razmak ili zamenski znak).</li>`);
  }
  $('warnings-card').hidden = items.length === 0;
  $('warnings').innerHTML = items.join('');
}

function renderPreview(f: FileEntry, rows: string[][] | undefined, s: Stats | undefined) {
  const wrap = $('table-wrap');
  const info = $('preview-info');
  if (!rows || !s) {
    wrap.innerHTML = '';
    info.textContent = f.loading ? 'Učitavam…' : '';
    return;
  }
  const o = effectiveOptions();
  const headerLen = rows.length ? rows[0].length : 0;
  const width = Math.min(s.cols, MAX_PREVIEW_COLS);
  const colVisible = (c: number) => !o.removeEmptyCols || s.nonEmptyCols[c];
  const cols: number[] = [];
  for (let c = 0; c < width; c++) if (colVisible(c)) cols.push(c);

  const html: string[] = [];
  let shown = 0;
  let headerDone = false;
  let changedCells = 0;
  html.push('<table class="grid-table"><thead><tr>', '<th class="rn">#</th>');
  let bodyStarted = false;
  for (let r = 0; r < rows.length && shown < PREVIEW_ROWS; r++) {
    const row = rows[r];
    if (o.removeEmptyRows && isBlankRow(row)) continue;
    const ragged = headerDone && row.length !== headerLen && !(row.length === 1 && row[0] === '');
    if (!headerDone) {
      html.push(
        cols
          .map((c) => {
            const old = c < row.length ? row[c] : '';
            const nw = cleanCellAt(old, c, o);
            const chk = state.onlySelected
              ? `<input type="checkbox" data-col="${c}" ${state.selectedCols.has(c) ? 'checked' : ''} aria-label="Čisti kolonu ${c + 1}" />`
              : '';
            return `<th class="${nw !== old ? 'chg' : ''}"${nw !== old ? ` title="${esc(plain(old))} → ${esc(plain(nw))}"` : ''}>${chk}<span>${show(nw)}</span><small>${colName(c)}</small></th>`;
          })
          .join('') + '</tr></thead><tbody>',
      );
      headerDone = true;
      bodyStarted = true;
      shown++;
      continue;
    }
    const out: string[] = [];
    out.push(`<tr class="${ragged ? 'rag' : ''}"><td class="rn">${r + 1}</td>`);
    for (const c of cols) {
      if (c >= row.length) {
        out.push('<td class="missing"></td>');
        continue;
      }
      const old = row[c];
      const nw = cleanCellAt(old, c, o);
      const cls: string[] = [];
      if (nw !== old) {
        cls.push('chg');
        changedCells++;
      }
      if (hasTabOrNewline(old)) cls.push('w-tab');
      if (isDecimalComma(old)) cls.push('w-dec');
      if (isSuspicious(old)) cls.push('w-sus');
      if (ragged && c >= headerLen) cls.push('extra');
      const title = nw !== old ? ` title="${esc(plain(old))} → ${esc(plain(nw))}"` : '';
      out.push(`<td${cls.length ? ` class="${cls.join(' ')}"` : ''}${title}>${show(nw)}</td>`);
    }
    out.push('</tr>');
    html.push(out.join(''));
    shown++;
  }
  if (!bodyStarted) html.push('</tr></thead><tbody>');
  html.push('</tbody></table>');
  wrap.innerHTML = html.join('');

  const total = `Ukupno ${nf(s.rows)} ${s.rows === 1 ? 'red' : 'redova'} × ${nf(s.cols)} ${s.cols === 1 ? 'kolona' : 'kolona'}.`;
  const lim = shown >= PREVIEW_ROWS && s.rows > shown ? ` Prikazano prvih ${nf(PREVIEW_ROWS)} redova.` : '';
  const colLim = s.cols > MAX_PREVIEW_COLS ? ` Prikazano prvih ${MAX_PREVIEW_COLS} kolona.` : '';
  const chg = changedCells ? ` Čišćenje menja ${nf(changedCells)} ćelija u prikazu.` : '';
  info.textContent = total + lim + colLim + chg;
}

function colName(c: number): string {
  let n = c;
  let s = '';
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

function updateDownloadLabel() {
  $('btn-download').textContent = `Preuzmi ${exportSettings().ext}`;
}

// ---------- izvoz ----------
const tick = () => new Promise((r) => setTimeout(r, 20));

function safeName(name: string): string {
  return name.replace(/[^\p{L}\p{N}_-]+/gu, '_').replace(/^_+|_+$/g, '') || 'list';
}
const baseName = (n: string) => n.replace(/\.[^.]+$/, '');

function buildBytes(rows: string[][]): { bytes: Uint8Array; unmappable: number; text: string } {
  const { eol, enc } = exportSettings();
  const cleaned = cleanTable(rows, effectiveOptions());
  const text = toTsv(cleaned, { lineEnding: eol, quoteSpecial: !state.clean.replaceWhitespace });
  return { ...encodeOutput(text, enc), text };
}

function download(name: string, bytes: Uint8Array, type: string) {
  const blob = new Blob([bytes as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function setStatus(msg: string, isErr = false) {
  const el = $('export-status');
  el.textContent = msg;
  el.classList.toggle('err', isErr);
}

async function doDownload() {
  const f = active();
  const rows = f && currentRows(f);
  if (!f || !rows) return;
  setStatus('Obrađujem…');
  await tick();
  const { ext } = exportSettings();
  const r = buildBytes(rows);
  let name = baseName(f.name);
  if (f.kind === 'ods' && (f.sheets?.length ?? 0) > 1) name += '_' + safeName(f.sheets![f.sheetIdx].name);
  download(name + ext, r.bytes, 'text/tab-separated-values');
  setStatus(
    `Preuzeto: ${name + ext} (${fmtSize(r.bytes.length)}).` +
      (r.unmappable ? ` Upozorenje: ${r.unmappable} znakova nije postojalo u windows-1250 i zamenjeno je sa „?".` : ''),
    r.unmappable > 0,
  );
}

async function doDownloadAll() {
  const f = active();
  if (!f || !f.sheets) return;
  setStatus('Pakujem listove…');
  await tick();
  const { ext } = exportSettings();
  const files: Record<string, Uint8Array> = {};
  let unmappable = 0;
  const base = baseName(f.name);
  for (const sheet of f.sheets) {
    const r = buildBytes(sheet.rows);
    unmappable += r.unmappable;
    let n = `${base}_${safeName(sheet.name)}${ext}`;
    for (let i = 2; files[n]; i++) n = `${base}_${safeName(sheet.name)}_${i}${ext}`;
    files[n] = r.bytes;
  }
  const zip = zipSync(files, { level: 6 });
  download(`${base}.zip`, zip, 'application/zip');
  setStatus(
    `Preuzeto: ${base}.zip (${Object.keys(files).length} listova, ${fmtSize(zip.length)}).` +
      (unmappable ? ` Upozorenje: ${unmappable} znakova nije postojalo u windows-1250.` : ''),
    unmappable > 0,
  );
}

async function doCopy() {
  const f = active();
  const rows = f && currentRows(f);
  if (!f || !rows) return;
  setStatus('Obrađujem…');
  await tick();
  const { eol } = exportSettings();
  const text = toTsv(cleanTable(rows, effectiveOptions()), { lineEnding: eol, quoteSpecial: !state.clean.replaceWhitespace });
  try {
    await navigator.clipboard.writeText(text);
    setStatus(`Kopirano u clipboard (${fmtSize(text.length)}).`);
  } catch {
    setStatus('Kopiranje nije uspelo (browser je odbio pristup clipboard-u ili je sadržaj prevelik). Koristite preuzimanje.', true);
  }
}

// ---------- događaji ----------
function init() {
  const o = state.clean;
  $<HTMLInputElement>('o-ws').checked = o.replaceWhitespace;
  $<HTMLInputElement>('o-units-list').value = o.units.join(', ');
  readOptions();

  const input = $<HTMLInputElement>('file-input');
  $('pick').addEventListener('click', (e) => {
    e.stopPropagation();
    input.click();
  });
  input.addEventListener('change', () => {
    if (input.files?.length) void addFiles(input.files);
    input.value = '';
  });
  const dz = $('dropzone');
  dz.addEventListener('click', () => input.click());
  dz.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      input.click();
    }
  });
  ['dragenter', 'dragover'].forEach((t) =>
    dz.addEventListener(t, (e) => {
      e.preventDefault();
      dz.classList.add('over');
    }),
  );
  ['dragleave', 'drop'].forEach((t) =>
    dz.addEventListener(t, (e) => {
      e.preventDefault();
      dz.classList.remove('over');
    }),
  );
  dz.addEventListener('drop', (e) => {
    const files = (e as DragEvent).dataTransfer?.files;
    if (files?.length) void addFiles(files);
  });
  // spreči da browser otvori fajl ako se ispusti pored zone
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  $('file-list').addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const rm = t.closest<HTMLElement>('[data-rm]');
    if (rm) return removeFile(Number(rm.dataset.rm));
    const pick = t.closest<HTMLElement>('[data-id]');
    if (pick) {
      state.activeId = Number(pick.dataset.id);
      renderAll();
    }
  });

  $('sel-encoding').addEventListener('change', (e) => {
    const f = active();
    if (!f) return;
    f.encodingSel = (e.target as HTMLSelectElement).value as FileEntry['encodingSel'];
    void loadCsv(f);
  });
  $('sel-delimiter').addEventListener('change', (e) => {
    const f = active();
    if (!f) return;
    f.delimSel = (e.target as HTMLSelectElement).value;
    void loadCsv(f);
  });
  $('sel-sheet').addEventListener('change', (e) => {
    const f = active();
    if (!f) return;
    f.sheetIdx = Number((e.target as HTMLSelectElement).value);
    renderAll();
  });

  let timer = 0;
  const onOption = () => {
    readOptions();
    clearTimeout(timer);
    timer = window.setTimeout(renderAll, 120);
  };
  document.querySelectorAll('#clean input').forEach((el) => {
    el.addEventListener('input', onOption);
    el.addEventListener('change', onOption);
  });

  $('table-wrap').addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.dataset.col === undefined) return;
    const c = Number(t.dataset.col);
    if (t.checked) state.selectedCols.add(c);
    else state.selectedCols.delete(c);
    const f = active();
    if (f) renderPreview(f, currentRows(f), currentStats(f));
  });

  ['x-ext', 'x-enc', 'x-eol'].forEach((id) => $(id).addEventListener('change', updateDownloadLabel));
  $('btn-download').addEventListener('click', () => void doDownload());
  $('btn-all').addEventListener('click', () => void doDownloadAll());
  $('btn-copy').addEventListener('click', () => void doCopy());
  updateDownloadLabel();
}

init();
