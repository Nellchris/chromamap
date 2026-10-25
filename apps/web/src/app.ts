/**
 * The Hawaiʻi demo: a geological map, audited live, previewable through each
 * dichromacy.
 *
 * Everything the panel shows comes from `@carto-a11y/core` running in the
 * browser on the very style MapLibre is drawing, so what the audit says and
 * what the map shows cannot drift apart. The wording comes from core too, so
 * the panel and an exported report say the same things in the same words.
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

import {
  ABOUT_TEXT,
  CVD_MATRICES,
  VISION_MODES,
  VISION_MODE_LABELS,
  clashSentence,
  compositeOver,
  extractClasses,
  humaniseClassId,
  rgbToHex,
  runAudit,
  simulateCVD,
  summariseAudit,
  type AuditPair,
  type AuditResult,
  type MapClass,
  type RGB,
  type VisionMode,
} from '@carto-a11y/core';

setWorkerUrl(maplibreWorkerUrl);

const BASE = import.meta.env.BASE_URL;
const STYLE_URL = `${BASE}styles/baseline.json`;
const UNITS_URL = `${BASE}data/units.geojson`;

/** The id of the highlight layer this app adds on top of the demo style. */
const HIGHLIGHT_LAYER = 'carto-a11y-highlight';

/** How many clashes the panel shows before asking to be expanded. */
const CLASHES_SHOWN = 5;

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

/** Bounding box per geological unit, so a clash can be zoomed to. */
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
    const box = bounds.get(unit) ?? { west: 180, south: 90, east: -180, north: -90 };
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

/**
 * Real names for the geological units, read out of the data.
 *
 * A style only knows a unit as `Qku`; the GeoJSON knows it is the Kaʻū Basalt.
 * Using the better name is the difference between a panel that reads like a
 * sentence and one that reads like a database.
 */
