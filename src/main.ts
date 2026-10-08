import './fonts';
import './style.css';
import { initSketch, sketchAll } from './sketch';
import { initTheme } from './theme';
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
import { compareParts } from './lib/compare';
import { encodeOutput, type InputEncoding, type OutputEncoding } from './lib/encoding';
import { padRows, parseOds, type OdsSheet } from './lib/ods';
import {
  DEFAULT_EDGE_RULES,
  FIELDS,
  FIELD_LABELS,
  REQUIRED_FIELDS,
  convertRows,
  defaultGrain,
  describeCode,
  describePair,
  edgeLabel,
  parseNumber,
  partsFromTab,
  sanitizeRules,
  type ColumnMapping,
  type ConvertResult,
  type EdgeRule,
  type Field,
  type PartRecord,
} from './lib/parts';
import {
  matchMaterial,
  materialLabel,
  safeFileName,
  searchMaterials,
  suggestFilename,
  type WtCatalog,
  type WtMaterial,
} from './lib/catalog';
import { fitName, readWtTab, writeWtTab, type WtPart } from './lib/wtTab';
import { toTsv, type LineEnding } from './lib/tsv';
import type { WorkerRequest, WorkerResponse } from './worker';

const PREVIEW_ROWS = 500;
const MAX_PREVIEW_COLS = 200;

interface FileEntry {
  id: number;
  name: string;
  kind: 'csv' | 'ods' | 'tab';
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
  // .tab (samo pregled)
  tabParts?: PartRecord[];
  tabWarnings?: string[];
  // konverzija
  mapSel?: ColumnMapping;
  grainMat: Record<string, 0 | 1>;
  wtMat: Record<string, WtMaterial>;
  wtInit?: boolean;
  fname?: string;
  edits: Map<string, Edit>;
  conv?: ConvertResult;
  compare?: { name: string; parts: WtPart[] };
}

type EField = 'dim1' | 'dim2' | 'edge1' | 'edge2' | 'grain' | 'qty' | 'name';
type Edit = Partial<Pick<WtPart, EField>>;
type TabId = 'parts' | 'src' | 'diff';

interface View {
  rec: PartRecord;
  base: PartRecord;
  edited: Set<EField>;
}

const RULES_KEY = 'csv2tab.edgeRules.v1';
function loadRules(): EdgeRule[] {
  try {
    const v = sanitizeRules(JSON.parse(localStorage.getItem(RULES_KEY) ?? 'null'));
    if (v && v.length) return v;
  } catch {
    /* localStorage nedostupan ili pokvaren */
  }
  return DEFAULT_EDGE_RULES.map((r) => ({ ...r }));
}
function saveRules() {
  try {
    localStorage.setItem(RULES_KEY, JSON.stringify(state.rules));
  } catch {
    /* ignoriši */
  }
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const state = {
  files: [] as FileEntry[],
  activeId: -1,
  clean: defaultCleanOptions(),
  onlySelected: false,
  selectedCols: new Set<number>(),
  selectedFor: '' as string, // ključ tabele za koju važi selectedCols
  rules: loadRules(),
  merge: true,
  tab: 'parts' as TabId,
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
    f.conv = undefined;
    f.mapSel = undefined;
    f.edits.clear();
  } else {
    f.error = r.error;
  }
  renderAll();
}

