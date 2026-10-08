/**
 * Teme: svaka tema ima svetlu i tamnu varijantu. Na <html> se postavljaju
 * data-theme="<id>" i data-scheme="light|dark"; boje su u style.css po tom paru.
 * Režim "system" prati prefers-color-scheme. Početno stanje (bez treptanja)
 * postavlja inline skripta u index.html, sa istim ključem u localStorage.
 */

export type Mode = 'system' | 'light' | 'dark';
export type Scheme = 'light' | 'dark';

/**
 * Nova tema: dodaj je ovde i napiši njene promenljive u style.css.
 * frames: da li rough.js crta ručne okvire (data-rough). Logo, ikone i skica toka se crtaju u svim temama.
 */
export const THEMES = [
  { id: 'sketch', label: 'Skica', frames: true },
  { id: 'clean', label: 'Pregledna', frames: false },
] as const;
export type ThemeId = (typeof THEMES)[number]['id'];

const MODES: { id: Mode; label: string; title: string }[] = [
  { id: 'system', label: 'Sistem', title: 'Prati podešavanje sistema' },
  { id: 'light', label: 'Svetla', title: 'Svetla varijanta' },
  { id: 'dark', label: 'Tamna', title: 'Tamna varijanta' },
];

const KEY = 'csv2tab.theme';
export const THEME_EVENT = 'csv2tab:theme';

interface Pref {
  theme: ThemeId;
  mode: Mode;
}

const media = matchMedia('(prefers-color-scheme: dark)');

function load(): Pref {
  const pref: Pref = { theme: THEMES[0].id, mode: 'system' };
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (THEMES.some((t) => t.id === v?.theme)) pref.theme = v.theme;
    if (MODES.some((m) => m.id === v?.mode)) pref.mode = v.mode;
  } catch {
    /* localStorage nedostupan ili pokvaren */
  }
  return pref;
}

let pref = load();

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(pref));
  } catch {
    /* ništa */
  }
}

/** Da li aktivna tema traži skicirane okvire oko kartica, dugmadi i oznaka. */
export function themeFrames(): boolean {
  return THEMES.find((t) => t.id === pref.theme)?.frames ?? true;
}

export function currentScheme(): Scheme {
  return pref.mode === 'system' ? (media.matches ? 'dark' : 'light') : pref.mode;
}

function apply() {
  const root = document.documentElement;
  const scheme = currentScheme();
  const changed = root.dataset.theme !== pref.theme || root.dataset.scheme !== scheme;
  root.dataset.theme = pref.theme;
  root.dataset.scheme = scheme;
  document.querySelectorAll<HTMLButtonElement>('#theme-mode button').forEach((b) => {
    const on = b.dataset.mode === pref.mode;
    b.setAttribute('aria-pressed', String(on));
    b.classList.toggle('active', on);
  });
  // changed=false: promenjeno je samo dugme (npr. "Sistem" kad sistem već daje istu varijantu)
  document.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: { changed } }));
}

function render(host: HTMLElement) {
  host.textContent = '';
  if (THEMES.length > 1) {
    const sel = document.createElement('select');
    sel.id = 'theme-select';
    sel.setAttribute('aria-label', 'Tema');
    for (const t of THEMES) sel.add(new Option(t.label, t.id, false, t.id === pref.theme));
    sel.addEventListener('change', () => {
      pref.theme = sel.value as ThemeId;
      save();
      apply();
    });
    host.appendChild(sel);
  }
  const group = document.createElement('div');
  group.id = 'theme-mode';
  group.className = 'theme-mode';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Varijanta teme');
  for (const m of MODES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn small';
    b.dataset.mode = m.id;
    b.dataset.rough = 'tag';
    b.title = m.title;
    b.textContent = m.label;
    b.addEventListener('click', () => {
      pref.mode = m.id;
      save();
      apply();
    });
    group.appendChild(b);
  }
  host.appendChild(group);
}

export function initTheme() {
  const host = document.getElementById('theme-picker');
  if (host) render(host);
  apply();
  media.addEventListener('change', () => {
    if (pref.mode === 'system') apply();
  });
}
