/**
 * The Hawaiʻi demo: a geological map, audited live, previewable through each
 * dichromacy, and switchable between the style as authored and a remediated
 * one.
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
  type StyleSpecification,
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
  extractBackground,
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
const UNITS_URL = `${BASE}data/units.geojson`;

/** The two styles the demo compares. */
const VARIANTS = {
  original: { label: 'Original Map', url: `${BASE}styles/baseline.json` },
  accessible: { label: 'Accessible Version', url: `${BASE}styles/remediated.json` },
} as const;

type VariantKey = keyof typeof VARIANTS;

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

function arrow(className: string): HTMLSpanElement {
  const node = el('span', className, '→');
  node.setAttribute('aria-hidden', 'true');
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
 * `extractClasses` fills in a `displayName` by itself when a style carries its
 * GeoJSON inline, but this demo's source is a URL, so the app does the same
 * job with the data it fetched.
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

/** One version of the map, with its own audit. */
interface Variant {
  key: VariantKey;
  label: string;
  style: unknown;
  classes: MapClass[];
  audit: AuditResult;
  background: RGB;
}

interface DemoState {
  variants: Variant[];
  active: VariantKey;
  bounds: Map<string, Bbox>;
  mode: VisionMode;
  activePair: AuditPair | undefined;
  showAllClashes: boolean;
}

function current(state: DemoState): Variant {
  const found = state.variants.find((variant) => variant.key === state.active);
  if (found === undefined) {
    throw new Error(`no variant called ${state.active}`);
  }
  return found;
}

/** Build a variant from a loaded style, naming its classes from the data. */
function buildVariant(
  key: VariantKey,
  label: string,
  style: unknown,
  names: ReadonlyMap<string, string>,
): Variant {
  const background = extractBackground(style);
  const classes = extractClasses(style).map((cls) => {
    const unit = unitOf(cls.id);
    const name = unit === undefined ? undefined : names.get(unit);
    if (name !== undefined) {
      cls.displayName = name;
    }
    return cls;
  });
  return { key, label, style, classes, audit: runAudit(classes, { background }), background };
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

  const loadJson = async (url: string): Promise<unknown> => {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`${url} returned HTTP ${String(response.status)}`);
    }
    return response.json();
  };

  let units: unknown;
  let baseline: unknown;
  try {
    [units, baseline] = await Promise.all([loadJson(UNITS_URL), loadJson(VARIANTS.original.url)]);
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

  const names = unitNames(units);
  const variants: Variant[] = [
    buildVariant('original', VARIANTS.original.label, baseline, names),
  ];

  // The remediated style is optional: without it the demo simply has nothing
  // to compare against, rather than failing to start.
  try {
    const remediated = await loadJson(VARIANTS.accessible.url);
    variants.push(buildVariant('accessible', VARIANTS.accessible.label, remediated, names));
  } catch (error) {
    console.warn('[demo] no accessible version to compare with:', error);
  }

  const map = new MapLibreMap({
    container: mapEl,
    style: VARIANTS.original.url,
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

  const state: DemoState = {
    variants,
    active: 'original',
    bounds: unitBounds(units),
    mode: 'normal',
    activePair: undefined,
    showAllClashes: false,
  };

  const render = (): void => {
    renderPanel(panel, state, {
      onVariant: (key) => {
        if (state.active === key) {
          return;
        }
        state.active = key;
        state.activePair = undefined;
        state.showAllClashes = false;
        // Only the paint colours differ between the two, and setStyle keeps
        // the camera, so the map recolours in place rather than jumping.
        map.setStyle(current(state).style as StyleSpecification, { diff: true });
        render();
      },
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

  // Re-added after every style swap, since setStyle takes the old layers away.
  map.on('style.load', () => {
    addHighlightLayer(map);
  });

  map.once('load', () => {
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

/** A thin outline layer used to pick out the two units of a clash. */
function addHighlightLayer(map: MapLibreMap): void {
  if (map.getLayer(HIGHLIGHT_LAYER) !== undefined || map.getSource('units') === undefined) {
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
        node.textContent?.includes(humaniseClassId(pair.classA)) === true ||
        node.textContent?.includes(humaniseClassId(pair.classB)) === true
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
  onVariant(key: VariantKey): void;
  onMode(mode: VisionMode): void;
  onPair(pair: AuditPair): void;
  onToggleAll(): void;
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
    const existing = worstByPair.get(key);
    if (existing === undefined || pair.dE < existing.dE) {
      worstByPair.set(key, pair);
    }
  }
  return [...worstByPair.values()].sort((a, b) => a.dE - b.dE);
}

function renderPanel(panel: HTMLElement, state: DemoState, handlers: PanelHandlers): void {
  const sections: HTMLElement[] = [
    el('h1', 'title', 'Accessibility Audit'),
    el('p', 'subtitle', 'Check if your map colours work for everyone'),
  ];
  if (state.variants.length > 1) {
    sections.push(variantPanel(state, handlers));
  }
  sections.push(
    verdictPanel(state),
    visionPanel(state, handlers),
    clashPanel(state, handlers),
  );
  if (state.active === 'accessible') {
    sections.push(comparePanel(state));
  }
  sections.push(colourPanel(state), technicalPanel(state), aboutPanel());
  panel.replaceChildren(...sections);
}

/** The before/after switch. */
function variantPanel(state: DemoState, handlers: PanelHandlers): HTMLElement {
  const section = el('section', 'panel panel-first');
  const group = el('div', 'segmented');
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Which version of the map to show');

  for (const variant of state.variants) {
    const button = el(
      'button',
      `segment${state.active === variant.key ? ' is-selected' : ''}`,
      variant.label,
    );
    button.type = 'button';
    button.setAttribute('aria-pressed', String(state.active === variant.key));
    button.addEventListener('click', () => {
      handlers.onVariant(variant.key);
    });
    group.append(button);
  }

  section.append(group, el('p', 'note', 'Compare the original and improved versions.'));
  return section;
}

/** The verdict: the first thing anyone reads about the active version. */
function verdictPanel(state: DemoState): HTMLElement {
  const variant = current(state);
  const summary = summariseAudit(variant.classes, variant.audit);
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

  // When there is an improvement to report, say what it was.
  const original = state.variants.find((entry) => entry.key === 'original');
  if (variant.key === 'accessible' && original !== undefined) {
    const was = summariseAudit(original.classes, original.audit).clashes;
    section.append(
      el('p', 'verdict-change', `Down from ${String(was)} on the original map.`),
    );
  }
  return section;
}

function visionPanel(state: DemoState, handlers: PanelHandlers): HTMLElement {
  const section = el('section', 'panel');
  section.append(el('h2', 'panel-title', 'Preview as'));
  section.append(
    el('p', 'note', 'Shows the map, and the colours below, the way each reader sees it.'),
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
    label.append(input, el('span', undefined, VISION_MODE_LABELS[mode]));
    group.append(label);
  }

  section.append(group);
  return section;
}

/** The clashes, each as a sentence with the colours that cause it. */
function clashPanel(state: DemoState, handlers: PanelHandlers): HTMLElement {
  const variant = current(state);
  const section = el('section', 'panel');
  const clashes = clashesByPair(variant.audit);

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

    const nameA = humaniseClassId(pair.classA);
    const nameB = humaniseClassId(pair.classB);
    button.append(el('p', 'clash-text', clashSentence(nameA, nameB, pair.mode)));

    const colours = el('div', 'clash-colours');
    colours.append(
      swatch(seenColor(pair.classA, variant.background, 'normal'), `${nameA}, as authored`, true),
      swatch(seenColor(pair.classB, variant.background, 'normal'), `${nameB}, as authored`, true),
      arrow('clash-arrow'),
      swatch(seenColor(pair.classA, variant.background, pair.mode), `${nameA}, as seen`, true),
      swatch(seenColor(pair.classB, variant.background, pair.mode), `${nameB}, as seen`, true),
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
      state.showAllClashes ? 'Show fewer' : `Show all ${String(clashes.length)} clashes`,
    );
    more.type = 'button';
    more.setAttribute('aria-expanded', String(state.showAllClashes));
    more.addEventListener('click', handlers.onToggleAll);
    section.append(more);
  }
  return section;
}

/** What changed: every colour, before beside after. */
function comparePanel(state: DemoState): HTMLElement {
  const section = el('section', 'panel');
  section.append(el('h2', 'panel-title', 'What changed'));
  section.append(el('p', 'note', 'Every map colour, as authored and as remediated.'));

  const original = state.variants.find((entry) => entry.key === 'original');
  const accessible = current(state);
  const before = new Map((original?.classes ?? []).map((cls) => [cls.id, cls]));

  const list = el('ul', 'list');
  for (const cls of accessible.classes) {
    const was = before.get(cls.id);
    if (was === undefined) {
      continue;
    }
    const name = humaniseClassId(cls);
    const item = el('li', 'klass');
    const colours = el('div', 'klass-colours');
    colours.append(
      swatch(seenColor(was, original?.background ?? accessible.background, state.mode), `${name}, before`),
      arrow('klass-arrow'),
      swatch(seenColor(cls, accessible.background, state.mode), `${name}, after`),
    );
    item.append(colours, el('span', 'klass-name', name));
    list.append(item);
  }
  section.append(list);
  return section;
}

/** Every colour the map paints: swatch and name, nothing else. */
function colourPanel(state: DemoState): HTMLElement {
  const variant = current(state);
  const section = el('section', 'panel');
  const heading = el('h2', 'panel-title', 'Map colours');
  heading.append(el('span', 'panel-count', String(variant.classes.length)));
  section.append(heading);

  if (state.mode !== 'normal') {
    section.append(
      el(
        'p',
        'note',
        `Left as authored, right as a ${VISION_MODE_LABELS[state.mode].toLowerCase()} reader sees it.`,
      ),
    );
  }

  const list = el('ul', 'list');
  for (const cls of variant.classes) {
    const item = el('li', 'klass');
    const name = humaniseClassId(cls);
    const colours = el('div', 'klass-colours');
    colours.append(swatch(seenColor(cls, variant.background, 'normal'), `${name}, as authored`));
    if (state.mode !== 'normal') {
      colours.append(
        arrow('klass-arrow'),
        swatch(seenColor(cls, variant.background, state.mode), `${name}, as seen`),
      );
    }
    item.append(colours, el('span', 'klass-name', name));
    list.append(item);
  }
  section.append(list);
  return section;
}

/** The numbers, for anyone who wants them, folded away by default. */
function technicalPanel(state: DemoState): HTMLElement {
  const variant = current(state);
  const section = el('section', 'panel');
  const details = el('details', 'technical');
  details.append(el('summary', 'technical-summary', 'Technical details'));

  const { audit } = variant;
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
    headRow.append(el('th', undefined, 'Pair'), el('th', 'num', 'ΔE00'), el('th', 'num', 'Contrast'));
    head.append(headRow);
    const body = el('tbody');
    for (const pair of [...audit.failing].sort((a, b) => a.dE - b.dE)) {
      const row = el('tr');
      const cell = el('td');
      cell.append(
        el(
          'span',
          'mini-pair',
          `${humaniseClassId(pair.classA)} ↔ ${humaniseClassId(pair.classB)}`,
        ),
        el('span', 'mini-mode', VISION_MODE_LABELS[pair.mode]),
      );
      row.append(
        cell,
        el('td', 'num', pair.dE.toFixed(2)),
        el('td', 'num', `${pair.contrast.toFixed(2)}:1`),
      );
      body.append(row);
    }
    table.append(head, body);
    details.append(
      el(
        'p',
        'technical-heading',
        `Every clash (${String(audit.failing.length)} of ${String(audit.summary.total)} checks)`,
      ),
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