async function addFiles(list: FileList | File[]) {
  for (const file of Array.from(list)) {
    const lower = file.name.toLowerCase();
    const bytes = new Uint8Array(await file.arrayBuffer());
    let kind: FileEntry['kind'] = lower.endsWith('.ods') ? 'ods' : 'csv';
    let tabParts: PartRecord[] | undefined;
    let tabWarnings: string[] | undefined;
    if (lower.endsWith('.tab')) {
      try {
        const r = readWtTab(bytes);
        tabParts = partsFromTab(r.parts);
        tabWarnings = r.warnings;
        kind = 'tab';
      } catch {
        /* nije binarni WT .tab: tretira se kao tekstualni */
      }
    }
    const f: FileEntry = {
      id: nextFileId++,
      name: file.name,
      kind,
      tabParts,
      tabWarnings,
      grainMat: {},
      wtMat: {},
      edits: new Map(),
      size: file.size,
      bytes,
      encodingSel: 'auto',
      delimSel: 'auto',
      sheetIdx: 0,
      loading: kind !== 'tab',
    };
    state.files.push(f);
    state.activeId = f.id;
    state.tab = 'parts';
    renderAll();
    if (kind === 'tab') continue;
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
  document.querySelectorAll<HTMLElement>('.src-only').forEach((e) => (e.hidden = f.kind === 'tab'));
  if (f.kind === 'tab' && state.tab === 'src') state.tab = 'parts';
  if (state.tab === 'diff' && !f.compare) state.tab = 'parts';
  autoMatch(f);
  renderMapping(f);
  renderGrain(f);
  renderWtMaterials(f);
  renderEdgeTable();
  renderWarnings(f, stats);
  renderTabs(f);
  $('panel-parts').hidden = state.tab !== 'parts';
  $('panel-src').hidden = state.tab !== 'src';
  $('panel-diff').hidden = state.tab !== 'diff';
  if (state.tab === 'parts') renderParts(f);
  else if (state.tab === 'src') renderPreview(f, table, stats);
  else renderDiff(f);
  $('btn-all').hidden = !(f.kind === 'ods' && (f.sheets?.length ?? 0) > 1);
  updateDownloadLabel();
}

function renderFileList() {
  const ul = $('file-list');
  ul.hidden = state.files.length === 0;
  ul.innerHTML = state.files
    .map(
      (f) => `<li data-rough="tag" class="${f.id === state.activeId ? 'active' : ''}">
        <button type="button" class="file-pick" data-id="${f.id}">
          <span class="badge">${f.kind.toUpperCase()}</span>
          <span class="fname">${esc(f.name)}</span>
          <span class="muted">${fmtSize(f.size)}</span>
        </button>
        <button type="button" class="file-rm" data-rm="${f.id}" aria-label="Ukloni ${esc(f.name)}">×</button>
      </li>`,
    )
    .join('');
  // aktivna oznaka menja ispunu -> iscrtaj ponovo
  ul.querySelectorAll('li').forEach((li) => li.removeAttribute('data-seed'));
  sketchAll(ul);
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
  if (f.kind === 'tab') return;
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
  for (const w of f.tabWarnings ?? []) items.push(`<li>${esc(w)}</li>`);
  const conv = f.loading ? undefined : getConv(f);
  if (conv) {
    const errs = conv.issues.filter((i) => i.level === 'error');
    const warns = conv.issues.filter((i) => i.level === 'warn');
    for (const i of errs.slice(0, 15)) items.push(`<li class="err">${esc(i.msg)}</li>`);
    if (errs.length > 15) items.push(`<li class="err">… još ${errs.length - 15} grešaka.</li>`);
    for (const i of warns.slice(0, 15)) items.push(`<li>${esc(i.msg)}</li>`);
    if (warns.length > 15) items.push(`<li>… još ${warns.length - 15} upozorenja (vidi znak „!" u tabeli zapisa).</li>`);
  }
  if (s) {
    if (s.rows === 0) items.push('<li>Fajl je prazan.</li>');
    if (s.raggedRows > 0) {
      const sample = s.raggedSample.map((r) => r + 1).join(', ');
      items.push(
        `<li><b class="circled" data-rough="circle">${nf(s.raggedRows)}</b> ${s.raggedRows === 1 ? 'red ima' : 'redova ima'} drugačiji broj kolona od zaglavlja (red ${esc(sample)}${s.raggedRows > s.raggedSample.length ? ', …' : ''}). Možda je pogrešan separator.</li>`,
      );
    }
    if (s.tabNewlineCells > 0)
      items.push(`<li><b class="circled" data-rough="circle">${nf(s.tabNewlineCells)}</b> ćelija sadrži tab ili novi red (uključite zamenu razmakom).</li>`);
    if (s.decimalCommaCells > 0)
      items.push(`<li><b class="circled" data-rough="circle">${nf(s.decimalCommaCells)}</b> ćelija izgleda kao broj sa decimalnim zarezom.</li>`);
    if (s.mojibakeCells > 0)
      items.push(`<li><b class="circled" data-rough="circle">${nf(s.mojibakeCells)}</b> ćelija izgleda kao mojibake (pogrešno kodiranje). Probajte drugo kodiranje ili uključite „Popravi mojibake".</li>`);
    const other = s.suspiciousCells - s.mojibakeCells;
    if (other > 0)
      items.push(`<li><b class="circled" data-rough="circle">${nf(other)}</b> ćelija sadrži sumnjive znakove (BOM, nerazdvojivi razmak ili zamenski znak).</li>`);
  }
  $('warnings-card').hidden = items.length === 0;
  $('warnings').innerHTML = items
    .map((li) => li.replace(/^<li( class="err")?>/, (_m, c) => `<li${c ?? ''}><svg class="icon" data-icon="warn" width="28" height="28" viewBox="0 0 28 28"></svg><span>`).replace(/<\/li>$/, '</span></li>'))
    .join('');
  sketchAll($('warnings'));
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
  const f = active();
  const multi = (f && getConv(f)?.materials.length) ?? 0;
  ($('x-mode') as HTMLSelectElement).disabled = multi < 2;
  if (multi < 2) ($('x-mode') as HTMLSelectElement).value = 'all';
}

// ---------- konverzija: zapisi ----------
function getConv(f: FileEntry): ConvertResult | undefined {
  if (f.kind === 'tab') return undefined;
  if (!f.conv) {
    const rows = currentRows(f);
    if (!rows) return undefined;
    f.conv = convertRows(rows, { rules: state.rules, grainByMaterial: f.grainMat, merge: state.merge }, f.mapSel);
  }
  return f.conv;
}

function invalidateAll() {
  for (const f of state.files) f.conv = undefined;
}

const EFIELDS: EField[] = ['dim1', 'dim2', 'edge1', 'edge2', 'grain', 'qty', 'name'];

function makeView(base: PartRecord, edit: Edit | undefined): View {
  const rec: PartRecord = { ...base };
  const edited = new Set<EField>();
  if (edit) {
    for (const k of EFIELDS) {
      const v = edit[k];
      if (v !== undefined && v !== base[k]) {
        (rec as unknown as Record<string, unknown>)[k] = v;
        edited.add(k);
      }
    }
  }
  return { rec, base, edited };
}

function baseRecords(f: FileEntry): PartRecord[] {
  return f.kind === 'tab' ? (f.tabParts ?? []) : (getConv(f)?.parts ?? []);
}

function viewsOf(f: FileEntry): View[] {
  return baseRecords(f).map((b) => makeView(b, f.edits.get(b.key)));
}

function setEdit(f: FileEntry, v: View, field: EField, value: number | string) {
  const key = v.base.key;
  const e: Edit = { ...(f.edits.get(key) ?? {}) };
  if (value === v.base[field]) delete e[field];
  else (e as Record<string, unknown>)[field] = value;
  if (Object.keys(e).length) f.edits.set(key, e);
  else f.edits.delete(key);
}

let shownFile: FileEntry | undefined;
let shownViews: View[] = [];

const colLetters = (c: number) => colName(c);

function renderTabs(f: FileEntry) {
  const n = baseRecords(f).length;
  const tabs: [TabId, string][] = [['parts', `Zapisi (${n})`]];
  if (f.kind !== 'tab') tabs.push(['src', 'Izvor']);
  if (f.compare) tabs.push(['diff', 'Poređenje']);
  $('tabs').innerHTML = tabs
    .map(([id, label]) => `<button type="button" class="tab${state.tab === id ? ' active' : ''}" data-tab="${id}" data-rough="chip">${label}</button>`)
    .join('');
  sketchAll($('tabs'));
}

function renderMapping(f: FileEntry) {
  const box = $('mapping');
  const conv = getConv(f);
  if (!conv || f.loading) {
    box.innerHTML = '';
    return;
  }
  if (conv.headerless) {
    box.innerHTML = '<p class="muted">Nema zaglavlja: uzet je podrazumevani raspored kolona.</p>';
    return;
  }
  const rows = currentRows(f) ?? [];
  const header = rows[0] ?? [];
  const opts = (sel: number) =>
    `<option value="-1"${sel < 0 ? ' selected' : ''}>— nema —</option>` +
    header
      .map((h, i) => `<option value="${i}"${sel === i ? ' selected' : ''}>${colLetters(i)}: ${esc(h.replace(/^﻿/, '').slice(0, 30))}</option>`)
      .join('');
  const unknown = REQUIRED_FIELDS.some((r) => conv.mapping[r] < 0);
  box.innerHTML =
    `<p class="muted" style="margin:10px 0 0">Mapiranje kolona po nazivu zaglavlja${unknown ? ' — <b class="err">neke obavezne kolone nisu prepoznate</b>' : ''}:</p>` +
    '<div class="map-grid">' +
    FIELDS.map((fl) => `<label>${FIELD_LABELS[fl]}${REQUIRED_FIELDS.includes(fl) ? ' *' : ''}<select data-map="${fl}">${opts(conv.mapping[fl])}</select></label>`).join('') +
    '</div>';
}

function renderGrain(f: FileEntry) {
  const conv = getConv(f);
  const box = $('grain-list');
  if (!conv) {
    box.innerHTML = '';
    return;
  }
  box.innerHTML =
    conv.materials
      .map((m) => {
        const n = conv.pieces.filter((p) => p.material === m).length;
        const on = (f.grainMat[m] ?? defaultGrain(m)) === 1;
        return `<label><input type="checkbox" data-mat="${esc(m)}" ${on ? 'checked' : ''} /> Prati teksturu: <b>${esc(m || '(bez materijala)')}</b> <span class="muted">(${n} ${n === 1 ? 'red' : 'redova'})</span></label>`;
      })
      .join('') || '<span class="muted">—</span>';
}

function renderEdgeTable() {
  const rows = state.rules
    .map(
      (r, i) =>
        `<tr data-r="${i}"><td><input type="text" data-k="a" value="${String(r.a).replace('.', ',')}" aria-label="debljina 1 (mm)" /></td><td>+</td><td><input type="text" data-k="b" value="${String(r.b).replace('.', ',')}" aria-label="debljina 2 (mm)" /></td><td>mm →</td><td><select data-k="code">${codeOptions(r.code)}</select></td><td><button type="button" class="x" data-del="${i}" aria-label="Obriši red">×</button></td></tr>`,
    )
    .join('');
  $('edge-table').innerHTML = `<table class="edge-table"><tbody>${rows}</tbody></table>`;
  fitConvertCard();
}

/** Otvorena tabela kantova ne staje u karticu 3: kartica se privremeno širi preko susedne, raspored se ne menja. */
function fitConvertCard() {
  const card = $('convert');
  card.classList.remove('overlay');
  card.style.width = card.style.marginLeft = '';
  const wrap = $('edge-table');
  if (!($('edge-details') as HTMLDetailsElement).open || card.hidden) return;
  const extra = wrap.scrollWidth - wrap.clientWidth;
  if (extra <= 0) return;
  const grid = card.parentElement!.getBoundingClientRect();
  const cell = card.getBoundingClientRect();
  const w = Math.min(cell.width + extra + 2, grid.width);
  if (w <= cell.width) return;
  card.style.width = `${w}px`;
  if (cell.left + w > grid.right) card.style.marginLeft = `${grid.right - w - cell.left}px`; // poslednja kolona: širi se ulevo
  card.classList.add('overlay');
}

function codeOptions(code: number): string {
  const codes = new Set<number>([0, 1, 2, 3, 4, 5, code]);
  return [...codes]
    .sort((a, b) => a - b)
    .map((c) => `<option value="${c}"${c === code ? ' selected' : ''}>${c} = ${esc(edgeLabel(c))}</option>`)
    .join('');
}

function edgeDesc(v: View, which: 1 | 2): string {
  const code = which === 1 ? v.rec.edge1 : v.rec.edge2;
  const baseCode = which === 1 ? v.base.edge1 : v.base.edge2;
  const th = which === 1 ? v.base.thick1 : v.base.thick2;
  if (th && code === baseCode) return describePair(th[0], th[1]);
  return describeCode(state.rules, code);
}

function partRow(v: View, i: number): string {
  const r = v.rec;
  const ed = (f: EField) => (v.edited.has(f) ? ' edited' : '');
  const sel = (which: 1 | 2) => {
    const f = which === 1 ? 'edge1' : 'edge2';
    return `<td class="edit${ed(f)}" data-f="${f}"><select data-f="${f}" aria-label="Kant ${which === 1 ? 'dužina' : 'širina'}">${codeOptionsShort(which === 1 ? r.edge1 : r.edge2)}</select><span class="edesc">${esc(edgeDesc(v, which))}</span></td>`;
  };
  const warn = r.issues.length ? `<span class="warnmark" title="${esc(r.issues.join('\n'))}">!</span>` : '';
  const tip = r.srcRows.length ? `Izvorni redovi: ${r.srcRows.join(', ')}` : '';
  return (
    `<tr data-i="${i}" class="${r.issues.length ? 'has-warn' : ''}">` +
    `<td class="rn" title="${esc(tip)}">${i + 1}</td>` +
    `<td class="edit${ed('dim1')}" data-f="dim1"><input class="num" type="number" min="0" step="1" value="${r.dim1}" aria-label="Dužina (mm)" /></td>` +
    `<td><button type="button" class="swap" data-swap="1" title="Zameni dimenzije (i kantove)">⇄</button></td>` +
    `<td class="edit${ed('dim2')}" data-f="dim2"><input class="num" type="number" min="0" step="1" value="${r.dim2}" aria-label="Širina (mm)" /></td>` +
    sel(1) +
    sel(2) +
    `<td class="edit${ed('grain')}" data-f="grain"><input type="checkbox" ${r.grain ? 'checked' : ''} aria-label="Prati teksturu" /></td>` +
    `<td class="edit${ed('qty')}" data-f="qty"><input class="qty" type="number" min="0" max="65535" step="1" value="${r.qty}" aria-label="Kom" /></td>` +
    `<td class="edit${ed('name')}" data-f="name"><input class="name" type="text" maxlength="25" value="${esc(r.name)}" aria-label="Oznaka" /></td>` +
    `<td class="mat">${esc(r.material)}</td>` +
    `<td>${warn}</td></tr>`
  );
}

function codeOptionsShort(code: number): string {
  const codes = new Set<number>([0, 1, 2, 3, 4, 5, code]);
  return [...codes]
    .sort((a, b) => a - b)
    .map((c) => `<option value="${c}"${c === code ? ' selected' : ''}>${c}: ${esc(edgeLabel(c))}</option>`)
    .join('');
}

const PARTS_MAX = 3000;

function renderParts(f: FileEntry) {
  const el = $('panel-parts');
  shownFile = f;
  shownViews = f.loading ? [] : viewsOf(f);
  if (f.loading) {
    el.innerHTML = '<p class="muted">Učitavam…</p>';
    return;
  }
  if (!shownViews.length) {
    el.innerHTML = '<p class="muted">Nema zapisa za prikaz.</p>';
    return;
  }
  const head =
    '<thead><tr><th class="rn">RB.</th><th>Dužina</th><th></th><th>Širina</th><th>Kant uz dužinu</th><th>Kant uz širinu</th><th>Prati teksturu</th><th>Kom</th><th>Oznaka</th><th>Materijal</th><th></th></tr></thead>';
  const body = shownViews.slice(0, PARTS_MAX).map(partRow).join('');
  el.innerHTML =
    '<p id="parts-sum" class="sum"></p>' +
    `<div class="table-wrap"><table class="grid-table parts-table">${head}<tbody>${body}</tbody></table></div>` +
    (shownViews.length > PARTS_MAX ? `<p class="muted">Prikazano prvih ${PARTS_MAX} zapisa (izvoz sadrži sve).</p>` : '');
  updatePartsSummary();
}

function updatePartsSummary() {
  const el = document.getElementById('parts-sum');
  if (!el || !shownFile) return;
  const qty = shownViews.reduce((s, v) => s + v.rec.qty, 0);
  const edited = shownViews.reduce((s, v) => s + v.edited.size, 0);
  const warn = shownViews.filter((v) => v.rec.issues.length).length;
  const conv = getConv(shownFile);
  const src = conv ? `, iz ${conv.pieces.length} izvornih redova` : '';
  el.innerHTML =
    `<b>${shownViews.length}</b> zapisa, ukupno <b>${qty}</b> kom${src}.` +
    (edited ? ` Ručno izmenjeno ćelija: <mark class="mk">${edited}</mark> <button type="button" class="btn small" id="reset-edits" data-rough="btn">Poništi izmene</button>` : '') +
    (warn ? ` Zapisa sa upozorenjem: <b class="err">${warn}</b>.` : '');
  sketchAll(el);
}

function refreshRow(tr: HTMLTableRowElement, v: View) {
  const r = v.rec;
  const set = (f: EField, val: string | number | boolean) => {
    const td = tr.querySelector<HTMLElement>(`td[data-f="${f}"]`);
    if (!td) return;
    td.classList.toggle('edited', v.edited.has(f));
    const inp = td.querySelector<HTMLInputElement | HTMLSelectElement>('input,select');
    if (!inp || inp === document.activeElement) return;
    if (inp instanceof HTMLInputElement && inp.type === 'checkbox') inp.checked = Boolean(val);
    else if (inp instanceof HTMLSelectElement) {
      if (![...inp.options].some((o) => o.value === String(val))) inp.innerHTML = codeOptionsShort(Number(val));
      inp.value = String(val);
    } else inp.value = String(val);
  };
  set('dim1', r.dim1);
  set('dim2', r.dim2);
  set('edge1', r.edge1);
  set('edge2', r.edge2);
  set('grain', r.grain);
  set('qty', r.qty);
  set('name', r.name);
  const d1 = tr.querySelector('td[data-f="edge1"] .edesc');
  const d2 = tr.querySelector('td[data-f="edge2"] .edesc');
  if (d1) d1.textContent = edgeDesc(v, 1);
  if (d2) d2.textContent = edgeDesc(v, 2);
  updatePartsSummary();
}

function onPartEdit(target: HTMLElement) {
  const f = shownFile;
  const tr = target.closest<HTMLTableRowElement>('tr[data-i]');
  const td = target.closest<HTMLElement>('td[data-f]');
  if (!f || !tr || !td) return;
  const i = Number(tr.dataset.i);
  const v = shownViews[i];
  const field = td.dataset.f as EField;
  const inp = target as HTMLInputElement;
  let value: number | string;
  if (field === 'name') value = fitName(inp.value).name;
  else if (inp.type === 'checkbox') value = inp.checked ? 1 : 0;
  else {
    const n = Math.round(Number(inp.value));
    const max = field === 'qty' ? 65535 : field === 'edge1' || field === 'edge2' ? 255 : 4294967295;
    if (inp.value === '' || Number.isNaN(n) || n < 0 || n > max) {
      refreshRow(tr, v);
      inp.value = String(v.rec[field]);
      return;
    }
    value = n;
  }
  setEdit(f, v, field, value);
  shownViews[i] = makeView(v.base, f.edits.get(v.base.key));
  refreshRow(tr, shownViews[i]);
  if (field === 'name') inp.value = String(value);
}

function onSwap(btn: HTMLElement) {
  const f = shownFile;
  const tr = btn.closest<HTMLTableRowElement>('tr[data-i]');
  if (!f || !tr) return;
  const i = Number(tr.dataset.i);
  const v = shownViews[i];
  const r = v.rec;
  setEdit(f, v, 'dim1', r.dim2);
  let nv = makeView(v.base, f.edits.get(v.base.key));
  setEdit(f, nv, 'dim2', r.dim1);
  nv = makeView(v.base, f.edits.get(v.base.key));
  setEdit(f, nv, 'edge1', r.edge2);
  nv = makeView(v.base, f.edits.get(v.base.key));
  setEdit(f, nv, 'edge2', r.edge1);
  shownViews[i] = makeView(v.base, f.edits.get(v.base.key));
  refreshRow(tr, shownViews[i]);
}

// ---------- poređenje ----------
function renderDiff(f: FileEntry) {
  const el = $('panel-diff');
  if (!f.compare) {
    el.innerHTML = '';
    return;
  }
  const mine = viewsOf(f).map((v) => v.rec);
  const rows = compareParts(mine, f.compare.parts);
  const cnt = { same: 0, changed: 0, onlyA: 0, onlyB: 0 };
  rows.forEach((r) => cnt[r.status]++);
  const fmt = (p?: WtPart) =>
    p
      ? `<td>${p.dim1} × ${p.dim2}</td><td>${p.edge1} / ${p.edge2}</td><td>${p.grain ? 'da' : 'ne'}</td><td>${p.qty}</td><td>${esc(p.name)}</td>`
      : '<td colspan="5" class="muted">—</td>';
  const label: Record<string, string> = { same: '✓', changed: '≠', onlyA: '＋ samo ovde', onlyB: '− samo u .tab' };
  el.innerHTML =
    `<p class="sum">Poređenje sa <b>${esc(f.compare.name)}</b> (${f.compare.parts.length} zapisa): ` +
    `<b>${cnt.same}</b> isto, <mark class="mk">${cnt.changed}</mark> različito, ${cnt.onlyA} samo u trenutnim zapisima, ${cnt.onlyB} samo u .tab fajlu. ` +
    `<button type="button" class="btn small" id="cmp-close" data-rough="btn">Zatvori poređenje</button></p>` +
    '<div class="table-wrap"><table class="grid-table diff-table"><thead><tr><th></th><th colspan="5">Trenutni zapisi</th><th colspan="5">Postojeći .tab</th><th>Razlike</th></tr>' +
    '<tr><th></th><th>Dim.</th><th>Kant</th><th>Tekst.</th><th>Kom</th><th>Oznaka</th><th>Dim.</th><th>Kant</th><th>Tekst.</th><th>Kom</th><th>Oznaka</th><th></th></tr></thead><tbody>' +
    rows
      .map((r) => `<tr class="${r.status}"><td>${label[r.status]}</td>${fmt(r.a)}${fmt(r.b)}<td class="d">${esc(r.diffs.join('; '))}</td></tr>`)
      .join('') +
    '</tbody></table></div>';
  sketchAll(el);
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

function setStatus(msg: string, isErr = false, id = 'tsv-status') {
  const el = $(id);
  el.textContent = msg;
  el.classList.toggle('err', isErr);
}

// ---------- WT katalog materijala ----------
let catalog: WtCatalog | undefined;
let bandCode = '';

async function loadCatalog() {
  const m = await import('./data/wt-catalog.json');
  catalog = (m.default ?? m) as unknown as WtCatalog;
  $('wt-mats').innerHTML = catalog.materials.map((x) => `<option value="${esc(materialLabel(x))}"></option>`).join('');
  $<HTMLSelectElement>('wt-band').innerHTML =
    '<option value="">— bez trake u imenu —</option>' + catalog.edgeBands.map((b) => `<option value="${esc(b.code)}">${esc(b.name)} (${esc(b.code)})</option>`).join('');
  renderAll();
}

function currentBand() {
  return catalog?.edgeBands.find((b) => b.code === bandCode);
}

/** Automatski izbor WT materijala za svaki materijal iz fajla (i smer vlakna iz kataloga). */
function autoMatch(f: FileEntry) {
  if (!catalog || f.kind === 'tab' || f.wtInit) return;
  const conv = getConv(f);
  if (!conv || f.loading) return;
  f.wtInit = true;
  let changed = false;
  for (const m of conv.materials) {
    if (m === '') continue;
    const hit = matchMaterial(catalog, m);
    if (!hit) continue;
    f.wtMat[m] = hit;
    if (f.grainMat[m] === undefined) {
      f.grainMat[m] = hit.grain ? 1 : 0;
      changed = true;
    }
  }
  if (changed) f.conv = undefined;
}

function renderWtMaterials(f: FileEntry) {
  const box = $('wt-mat-rows');
  const conv = getConv(f);
  if (!conv || !catalog) {
    box.innerHTML = catalog ? '' : '<span class="muted">Učitavam katalog…</span>';
    return;
  }
  const focused = document.activeElement?.id;
  box.innerHTML = conv.materials
    .map((m, i) => {
      const w = f.wtMat[m];
      return `<label>${esc(m || '(bez materijala)')} → WT materijal<input type="text" list="wt-mats" data-wtmat="${esc(m)}" id="wt-m-${i}" value="${w ? esc(materialLabel(w)) : ''}" placeholder="šifra ili naziv…" autocomplete="off" /></label>`;
    })
    .join('');
  if (focused?.startsWith('wt-m-')) document.getElementById(focused)?.focus();
  $<HTMLSelectElement>('wt-band').value = bandCode;
  const fn = $<HTMLInputElement>('x-fname');
  if (document.activeElement !== fn) fn.value = f.fname ?? defaultFileBase(f);
}

function defaultFileBase(f: FileEntry): string {
  const conv = getConv(f);
  const first = conv?.materials.map((m) => f.wtMat[m]).find((w): w is WtMaterial => !!w);
  if (first) return suggestFilename(first, currentBand());
  return baseName(f.name) + (f.kind === 'ods' && (f.sheets?.length ?? 0) > 1 ? '_' + safeName(f.sheets![f.sheetIdx].name) : '');
}

function onWtMatChange(inp: HTMLInputElement) {
  const f = active();
  if (!f || !catalog || inp.dataset.wtmat === undefined) return;
  const m = inp.dataset.wtmat;
  const v = inp.value.trim();
  if (!v) delete f.wtMat[m];
  else {
    const hit = catalog.materials.find((x) => materialLabel(x) === v) ?? searchMaterials(catalog, v, 1)[0];
    if (hit) {
      f.wtMat[m] = hit;
      f.grainMat[m] = hit.grain ? 1 : 0;
      f.conv = undefined;
    }
  }
  renderAll();
}

function doExportTab() {
  const f = active();
  if (!f || f.loading) return;
  const recs = viewsOf(f).map((v) => v.rec);
  if (!recs.length) return setStatus('Nema zapisa za izvoz.', true, 'export-status');
  const base = safeFileName($<HTMLInputElement>('x-fname').value.replace(/\.tab$/i, '')) || defaultFileBase(f);
  const mode = ($('x-mode') as HTMLSelectElement).value;
    const bad = recs.filter((r) => r.dim1 <= 0 || r.dim2 <= 0 || r.qty <= 0).length;
  const note = bad ? ` Pažnja: ${bad} zapisa ima dimenziju ili količinu 0.` : '';
  try {
    if (mode === 'per') {
      const groups = new Map<string, PartRecord[]>();
      for (const r of recs) groups.set(r.material, [...(groups.get(r.material) ?? []), r]);
      const files: Record<string, Uint8Array> = {};
      for (const [m, list] of groups) {
        const w = f.wtMat[m];
        const stem = safeFileName(w ? suggestFilename(w, currentBand()) : m || base) || 'zapisi';
        let n = `${stem}.tab`;
        for (let i = 2; files[n]; i++) n = `${stem}_${i}.tab`;
        files[n] = writeWtTab(list);
      }
      const zip = zipSync(files, { level: 6 });
      download(`${base}_tab.zip`, zip, 'application/zip');
      return setStatus(`Preuzeto: ${base}_tab.zip (${groups.size} .tab fajlova).${note}`, bad > 0, 'export-status');
    }
    const bytes = writeWtTab(recs);
    download(`${base}.tab`, bytes, 'application/octet-stream');
    setStatus(`Preuzeto: ${base}.tab (${recs.length} zapisa, ${fmtSize(bytes.length)}).${note}`, bad > 0, 'export-status');
  } catch (err) {
    setStatus(err instanceof Error ? err.message : String(err), true, 'export-status');
  }
}

async function loadCompare(file: File) {
  const f = active();
  if (!f) return;
  try {
    const r = readWtTab(new Uint8Array(await file.arrayBuffer()));
    f.compare = { name: file.name, parts: r.parts };
    state.tab = 'diff';
    renderAll();
  } catch (err) {
    setStatus(err instanceof Error ? err.message : String(err), true, 'export-status');
  }
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
    f.conv = undefined;
    f.mapSel = undefined;
    f.wtInit = false;
    f.wtMat = {};
    f.grainMat = {};
    f.edits.clear();
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

  $('tabs').addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-tab]');
    if (!t) return;
    state.tab = t.dataset.tab as TabId;
    renderAll();
  });
  const pp = $('panel-parts');
  pp.addEventListener('change', (e) => onPartEdit(e.target as HTMLElement));
  pp.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const sw = t.closest<HTMLElement>('[data-swap]');
    if (sw) return onSwap(sw);
    if (t.closest('#reset-edits')) {
      active()?.edits.clear();
      renderAll();
    }
  });
  $('panel-diff').addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('#cmp-close')) {
      const f = active();
      if (f) f.compare = undefined;
      state.tab = 'parts';
      renderAll();
    }
  });
  $('mapping').addEventListener('change', (e) => {
    const t = e.target as HTMLSelectElement;
    const f = active();
    const conv = f && getConv(f);
    if (!f || !conv || !t.dataset.map) return;
    f.mapSel = { ...conv.mapping, [t.dataset.map as Field]: Number(t.value) };
    f.conv = undefined;
    f.edits.clear();
    renderAll();
  });
  $('grain-list').addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    const f = active();
    if (!f || t.dataset.mat === undefined) return;
    f.grainMat[t.dataset.mat] = t.checked ? 1 : 0;
    f.conv = undefined;
    renderAll();
  });
  $<HTMLInputElement>('c-merge').addEventListener('change', (e) => {
    state.merge = (e.target as HTMLInputElement).checked;
    invalidateAll();
    state.files.forEach((f) => f.edits.clear());
    renderAll();
  });
  const rulesChanged = () => {
    saveRules();
    invalidateAll();
    renderAll();
  };
  $('edge-table').addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement | HTMLSelectElement;
    const tr = t.closest<HTMLElement>('tr[data-r]');
    const k = t.dataset.k;
    if (!tr || !k) return;
    const r = state.rules[Number(tr.dataset.r)];
    if (k === 'code') r.code = Number(t.value);
    else {
      const n = parseNumber(t.value);
      if (Number.isNaN(n) || n < 0) return renderEdgeTable();
      (r as unknown as Record<string, number>)[k] = n;
    }
    rulesChanged();
  });
  $('edge-details').addEventListener('toggle', fitConvertCard);
  window.addEventListener('resize', fitConvertCard);
  $('edge-table').addEventListener('click', (e) => {
    const d = (e.target as HTMLElement).closest<HTMLElement>('[data-del]');
    if (!d) return;
    state.rules.splice(Number(d.dataset.del), 1);
    rulesChanged();
  });
  $('edge-add').addEventListener('click', () => {
    state.rules.push({ a: 0, b: 0, code: 0 });
    rulesChanged();
  });
  $('edge-reset').addEventListener('click', () => {
    state.rules = DEFAULT_EDGE_RULES.map((r) => ({ ...r }));
    rulesChanged();
  });
  $('btn-tab').addEventListener('click', doExportTab);
  $('wt-mat-rows').addEventListener('change', (e) => onWtMatChange(e.target as HTMLInputElement));
  $('wt-band').addEventListener('change', (e) => {
    bandCode = (e.target as HTMLSelectElement).value;
    renderAll();
  });
  $<HTMLInputElement>('x-fname').addEventListener('input', (e) => {
    const f = active();
    if (f) f.fname = (e.target as HTMLInputElement).value;
  });
  void loadCatalog();
  $('btn-cmp').addEventListener('click', () => $<HTMLInputElement>('cmp-input').click());
  $<HTMLInputElement>('cmp-input').addEventListener('change', (e) => {
    const inp = e.target as HTMLInputElement;
    if (inp.files?.[0]) void loadCompare(inp.files[0]);
    inp.value = '';
  });

  ['x-ext', 'x-enc', 'x-eol'].forEach((id) => $(id).addEventListener('change', updateDownloadLabel));
  $('btn-download').addEventListener('click', () => void doDownload());
  $('btn-all').addEventListener('click', () => void doDownloadAll());
  $('btn-copy').addEventListener('click', () => void doCopy());
  updateDownloadLabel();
}

init();
initTheme();
initSketch();
