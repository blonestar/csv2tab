import rough from 'roughjs';

/**
 * "Sketch" sloj: rough.js crta ručne okvire iza elemenata sa data-rough atributom
 * i ikone/strelice u elementima sa data-icon. Sve se iscrtava u SVG-u koji je
 * apsolutno pozicioniran iza sadržaja, pa ne utiče na raspored.
 */

const SVGNS = 'http://www.w3.org/2000/svg';
type Kind = 'box' | 'btn' | 'drop' | 'chip' | 'circle' | 'tag';

const observers = new WeakMap<Element, ResizeObserver>();
const drawn = new WeakSet<Element>();

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#333';
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) % 10000 || 1;
}

let uid = 0;
function seedFor(el: Element): number {
  const e = el as HTMLElement;
  if (!e.dataset.seed) e.dataset.seed = String(hash(`${e.className}${e.id}${uid++}`));
  return Number(e.dataset.seed);
}

function prepare(svg: SVGElement) {
  // pathLength=1 omogućava "crtanje" linije bez merenja dužine
  svg.querySelectorAll('path').forEach((p) => p.setAttribute('pathLength', '1'));
}

function getSvg(el: HTMLElement, w: number, h: number, padX: number, padY: number): SVGSVGElement {
  let svg = el.querySelector<SVGSVGElement>(':scope > svg.rough');
  if (!svg) {
    svg = document.createElementNS(SVGNS, 'svg') as SVGSVGElement;
    svg.setAttribute('class', 'rough');
    svg.setAttribute('aria-hidden', 'true');
    el.insertBefore(svg, el.firstChild);
  }
  svg.style.left = `${-padX}px`;
  svg.style.top = `${-padY}px`;
  svg.setAttribute('width', String(w + padX * 2));
  svg.setAttribute('height', String(h + padY * 2));
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  return svg;
}

function draw(el: HTMLElement) {
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  if (!w || !h) return;
  const kind = (el.dataset.rough || 'box') as Kind;
  const ink = cssVar('--line');
  const seed = seedFor(el);
  const pad = kind === 'circle' ? [8, 5] : [2, 2];
  const svg = getSvg(el, w, h, pad[0], pad[1]);
  const rc = rough.svg(svg);
  const ox = pad[0];
  const oy = pad[1];
  const nodes: SVGElement[] = [];

  switch (kind) {
    case 'box':
      nodes.push(
        rc.rectangle(ox + 2, oy + 2, w - 4, h - 4, {
          stroke: ink, strokeWidth: 1.5, roughness: 1.5, bowing: 2, seed,
        }),
      );
      break;
    case 'drop':
      nodes.push(
        rc.rectangle(ox + 3, oy + 3, w - 6, h - 6, {
          stroke: ink, strokeWidth: 1.7, roughness: 1.6, bowing: 2.5, seed, strokeLineDash: [10, 7],
        }),
      );
      break;
    case 'btn': {
      const primary = el.classList.contains('primary');
      nodes.push(
        rc.rectangle(ox + 2, oy + 2, w - 4, h - 4, {
          stroke: ink, strokeWidth: 1.6, roughness: 1.3, bowing: 1.5, seed,
          ...(primary
            ? { fill: cssVar('--hatch'), fillStyle: 'hachure', fillWeight: 2.2, hachureGap: 5, hachureAngle: -35 }
            : {}),
        }),
      );
      break;
    }
    case 'chip':
    case 'tag':
      nodes.push(
        rc.rectangle(ox + 1, oy + 1, w - 2, h - 2, {
          stroke: ink, strokeWidth: 1.1, roughness: 1.2, seed,
          ...(el.classList.contains('active') ? { fill: cssVar('--marker'), fillStyle: 'solid' } : {}),
        }),
      );
      break;
    case 'circle':
      nodes.push(
        rc.ellipse(ox + w / 2, oy + h / 2, w + 10, h + 6, {
          stroke: cssVar('--red'), strokeWidth: 1.8, roughness: 1.8, bowing: 3, seed,
        }),
      );
      break;
  }
  nodes.forEach((n) => svg.appendChild(n));
  prepare(svg);
  if (kind === 'drop') svg.classList.add('dashed');
  if (!drawn.has(el)) {
    drawn.add(el);
    svg.classList.add('draw');
    setTimeout(() => svg.classList.remove('draw'), 1600); // kasniji redraw (resize) ne sme da ponovo animira
  }
}

/** Registruje elemente (i nove, dinamički dodate) za crtanje okvira. */
export function sketchAll(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>('[data-rough]').forEach((el) => {
    if (observers.has(el)) return;
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => draw(el));
    });
    ro.observe(el);
    observers.set(el, ro);
    draw(el);
  });
  root.querySelectorAll<SVGSVGElement>('svg[data-icon]').forEach(drawIcon);
}

function redrawEverything() {
  document.querySelectorAll<HTMLElement>('[data-rough]').forEach(draw);
  document.querySelectorAll<SVGSVGElement>('svg[data-icon]').forEach(drawIcon);
  const flow = document.getElementById('flow');
  if (flow) drawFlow(flow as unknown as SVGSVGElement);
}

