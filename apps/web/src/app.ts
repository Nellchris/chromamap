/**
 * The Hawaiʻi demo: a geological map, audited live, previewable through each
 * dichromacy.
 *
 * Everything the panel shows comes from `@carto-a11y/core` running in the
 * browser on the very style MapLibre is drawing, so what the audit says and
 * what the map shows cannot drift apart.
 */

// maplibre-gl 6 has no default export, and its `Map` would shadow the built-in
// one this file uses, so it comes in under its own alias.
import {
  MapLibreMap,
  NavigationControl,
  ScaleControl,
  setWorkerUrl,
  type LngLatBoundsLike,
} from 'maplibre-gl';
// MapLibre finds its worker with `new URL('./maplibre-gl-worker.mjs',
// import.meta.url)`. Once a bundler has moved the module, that URL points at
// a file which is not there, and the map renders its background and nothing
// else. Handing Vite the worker as an asset and naming it explicitly is what
// keeps the map working in a build as well as in dev.
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';

setWorkerUrl(maplibreWorkerUrl);

import {
  CVD_MATRICES,
  VISION_MODES,
  compositeOver,
  extractClasses,
  rgbToHex,
  runAudit,
  simulateCVD,
  type AuditPair,
  type AuditResult,
  type MapClass,
  type RGB,
  type VisionMode,
} from '@carto-a11y/core';

const BASE = import.meta.env.BASE_URL;
const STYLE_URL = `${BASE}styles/baseline.json`;
const UNITS_URL = `${BASE}data/units.geojson`;

/** What a reader is told each mode is called. */
const MODE_LABELS: Record<VisionMode, string> = {
  normal: 'Normal',
  protan: 'Protanopia',
  deutan: 'Deuteranopia',
  tritan: 'Tritanopia',
};

/** The id of the highlight layer this app adds on top of the demo style. */
const HIGHLIGHT_LAYER = 'carto-a11y-highlight';

interface Bbox {
  west: number;
  south: number;
  east: number;
  north: number;
}

/* ------------------------------------------------------------------ *
 * Small DOM helpers - no framework, as asked.
 * ------------------------------------------------------------------ */

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

function swatch(color: RGB, title: string, small = false): HTMLSpanElement {
  const node = el('span', small ? 'swatch swatch-sm' : 'swatch');
  node.style.background = rgbToHex(color);
  node.title = title;
  return node;
}

/* ------------------------------------------------------------------ *
 * CVD preview filters
 * ------------------------------------------------------------------ */

/**
 * Install one SVG filter per dichromacy, built from the same Machado matrices
 * the engine uses.
 *
 * `color-interpolation-filters="linearRGB"` makes the browser apply the matrix
 * in linear light using the real sRGB transfer function, which is exactly what
 * `simulateCVD` does. Doing it instead with an explicit feComponentTransfer
 * gamma of 2.2 would only approximate that curve, and the map would then
 * disagree with the swatches beside it.
 */
function installFilters(): void {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'filter-defs');
  svg.setAttribute('aria-hidden', 'true');
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');

  for (const mode of ['protan', 'deutan', 'tritan'] as const) {
    const matrix = CVD_MATRICES[mode];
    const filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
    filter.setAttribute('id', `cvd-${mode}`);
    filter.setAttribute('color-interpolation-filters', 'linearRGB');
    const transform = document.createElementNS('http://www.w3.org/2000/svg', 'feColorMatrix');
    transform.setAttribute('type', 'matrix');
    transform.setAttribute(
      'values',
      `${matrix.map((row) => `${row.join(' ')} 0 0`).join(' ')} 0 0 0 1 0`,
    );
    filter.append(transform);
    defs.append(filter);
  }

  svg.append(defs);
  document.body.append(svg);
}

/* ------------------------------------------------------------------ *
 * Demo data
 * ------------------------------------------------------------------ */

/** Bounding box per geological unit, so a failing pair can be zoomed to. */
function unitBounds(geojson: unknown): Map<string, Bbox> {
  const bounds = new Map<string, Bbox>();
  const features = (geojson as { features?: unknown }).features;
  if (!Array.isArray(features)) {
    return bounds;
  }

  for (const feature of features) {
    const unit = (feature as { properties?: { unit?: unknown } }).properties?.unit;
    const coordinates = (feature as { geometry?: { coordinates?: unknown } }).geometry
      ?.coordinates;
    if (typeof unit !== 'string' || !Array.isArray(coordinates)) {
      continue;
    }
    const box = bounds.get(unit) ?? {
      west: 180,
      south: 90,
      east: -180,
      north: -90,
    };
    for (const ring of coordinates as unknown[]) {
      if (!Array.isArray(ring)) {
        continue;
      }
      for (const position of ring as unknown[]) {
        if (!Array.isArray(position) || position.length < 2) {
          continue;
        }
        const [lon, lat] = position as [number, number];
        box.west = Math.min(box.west, lon);
        box.east = Math.max(box.east, lon);
        box.south = Math.min(box.south, lat);
        box.north = Math.max(box.north, lat);
      }
    }
    bounds.set(unit, box);
  }
  return bounds;
}

