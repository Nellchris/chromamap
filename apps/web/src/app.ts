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
const METADATA_URL = `${BASE}data/unit-metadata.json`;

/** The two styles the demo compares. */
const VARIANTS = {
  original: { label: 'Original', url: `${BASE}styles/baseline.json` },
  accessible: { label: 'Accessible', url: `${BASE}styles/remediated.json` },
} as const;

type VariantKey = keyof typeof VARIANTS;

/** The id of the highlight layer this app adds on top of the demo style. */
const HIGHLIGHT_LAYER = 'carto-a11y-highlight';

/** How many clashes the panel shows before asking to be expanded. */
const CLASHES_SHOWN = 5;

/**
 * Caps for a geological map, which has a hundred classes and a thousand
 * clashes. Building every row on every re-render would stall the panel, and
 * nobody reads the thousandth card anyway.
 */
const CLASHES_MAX = 100;
const TECHNICAL_ROWS_MAX = 200;

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
    const unit = (feature as { properties?: { MapUnit?: unknown } }).properties?.MapUnit;
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
 * Readable names for the geological units.
 *
 * `unit-metadata.json` carries the USGS `FullName` for each map unit, so the
 * panel can say "Lava flows of Mauna Loa" where the style only knows `Qmlh`.
 * `extractClasses` fills `displayName` in by itself when a style holds its
 * GeoJSON inline; this demo loads its data by URL, so the app does that job.
 */