// ---------- ikone ----------
function filePage(rc: ReturnType<typeof rough.svg>, svg: SVGElement, x: number, y: number, w: number, h: number, label: string, seed: number, accent: string) {
  const ink = cssVar('--line');
  const fold = 22;
  const g = document.createElementNS(SVGNS, 'g');
  g.appendChild(
    rc.path(`M ${x} ${y} L ${x + w - fold} ${y} L ${x + w} ${y + fold} L ${x + w} ${y + h} L ${x} ${y + h} Z`, {
      stroke: ink, strokeWidth: 1.8, roughness: 1.4, bowing: 1.5, seed,
      fill: cssVar('--paper-hi'), fillStyle: 'solid',
    }),
  );
  g.appendChild(rc.path(`M ${x + w - fold} ${y} L ${x + w - fold} ${y + fold} L ${x + w} ${y + fold}`, { stroke: ink, strokeWidth: 1.4, roughness: 1, seed }));
  // "ispisane" linije
  for (let i = 0; i < 3; i++) {
    const ly = y + h - 46 + i * 11;
    g.appendChild(rc.line(x + 10, ly, x + w - 10 - (i === 2 ? 14 : 0), ly, { stroke: ink, strokeWidth: 1, roughness: 1.6, seed: seed + i }));
  }
  // marker oznaka formata
  g.appendChild(
    rc.rectangle(x + 8, y + 26, w - 24, 22, {
      stroke: 'none', fill: accent, fillStyle: 'hachure', fillWeight: 3.5, hachureGap: 5, hachureAngle: -20, seed,
    }),
  );
  svg.appendChild(g);
  const t = document.createElementNS(SVGNS, 'text');
  t.setAttribute('x', String(x + w / 2 - 8));
  t.setAttribute('y', String(y + 44));
  t.setAttribute('text-anchor', 'middle');
  t.setAttribute('class', 'flow-label');
  t.textContent = label;
  svg.appendChild(t);
}

function arrow(rc: ReturnType<typeof rough.svg>, svg: SVGElement, x1: number, y1: number, x2: number, y2: number, seed: number) {
  const ink = cssVar('--red');
  const o = { stroke: ink, strokeWidth: 2.4, roughness: 1.8, bowing: 3, seed };
  const g = document.createElementNS(SVGNS, 'g');
  g.appendChild(rc.curve([[x1, y1], [(x1 + x2) / 2, y1 - 14], [x2, y2]], o));
  g.appendChild(rc.line(x2, y2, x2 - 15, y2 - 12, o));
  g.appendChild(rc.line(x2, y2, x2 - 17, y2 + 9, o));
  svg.appendChild(g);
}

export function drawFlow(svg: SVGSVGElement) {
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  const rc = rough.svg(svg);
  filePage(rc, svg, 20, 18, 90, 118, 'CSV', 11, cssVar('--marker'));
  filePage(rc, svg, 128, 30, 90, 118, 'ODS', 23, cssVar('--blue'));
  arrow(rc, svg, 240, 82, 360, 86, 5);
  filePage(rc, svg, 390, 22, 100, 126, 'TAB', 37, cssVar('--green'));
  // sitni crtež tabele pored TAB-a
  const ink = cssVar('--line');
  for (let i = 0; i < 4; i++)
    svg.appendChild(rc.line(520, 40 + i * 22, 620, 40 + i * 22, { stroke: ink, strokeWidth: 1.2, roughness: 1.5, seed: 70 + i }));
  for (let i = 0; i < 4; i++)
    svg.appendChild(rc.line(520 + i * 33, 40, 520 + i * 33, 106, { stroke: ink, strokeWidth: 1.2, roughness: 1.5, seed: 90 + i }));
  const note = document.createElementNS(SVGNS, 'text');
  note.setAttribute('x', '300');
  note.setAttribute('y', '58');
  note.setAttribute('text-anchor', 'middle');
  note.setAttribute('class', 'flow-note');
  note.textContent = 'u browseru';
  svg.appendChild(note);
  prepare(svg);
  svg.classList.add('draw');
}

function drawIcon(svg: SVGSVGElement) {
  const kind = svg.dataset.icon;
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  const rc = rough.svg(svg);
  const seed = seedFor(svg as unknown as HTMLElement);
  if (kind === 'warn') {
    const red = cssVar('--red');
    svg.appendChild(rc.circle(14, 14, 22, { stroke: red, strokeWidth: 1.8, roughness: 1.6, seed }));
    svg.appendChild(rc.line(14, 7, 14, 15, { stroke: red, strokeWidth: 2.4, roughness: 1, seed }));
    svg.appendChild(rc.circle(14, 20, 1.6, { stroke: red, fill: red, fillStyle: 'solid', strokeWidth: 1, roughness: 0.5, seed }));
  } else if (kind === 'lock') {
    const ink = cssVar('--line');
    svg.appendChild(rc.rectangle(5, 13, 18, 12, { stroke: ink, strokeWidth: 1.6, roughness: 1.2, seed, fill: cssVar('--marker'), fillStyle: 'hachure' }));
    svg.appendChild(rc.path('M 9 13 L 9 9 Q 14 1 19 9 L 19 13', { stroke: ink, strokeWidth: 1.6, roughness: 1, seed }));
  }
  prepare(svg);
  svg.classList.add('draw');
}

export function initSketch() {
  const flow = document.getElementById('flow');
  if (flow) drawFlow(flow as unknown as SVGSVGElement);
  sketchAll();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => setTimeout(redrawEverything, 30));
  // fontovi menjaju veličine -> ResizeObserver ih hvata sam
}