function unitNames(geojson: unknown): Map<string, string> {
  const names = new Map<string, string>();
  const features = (geojson as { features?: unknown }).features;
  if (!Array.isArray(features)) {
    return names;
  }
  for (const feature of features) {
    const properties = (feature as { properties?: Record<string, unknown> }).properties;
    const unit = properties?.['unit'];
    const name = properties?.['name'];
    if (typeof unit === 'string' && typeof name === 'string' && name !== '') {
      names.set(unit, name);
    }
  }
  return names;
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
  names: Map<string, string>;
  mode: VisionMode;
  activePair: AuditPair | undefined;
  showAllClashes: boolean;
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
    names: unitNames(units),
    mode: 'normal',
    activePair: undefined,
    showAllClashes: false,
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
      onToggleAll: () => {
        state.showAllClashes = !state.showAllClashes;
        render();
      },
    });
  };

  render();

  map.on('load', () => {
    addHighlightLayer(map);
    // The style's own centre and zoom assume a full window; in a narrow one,
    // next to the panel, they leave the reader looking at open ocean. Framing
    // the data itself works at any width.
    const boxes = [...state.bounds.values()];
    const first = boxes[0];
    if (first !== undefined) {
      const box = boxes.reduce(merge, first);
      map.fitBounds(
        [
          [box.west, box.south],
          [box.east, box.north],
        ],
        { padding: 24, duration: 0 },
      );
    }
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
    hex.length === 3 ? [...hex].map((digit) => `${digit}${digit}`).join('') : hex.slice(0, 6);
  const int = Number.parseInt(full, 16);
  if (Number.isNaN(int)) {
    throw new Error(`not a hex colour: ${value}`);
  }
  return [((int >> 16) & 0xff) / 255, ((int >> 8) & 0xff) / 255, (int & 0xff) / 255];
}

/** A thin outline layer used to pick out the two units of a clash. */
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

/** Zoom to the two colours of a clash and outline them. */
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
    // Nothing on the map to zoom to - a line or label colour. Flash instead.
    for (const node of panel.querySelectorAll('.klass')) {
      if (
        node.textContent?.includes(nameOf(state, pair.classA)) === true ||
        node.textContent?.includes(nameOf(state, pair.classB)) === true
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
  onToggleAll(): void;
}

/** The friendliest name available for a map colour. */
function nameOf(state: DemoState, cls: MapClass): string {
  const unit = unitOf(cls.id);
  const known = unit === undefined ? undefined : state.names.get(unit);
  return known ?? humaniseClassId(cls.id);
}

/** A class's colour as a reader in this mode sees it, flattened and simulated. */
function seenColor(cls: MapClass, background: RGB, mode: VisionMode): RGB {
  const flat = compositeOver(cls.color, cls.opacity, background);
  return mode === 'normal' ? flat : simulateCVD(flat, mode);
}

/** One clash per pair of colours, worst mode first. */
function clashesByPair(audit: AuditResult): AuditPair[] {
  const worstByPair = new Map<string, AuditPair>();
  for (const pair of audit.failing) {
    const key = `${pair.classA.id}\u0000${pair.classB.id}`;
    const current = worstByPair.get(key);
    if (current === undefined || pair.dE < current.dE) {
      worstByPair.set(key, pair);
    }
  }
  return [...worstByPair.values()].sort((a, b) => a.dE - b.dE);
}

function renderPanel(panel: HTMLElement, state: DemoState, handlers: PanelHandlers): void {
  panel.replaceChildren(
    el('h1', 'title', 'Accessibility Audit'),
    el('p', 'subtitle', 'Check if your map colours work for everyone'),
    verdictPanel(state),
    visionPanel(state, handlers),
    clashPanel(state, handlers),
    colourPanel(state),
    technicalPanel(state),
    aboutPanel(),
  );
}

/** The verdict: the first thing anyone reads. */
function verdictPanel(state: DemoState): HTMLElement {
  const summary = summariseAudit(state.classes, state.audit);
  const section = el('section', `verdict verdict-${summary.level}`);

  const label = el('p', 'verdict-label');
  const dot = el('span', 'verdict-dot', summary.indicator);
  dot.setAttribute('aria-hidden', 'true');
  label.append(dot, el('span', undefined, summary.label));

  section.append(
    el('p', 'verdict-title', 'Map Accessibility Score'),
    label,
    el('p', 'verdict-headline', summary.headline),
    el('p', 'verdict-detail', summary.detail),
  );
  if (summary.worstLine !== undefined) {
    section.append(el('p', 'verdict-worst', summary.worstLine));
  }
  return section;
}

function visionPanel(state: DemoState, handlers: PanelHandlers): HTMLElement {
  const section = el('section', 'panel');
  section.append(el('h2', 'panel-title', 'Preview as'));
  section.append(el('p', 'note', 'Shows the map, and the colours below, the way each reader sees it.'));

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
    label.append(input, el('span', undefined, VISION_MODE_LABELS[mode]));
    group.append(label);
  }

  section.append(group);
  return section;
}

/** The clashes, each as a sentence with the colours that cause it. */
function clashPanel(state: DemoState, handlers: PanelHandlers): HTMLElement {
  const section = el('section', 'panel');
  const clashes = clashesByPair(state.audit);

  const heading = el('h2', 'panel-title', 'Colour clashes');
  if (clashes.length > 0) {
    heading.append(el('span', 'panel-count is-bad', String(clashes.length)));
  }
  section.append(heading);

  if (clashes.length === 0) {
    section.append(el('p', 'empty', 'Every colour on this map stays distinguishable. ✓'));
    return section;
  }

  section.append(el('p', 'note', 'Pick one to outline both colours and zoom the map to them.'));

  const shown = state.showAllClashes ? clashes : clashes.slice(0, CLASHES_SHOWN);
  const list = el('ul', 'list');
  for (const pair of shown) {
    const item = el('li');
    const button = el('button', `clash${state.activePair === pair ? ' is-active' : ''}`);
    button.type = 'button';

    const nameA = nameOf(state, pair.classA);
    const nameB = nameOf(state, pair.classB);
    button.append(el('p', 'clash-text', clashSentence(nameA, nameB, pair.mode)));

    const colours = el('div', 'clash-colours');
    colours.append(
      swatch(seenColor(pair.classA, state.background, 'normal'), `${nameA}, as authored`, true),
      swatch(seenColor(pair.classB, state.background, 'normal'), `${nameB}, as authored`, true),
    );
    const arrow = el('span', 'clash-arrow', '→');
    arrow.setAttribute('aria-hidden', 'true');
    colours.append(arrow);
    colours.append(
      swatch(seenColor(pair.classA, state.background, pair.mode), `${nameA}, as seen`, true),
      swatch(seenColor(pair.classB, state.background, pair.mode), `${nameB}, as seen`, true),
    );
    button.append(colours);

    button.addEventListener('click', () => {
      handlers.onPair(pair);
    });
    item.append(button);
    list.append(item);
  }
  section.append(list);

  if (clashes.length > CLASHES_SHOWN) {
    const more = el(
      'button',
      'link-button',
      state.showAllClashes
        ? 'Show fewer'
        : `Show all ${String(clashes.length)} clashes`,
    );
    more.type = 'button';
    more.setAttribute('aria-expanded', String(state.showAllClashes));
    more.addEventListener('click', handlers.onToggleAll);
    section.append(more);
  }
  return section;
}

/** Every colour the map paints: swatch and name, nothing else. */
function colourPanel(state: DemoState): HTMLElement {
  const section = el('section', 'panel');
  const heading = el('h2', 'panel-title', 'Map colours');
  heading.append(el('span', 'panel-count', String(state.classes.length)));
  section.append(heading);

  if (state.mode !== 'normal') {
    section.append(
      el('p', 'note', `Left as authored, right as a ${VISION_MODE_LABELS[state.mode].toLowerCase()} reader sees it.`),
    );
  }

  const list = el('ul', 'list');
  for (const cls of state.classes) {
    const item = el('li', 'klass');
    const name = nameOf(state, cls);
    const authored = seenColor(cls, state.background, 'normal');

    const colours = el('div', 'klass-colours');
    colours.append(swatch(authored, `${name}, as authored`));
    if (state.mode !== 'normal') {
      const arrow = el('span', 'klass-arrow', '→');
      arrow.setAttribute('aria-hidden', 'true');
      colours.append(arrow, swatch(seenColor(cls, state.background, state.mode), `${name}, as seen`));
    }

    item.append(colours, el('span', 'klass-name', name));
    list.append(item);
  }
  section.append(list);
  return section;
}

/** The numbers, for anyone who wants them, folded away by default. */
function technicalPanel(state: DemoState): HTMLElement {
  const section = el('section', 'panel');
  const details = el('details', 'technical');
  const summary = el('summary', 'technical-summary', 'Technical details');
  details.append(summary);

  const { audit } = state;
  details.append(
    el(
      'p',
      'note',
      `${String(audit.summary.total)} checks in all: every pair of map colours under every ` +
        `vision mode. A pair is reported when its CIEDE2000 distance (ΔE00) falls below 10.`,
    ),
  );

  const modes = el('table', 'mini');
  const modeBody = el('tbody');
  for (const mode of VISION_MODES) {
    const row = el('tr');
    row.append(
      el('td', undefined, VISION_MODE_LABELS[mode]),
      el('td', 'num', String(audit.summary.byMode[mode])),
    );
    modeBody.append(row);
  }
  modes.append(modeBody);
  details.append(el('p', 'technical-heading', 'Clashes by vision mode'), modes);

  if (audit.failing.length > 0) {
    const table = el('table', 'mini');
    const head = el('thead');
    const headRow = el('tr');
    headRow.append(
      el('th', undefined, 'Pair'),
      el('th', 'num', 'ΔE00'),
      el('th', 'num', 'Contrast'),
    );
    head.append(headRow);
    const body = el('tbody');
    for (const pair of [...audit.failing].sort((a, b) => a.dE - b.dE)) {
      const row = el('tr');
      const cell = el('td');
      cell.append(
        el('span', 'mini-pair', `${nameOf(state, pair.classA)} ↔ ${nameOf(state, pair.classB)}`),
        el('span', 'mini-mode', VISION_MODE_LABELS[pair.mode]),
      );
      row.append(cell, el('td', 'num', pair.dE.toFixed(2)), el('td', 'num', `${pair.contrast.toFixed(2)}:1`));
      body.append(row);
    }
    table.append(head, body);
    details.append(
      el('p', 'technical-heading', `Every clash (${String(audit.failing.length)} of ${String(audit.summary.total)} checks)`),
      table,
    );
  }

  section.append(details);
  return section;
}

function aboutPanel(): HTMLElement {
  const section = el('section', 'panel about');
  section.append(el('h2', 'panel-title', 'About'), el('p', 'about-text', ABOUT_TEXT));
  return section;
}