function unitNames(metadata: unknown): Map<string, string> {
  const names = new Map<string, string>();
  if (typeof metadata !== 'object' || metadata === null) {
    return names;
  }
  for (const [unit, entry] of Object.entries(metadata as Record<string, unknown>)) {
    const fullName = (entry as { fullName?: unknown })?.fullName;
    if (typeof fullName === 'string' && fullName !== '') {
      names.set(unit, fullName);
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

/**
 * Padding for any `fitBounds`, allowing for the panel.
 *
 * On a wide screen the panel sits beside the map and takes no space from it.
 * On a narrow one it is a sheet lying over the bottom of the map, so framing
 * the island against the full viewport would hide most of it behind the sheet.
 */
function framePadding(sidebar: HTMLElement): { top: number; right: number; bottom: number; left: number } {
  const base = { top: 24, right: 24, bottom: 24, left: 24 };
  if (!isSheetLayout()) {
    return base;
  }
  // However far up the screen the sheet currently reaches is how much of the
  // map it hides, whether it is peeking or fully up.
  const covered = Math.max(0, window.innerHeight - sidebar.getBoundingClientRect().top);
  return { ...base, top: 56, bottom: Math.round(covered) + 16 };
}

/** True when the panel is a sheet over the map rather than a column beside it. */
function isSheetLayout(): boolean {
  return window.matchMedia('(max-width: 760px)').matches;
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

/** Where the panel renders: a fixed header, and a scrolling body. */
interface Mounts {
  variant: HTMLElement;
  score: HTMLElement;
  body: HTMLElement;
  caption: HTMLElement;
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
  const mounts: Mounts | undefined = (() => {
    const variant = root.querySelector<HTMLElement>('#variant-mount');
    const score = root.querySelector<HTMLElement>('#score-mount');
    const body = root.querySelector<HTMLElement>('#sidebar-scroll');
    const caption = root.querySelector<HTMLElement>('#map-caption-mode');
    return variant && score && body && caption ? { variant, score, body, caption } : undefined;
  })();
  const mapEl = root.querySelector<HTMLElement>('#map');
  const sidebar = root.querySelector<HTMLElement>('#sidebar');
  const collapse = root.querySelector<HTMLButtonElement>('#sidebar-toggle');
  const handle = root.querySelector<HTMLButtonElement>('#sheet-handle');
  if (
    mounts === undefined ||
    mapEl === null ||
    sidebar === null ||
    collapse === null ||
    handle === null
  ) {
    throw new Error('the page shell is missing an element the app needs');
  }

  installFilters();

  // One control on desktop (the chevron), another on narrow screens (the sheet
  // handle); both do the same thing.
  const toggleSidebar = (): void => {
    const open = root.dataset['sidebar'] !== 'closed';
    root.dataset['sidebar'] = open ? 'closed' : 'open';
    for (const button of [collapse, handle]) {
      button.setAttribute('aria-expanded', String(!open));
    }
  };
  collapse.addEventListener('click', toggleSidebar);
  handle.addEventListener('click', toggleSidebar);

  // A sheet starts at its resting height, showing the score and the switch
  // with the map still in view; a reader pulls it up for the detail. A column
  // beside the map starts open, since it costs the map nothing.
  if (isSheetLayout()) {
    root.dataset['sidebar'] = 'closed';
    for (const button of [collapse, handle]) {
      button.setAttribute('aria-expanded', 'false');
    }
  }

  const loadJson = async (url: string): Promise<unknown> => {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`${url} returned HTTP ${String(response.status)}`);
    }
    return response.json();
  };

  let units: unknown;
  let baseline: unknown;
  let metadata: unknown;
  try {
    [units, baseline, metadata] = await Promise.all([
      loadJson(UNITS_URL),
      loadJson(VARIANTS.original.url),
      loadJson(METADATA_URL),
    ]);
  } catch (error) {
    mounts.body.replaceChildren(
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

  const names = unitNames(metadata);
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
    renderPanel(mounts, state, {
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
        focusPair(map, state, pair, mounts.body, sidebar);
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
        { padding: framePadding(sidebar), duration: 0 },
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
    filter: ['in', ['get', 'MapUnit'], ['literal', []]],
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
  body: HTMLElement,
  sidebar: HTMLElement,
): void {
  const unitA = unitOf(pair.classA.id);
  const unitB = unitOf(pair.classB.id);
  const boxes = [unitA, unitB]
    .filter((unit): unit is string => unit !== undefined)
    .map((unit) => state.bounds.get(unit))
    .filter((box): box is Bbox => box !== undefined);

  if (map.getLayer(HIGHLIGHT_LAYER) !== undefined) {
    const wanted = [unitA, unitB].filter((unit): unit is string => unit !== undefined);
    map.setFilter(HIGHLIGHT_LAYER, ['in', ['get', 'MapUnit'], ['literal', wanted]]);
  }

  if (boxes.length === 0) {
    // Nothing on the map to zoom to - a line or label colour. Flash instead.
    for (const node of body.querySelectorAll('.klass')) {
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
  const padding = framePadding(sidebar);
  map.fitBounds(bounds, {
    padding: { ...padding, top: padding.top + 32, right: padding.right + 32, left: padding.left + 32 },
    duration: 700,
    maxZoom: 11,
  });
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

function renderPanel(mounts: Mounts, state: DemoState, handlers: PanelHandlers): void {
  mounts.variant.replaceChildren(
    ...(state.variants.length > 1 ? [variantSwitch(state, handlers)] : []),
  );
  mounts.score.replaceChildren(scoreCard(state));

  const sections: HTMLElement[] = [visionPanel(state, handlers), clashPanel(state, handlers)];
  if (state.active === 'accessible') {
    sections.push(changedPanel(state));
  }
  sections.push(colourPanel(state), technicalPanel(state), aboutPanel());
  mounts.body.replaceChildren(...sections);

  // The caption only speaks up when the map is not showing normal vision.
  if (state.mode === 'normal') {
    mounts.caption.textContent = '';
    mounts.caption.hidden = true;
  } else {
    mounts.caption.textContent = `Previewing: ${VISION_MODE_LABELS[state.mode]}`;
    mounts.caption.hidden = false;
  }
}

/** The before/after switch, the showcase control. */
function variantSwitch(state: DemoState, handlers: PanelHandlers): HTMLElement {
  const wrap = el('div');
  const group = el('div', 'variant');
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Which version of the map to show');

  for (const variant of state.variants) {
    const selected = state.active === variant.key;
    const button = el('button', `variant-option${selected ? ' is-selected' : ''}`, variant.label);
    button.type = 'button';
    button.dataset['variant'] = variant.key;
    button.setAttribute('aria-pressed', String(selected));
    button.addEventListener('click', () => {
      handlers.onVariant(variant.key);
    });
    group.append(button);
  }

  wrap.append(group, el('p', 'variant-hint', 'Compare the original and improved versions'));
  return wrap;
}

/** The score: the first thing anyone reads, and always on screen. */
function scoreCard(state: DemoState): HTMLElement {
  const variant = current(state);
  const summary = summariseAudit(variant.classes, variant.audit);
  const card = el('section', `score score-${summary.level}`);
  card.setAttribute('aria-label', 'Map accessibility score');

  const label = el('p', 'score-label');
  const dot = el('span', 'score-dot', summary.indicator);
  dot.setAttribute('aria-hidden', 'true');
  label.append(dot, el('span', undefined, summary.label));

  card.append(
    el('p', 'score-title', 'Map Accessibility Score'),
    label,
    el('p', 'score-headline', summary.headline),
    el('p', 'score-detail', summary.detail),
  );
  if (summary.worstLine !== undefined) {
    card.append(el('p', 'score-worst', summary.worstLine));
  }

  const original = state.variants.find((entry) => entry.key === 'original');
  if (variant.key === 'accessible' && original !== undefined) {
    const was = summariseAudit(original.classes, original.audit).clashes;
    card.append(el('p', 'score-change', `Down from ${String(was)} on the original map`));
  }
  return card;
}

function visionPanel(state: DemoState, handlers: PanelHandlers): HTMLElement {
  const section = el('section', 'panel');
  section.append(
    el('h2', 'panel-title', 'Preview as'),
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

/** The clashes, each a card: a sentence, the colours, and a way to the map. */
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
    section.append(el('p', 'empty', 'Every colour on this map stays distinguishable ✓'));
    return section;
  }

  section.append(el('p', 'note', 'Pairs a reader cannot tell apart, closest first.'));

  const shown = clashes.slice(0, state.showAllClashes ? CLASHES_MAX : CLASHES_SHOWN);
  const list = el('ul', 'list');
  for (const pair of shown) {
    const item = el('li');
    const card = el('button', `clash${state.activePair === pair ? ' is-active' : ''}`);
    card.type = 'button';

    const nameA = humaniseClassId(pair.classA);
    const nameB = humaniseClassId(pair.classB);
    card.append(el('p', 'clash-text', clashSentence(nameA, nameB, pair.mode)));

    const colours = el('div', 'clash-colours');
    colours.append(
      swatch(seenColor(pair.classA, variant.background, 'normal'), `${nameA}, as authored`, true),
      swatch(seenColor(pair.classB, variant.background, 'normal'), `${nameB}, as authored`, true),
      arrow('clash-arrow'),
      swatch(seenColor(pair.classA, variant.background, pair.mode), `${nameA}, as seen`, true),
      swatch(seenColor(pair.classB, variant.background, pair.mode), `${nameB}, as seen`, true),
    );

    const foot = el('div', 'clash-foot');
    foot.append(colours, el('span', 'clash-link', 'View on map →'));
    card.append(foot);

    card.addEventListener('click', () => {
      handlers.onPair(pair);
    });
    item.append(card);
    list.append(item);
  }
  section.append(list);

  if (clashes.length > CLASHES_SHOWN) {
    const more = el(
      'button',
      'link-button',
      state.showAllClashes
        ? 'Show fewer'
        : clashes.length > CLASHES_MAX
          ? `Show the worst ${String(CLASHES_MAX)} of ${String(clashes.length)} clashes`
          : `Show all ${String(clashes.length)} clashes`,
    );
    more.type = 'button';
    more.setAttribute('aria-expanded', String(state.showAllClashes));
    more.addEventListener('click', handlers.onToggleAll);
    section.append(more);
  }
  return section;
}

/** What the repalette did, as a strip of before/after pairs. */
function changedPanel(state: DemoState): HTMLElement {
  const section = el('section', 'panel');
  const original = state.variants.find((entry) => entry.key === 'original');
  const accessible = current(state);
  const before = new Map((original?.classes ?? []).map((cls) => [cls.id, cls]));

  section.append(el('h2', 'panel-title', 'What changed'));

  const strip = el('ul', 'changed-strip');
  let changed = 0;
  for (const cls of accessible.classes) {
    const was = before.get(cls.id);
    if (was === undefined) {
      continue;
    }
    const name = humaniseClassId(cls);
    const beforeColor = seenColor(was, original?.background ?? accessible.background, state.mode);
    const afterColor = seenColor(cls, accessible.background, state.mode);

    const item = el('li', 'changed-pair');
    item.title = `${name}: ${rgbToHex(beforeColor)} → ${rgbToHex(afterColor)}`;
    const left = el('span');
    left.style.background = rgbToHex(beforeColor);
    const right = el('span');
    right.style.background = rgbToHex(afterColor);
    item.append(left, right);
    strip.append(item);
    changed += 1;
  }

  section.append(
    el('p', 'note', `${String(changed)} map colours repaletted — before on the left, after on the right.`),
    strip,
  );
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

  const modes = el('table', 'data-table');
  const modeHead = el('thead');
  const modeHeadRow = el('tr');
  modeHeadRow.append(el('th', undefined, 'Who is affected'), el('th', 'num', 'Clashes'));
  modeHead.append(modeHeadRow);
  const modeBody = el('tbody');
  for (const mode of VISION_MODES) {
    const row = el('tr');
    row.append(
      el('td', undefined, VISION_MODE_LABELS[mode]),
      el('td', 'num', String(audit.summary.byMode[mode])),
    );
    modeBody.append(row);
  }
  modes.append(modeHead, modeBody);
  details.append(el('p', 'technical-heading', 'By vision mode'), modes);

  if (audit.failing.length > 0) {
    const table = el('table', 'data-table');
    const head = el('thead');
    const headRow = el('tr');
    headRow.append(el('th', undefined, 'Pair'), el('th', 'num', 'ΔE00'), el('th', 'num', 'Contrast'));
    head.append(headRow);
    const body = el('tbody');
    const sorted = [...audit.failing].sort((a, b) => a.dE - b.dE);
    for (const pair of sorted.slice(0, TECHNICAL_ROWS_MAX)) {
      const row = el('tr');
      const cell = el('td');
      cell.append(
        el(
          'span',
          'data-pair',
          `${humaniseClassId(pair.classA)} ↔ ${humaniseClassId(pair.classB)}`,
        ),
        el('span', 'data-mode', VISION_MODE_LABELS[pair.mode]),
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
        audit.failing.length > TECHNICAL_ROWS_MAX
          ? `Closest ${String(TECHNICAL_ROWS_MAX)} of ${String(audit.failing.length)} clashes, from ${String(audit.summary.total)} checks`
          : `Every clash (${String(audit.failing.length)} of ${String(audit.summary.total)} checks)`,
      ),
      table,
    );
  }

  section.append(details);
  return section;
}

function aboutPanel(): HTMLElement {
  const section = el('section', 'panel about');
  const details = el('details');
  details.append(el('summary', 'about-summary', 'About'), el('p', 'about-text', ABOUT_TEXT));
  section.append(details);
  return section;
}