/** `geologic-units/Qkh` names unit `Qkh`; a plain layer id names nothing. */
function unitOf(classId: string): string | undefined {
  const slash = classId.lastIndexOf('/');
  if (slash === -1) {
    return undefined;
  }
  const unit = classId.slice(slash + 1);
  return unit === '' || unit === 'default' ? undefined : unit;
}

function merge(a: Bbox, b: Bbox): Bbox {
  return {
    west: Math.min(a.west, b.west),
    south: Math.min(a.south, b.south),
    east: Math.max(a.east, b.east),
    north: Math.max(a.north, b.north),
  };
}

/* ------------------------------------------------------------------ *
 * The app
 * ------------------------------------------------------------------ */

/** Everything the panels need, gathered once. */
interface DemoState {
  classes: MapClass[];
  audit: AuditResult;
  background: RGB;
  bounds: Map<string, Bbox>;
  mode: VisionMode;
  activePair: AuditPair | undefined;
}

export async function startApp(root: HTMLElement): Promise<void> {
  const panel = root.querySelector<HTMLElement>('#sidebar-scroll');
  const mapEl = root.querySelector<HTMLElement>('#map');
  const toggle = root.querySelector<HTMLButtonElement>('#sidebar-toggle');
  if (panel === null || mapEl === null || toggle === null) {
    throw new Error('the page shell is missing an element the app needs');
  }

  installFilters();

  toggle.addEventListener('click', () => {
    const open = root.dataset['sidebar'] !== 'closed';
    root.dataset['sidebar'] = open ? 'closed' : 'open';
    toggle.setAttribute('aria-expanded', String(!open));
  });

  let style: unknown;
  let units: unknown;
  try {
    const [styleResponse, unitsResponse] = await Promise.all([
      fetch(STYLE_URL),
      fetch(UNITS_URL),
    ]);
    if (!styleResponse.ok || !unitsResponse.ok) {
      throw new Error(`HTTP ${String(styleResponse.status)} / ${String(unitsResponse.status)}`);
    }
    style = await styleResponse.json();
    units = await unitsResponse.json();
  } catch (error) {
    panel.replaceChildren(
      el(
        'p',
        'error',
        `Could not load the demo style or data: ${
          error instanceof Error ? error.message : String(error)
        }`,
      ),
    );
    return;
  }

  const map = new MapLibreMap({
    container: mapEl,
    style: STYLE_URL,
    center: [-155.5, 19.6],
    zoom: 8.1,
    attributionControl: { compact: true },
  });
  map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
  map.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-right');
  // Collapsing the sidebar changes the map's box without changing the window,
  // so MapLibre has to be told; this covers window resizes too.
  new ResizeObserver(() => {
    map.resize();
  }).observe(mapEl);

  if (import.meta.env.DEV) {
    // Handy when poking at the demo from the console; never shipped.
    (globalThis as unknown as { cartoMap?: MapLibreMap }).cartoMap = map;
  }
  map.on('error', (event) => {
    // A missing glyph server or a malformed source would otherwise fail
    // silently and leave an empty blue rectangle.
    console.error('[map]', event.error?.message ?? event);
  });

  const classes = extractClasses(style);
  const background = backgroundOf(style);
  const state: DemoState = {
    classes,
    audit: runAudit(classes, { background }),
    background,
    bounds: unitBounds(units),
    mode: 'normal',
    activePair: undefined,
  };

  const render = (): void => {
    renderPanel(panel, state, {
      onMode: (mode) => {
        state.mode = mode;
        mapEl.style.filter = mode === 'normal' ? '' : `url(#cvd-${mode})`;
        render();
      },
      onPair: (pair) => {
        state.activePair = pair;
        focusPair(map, state, pair, panel);
        render();
      },
    });
  };

  render();

  map.on('load', () => {
    addHighlightLayer(map);
  });
}

/** The style's own background colour, which classes are composited over. */
function backgroundOf(style: unknown): RGB {
  const layers = (style as { layers?: unknown }).layers;
  if (Array.isArray(layers)) {
    for (const layer of layers) {
      const paint = (layer as { paint?: Record<string, unknown> }).paint;
      const colour = paint?.['background-color'];
      if (typeof colour === 'string') {
        try {
          // The ocean behind the island is what a coastal unit sits on.
          return hexToRgb(colour);
        } catch {
          break;
        }
      }
    }
  }
  return [1, 1, 1];
}

function hexToRgb(value: string): RGB {
  const hex = value.replace('#', '');
  const full =
    hex.length === 3
      ? [...hex].map((digit) => `${digit}${digit}`).join('')
      : hex.slice(0, 6);
  const int = Number.parseInt(full, 16);
  if (Number.isNaN(int)) {
    throw new Error(`not a hex colour: ${value}`);
  }
  return [((int >> 16) & 0xff) / 255, ((int >> 8) & 0xff) / 255, (int & 0xff) / 255];
}

/** A thin outline layer used to pick out the two units of a failing pair. */
function addHighlightLayer(map: MapLibreMap): void {
  if (map.getLayer(HIGHLIGHT_LAYER) !== undefined) {
    return;
  }
  map.addLayer({
    id: HIGHLIGHT_LAYER,
    type: 'line',
    source: 'units',
    filter: ['in', ['get', 'unit'], ['literal', []]],
    paint: {
      'line-color': '#ffffff',
      'line-width': 2.5,
      'line-blur': 0.4,
    },
  });
}

/** Zoom to the two units of a failing pair and outline them. */
function focusPair(
  map: MapLibreMap,
  state: DemoState,
  pair: AuditPair,
  panel: HTMLElement,
): void {
  const unitA = unitOf(pair.classA.id);
  const unitB = unitOf(pair.classB.id);
  const boxes = [unitA, unitB]
    .filter((unit): unit is string => unit !== undefined)
    .map((unit) => state.bounds.get(unit))
    .filter((box): box is Bbox => box !== undefined);

  if (map.getLayer(HIGHLIGHT_LAYER) !== undefined) {
    const wanted = [unitA, unitB].filter((unit): unit is string => unit !== undefined);
    map.setFilter(HIGHLIGHT_LAYER, ['in', ['get', 'unit'], ['literal', wanted]]);
  }

  if (boxes.length === 0) {
    // Nothing on the map to zoom to - a line or label class. Flash instead.
    for (const node of panel.querySelectorAll('.klass')) {
      if (
        node.textContent?.includes(pair.classA.id) === true ||
        node.textContent?.includes(pair.classB.id) === true
      ) {
        node.classList.remove('is-flashing');
        void (node as HTMLElement).offsetWidth;
        node.classList.add('is-flashing');
      }
    }
    return;
  }

  const box = boxes.reduce(merge);
  const bounds: LngLatBoundsLike = [
    [box.west, box.south],
    [box.east, box.north],
  ];
  map.fitBounds(bounds, { padding: 56, duration: 700, maxZoom: 11 });
}

/* ------------------------------------------------------------------ *
 * Panels
 * ------------------------------------------------------------------ */

interface PanelHandlers {
  onMode(mode: VisionMode): void;
  onPair(pair: AuditPair): void;
}

function renderPanel(panel: HTMLElement, state: DemoState, handlers: PanelHandlers): void {
  panel.replaceChildren(
    el('h1', 'title', 'CartoAccessibility Studio'),
    el('p', 'subtitle', 'Hawaiʻi Island geological map · baseline style'),
    visionPanel(state, handlers),
    auditPanel(state, handlers),
    classPanel(state),
  );
}

function visionPanel(state: DemoState, handlers: PanelHandlers): HTMLElement {
  const section = el('section', 'panel');
  section.append(el('h2', 'panel-title', 'Vision mode'));
  section.append(
    el('p', 'note', 'Simulates the map, and the swatches below, for a dichromatic reader.'),
  );

  const group = el('div', 'modes');
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', 'Vision mode');

  for (const mode of VISION_MODES) {
    const label = el('label', 'mode');
    const input = el('input');
    input.type = 'radio';
    input.name = 'vision-mode';
    input.value = mode;
    input.checked = state.mode === mode;
    input.addEventListener('change', () => {
      handlers.onMode(mode);
    });
    label.append(input, el('span', undefined, MODE_LABELS[mode]));
    group.append(label);
  }

  section.append(group);
  return section;
}

function stat(value: string, label: string, tone: 'neutral' | 'good' | 'bad'): HTMLElement {
  const item = el('li', `stat${tone === 'neutral' ? '' : ` is-${tone}`}`);
  item.append(el('div', 'stat-value', value), el('div', 'stat-label', label));
  return item;
}

function auditPanel(state: DemoState, handlers: PanelHandlers): HTMLElement {
  const { audit, classes } = state;
  const classPairs = (classes.length * (classes.length - 1)) / 2;
  const failingPairs = new Set(
    audit.failing.map((pair) => `${pair.classA.id}\u0000${pair.classB.id}`),
  ).size;

  const section = el('section', 'panel');
  const heading = el('h2', 'panel-title', 'Audit');
  const count = el(
    'span',
    `panel-count${failingPairs > 0 ? ' is-bad' : ''}`,
    `${String(failingPairs)} failing`,
  );
  heading.append(count);
  section.append(heading);

  const stats = el('ul', 'stats');
  stats.append(
    stat(String(classes.length), 'classes', 'neutral'),
    stat(String(audit.summary.total), 'judgements', 'neutral'),
    stat(String(classPairs - failingPairs), 'pairs clear', 'good'),
    stat(String(failingPairs), 'pairs confusable', failingPairs > 0 ? 'bad' : 'good'),
  );
  section.append(stats);

  if (audit.failing.length === 0) {
    section.append(el('p', 'empty', 'Nothing in this style is confusable. '));
    return section;
  }

  section.append(
    el('p', 'note', 'Worst first. Pick one to outline both units and zoom the map to them.'),
  );

  const list = el('ul', 'list');
  const worst = [...audit.failing].sort((a, b) => a.dE - b.dE).slice(0, 25);
  for (const pair of worst) {
    const item = el('li');
    const button = el('button', `pair${state.activePair === pair ? ' is-active' : ''}`);
    button.type = 'button';

    const ids = el('div', 'pair-ids');
    ids.append(
      swatch(seenColor(pair.classA, state.background, pair.mode), pair.classA.id, true),
      el('span', 'pair-id', short(pair.classA.id)),
      el('span', 'pair-arrow', '↔'),
      swatch(seenColor(pair.classB, state.background, pair.mode), pair.classB.id, true),
      el('span', 'pair-id', short(pair.classB.id)),
    );

    const meta = el('div', 'pair-meta');
    meta.append(
      el('span', 'pair-mode', MODE_LABELS[pair.mode]),
      el('span', undefined, `ΔE ${pair.dE.toFixed(1)}`),
      el('span', undefined, `${pair.contrast.toFixed(2)}:1`),
    );

    button.append(ids, meta);
    button.addEventListener('click', () => {
      handlers.onPair(pair);
    });
    item.append(button);
    list.append(item);
  }
  section.append(list);

  if (audit.failing.length > worst.length) {
    section.append(
      el(
        'p',
        'note',
        `Showing the 25 closest of ${String(audit.failing.length)} failing judgements.`,
      ),
    );
  }
  return section;
}

/** A class's colour as a reader in this mode sees it, flattened and simulated. */
function seenColor(cls: MapClass, background: RGB, mode: VisionMode): RGB {
  const flat = compositeOver(cls.color, cls.opacity, background);
  return mode === 'normal' ? flat : simulateCVD(flat, mode);
}

/** Layer ids get long; the unit label is the part that identifies a class. */
function short(classId: string): string {
  const slash = classId.lastIndexOf('/');
  return slash === -1 ? classId : classId.slice(slash + 1);
}

function classPanel(state: DemoState): HTMLElement {
  const section = el('section', 'panel');
  const heading = el('h2', 'panel-title', 'Classes');
  heading.append(el('span', 'panel-count', String(state.classes.length)));
  section.append(heading);
  section.append(
    el(
      'p',
      'note',
      state.mode === 'normal'
        ? 'As authored, composited over the map background.'
        : `Left: normal vision. Right: ${MODE_LABELS[state.mode].toLowerCase()}.`,
    ),
  );

  const list = el('ul', 'list');
  for (const cls of state.classes) {
    const item = el('li', 'klass');
    const flat = compositeOver(cls.color, cls.opacity, state.background);
    const seen = seenColor(cls, state.background, state.mode);

    const pair = el('div', 'klass-pair');
    pair.append(swatch(flat, `${cls.id} — as authored ${rgbToHex(flat)}`));
    if (state.mode !== 'normal') {
      pair.append(swatch(seen, `${cls.id} — ${MODE_LABELS[state.mode]} ${rgbToHex(seen)}`));
    }

    const text = el('div', 'klass-text');
    text.append(
      el('span', 'klass-id', cls.id),
      el(
        'span',
        'klass-meta',
        `${cls.type} · ${rgbToHex(cls.color)}${cls.opacity === 1 ? '' : ` · ${String(Math.round(cls.opacity * 100))}%`}`,
      ),
    );

    item.append(pair, text);
    list.append(item);
  }
  section.append(list);
  return section;
}
