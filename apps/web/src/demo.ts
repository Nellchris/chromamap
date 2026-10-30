/**
 * The Hawaiʻi demo: a geological map, audited live, previewable through each
 * dichromacy, and switchable between the style as authored and a remediated
 * one.
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
  Popup,
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
  extractBackground,
  extractClasses,
  humaniseClassId,
  rgbToHex,
  type AuditPair,
  type MapClass,
  type VisionMode,
} from '@carto-a11y/core';

import {
  aboutPanel,
  auditView,
  changedPanel,
  clashPanel,
  scoreCard,
  seenColor,
  technicalPanel,
  type AuditView,
  type ModeView,
} from './audit-view.js';
import { disclosure, download, el, segmented } from './dom.js';

setWorkerUrl(maplibreWorkerUrl);

const BASE = import.meta.env.BASE_URL;
const UNITS_URL = `${BASE}data/units.geojson`;
const METADATA_URL = `${BASE}data/unit-metadata.json`;

/** The two styles the demo compares. */
export const VARIANTS = {
  original: { label: 'Original', url: `${BASE}styles/baseline.json` },
  accessible: { label: 'Accessible', url: `${BASE}styles/remediated.json` },
} as const;

type VariantKey = keyof typeof VARIANTS;

/** The id of the highlight layer this app adds on top of the demo style. */
const HIGHLIGHT_LAYER = 'carto-a11y-highlight';

interface Bbox {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** What `unit-metadata.json` knows about one map unit. */
interface UnitInfo {
  fullName: string;
  age: string;
  volcano: string;
  rockType: string;
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
function unitInfo(metadata: unknown): Map<string, UnitInfo> {
  const units = new Map<string, UnitInfo>();
  if (typeof metadata !== 'object' || metadata === null) {
    return units;
  }
  const str = (value: unknown): string => (typeof value === 'string' ? value : '');
  for (const [unit, raw] of Object.entries(metadata as Record<string, unknown>)) {
    const entry = raw as Record<string, unknown> | null;
    units.set(unit, {
      fullName: str(entry?.['fullName']) || unit,
      age: str(entry?.['age']),
      volcano: str(entry?.['volcano']) || 'Hawaiʻi',
      rockType: str(entry?.['rockType']),
    });
  }
  return units;
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

/** A unit code is the short name; the full name is the tooltip. */
function codeOf(cls: MapClass): string {
  return unitOf(cls.id) ?? humaniseClassId(cls.id);
}

/** True when the panel is a sheet over the map rather than a column beside it. */
export function isSheetLayout(): boolean {
  return window.matchMedia('(max-width: 760px)').matches;
}

/**
 * Padding for any `fitBounds`, allowing for the panel.
 *
 * On a wide screen the panel sits beside the map and takes no space from it.
 * On a narrow one it is a sheet lying over the bottom of the map, so framing
 * the island against the full viewport would hide most of it behind the sheet.
 */
function framePadding(sidebar: HTMLElement): {
  top: number;
  right: number;
  bottom: number;
  left: number;
} {
  const base = { top: 24, right: 24, bottom: 24, left: 24 };
  if (!isSheetLayout()) {
    return base;
  }
  // However far up the screen the sheet currently reaches is how much of the
  // map it hides, whether it is peeking or fully up.
  const covered = Math.max(0, window.innerHeight - sidebar.getBoundingClientRect().top);
  return { ...base, top: 56, bottom: Math.round(covered) + 16 };
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
 * State
 * ------------------------------------------------------------------ */

/** One version of the map, with its own audit. */
interface Variant extends AuditView {
  key: VariantKey;
  label: string;
  style: unknown;
}

interface DemoState {
  variants: Variant[];
  active: VariantKey;
  bounds: Map<string, Bbox>;
  /** Name, age, volcano and rock type per map unit. */
  units: Map<string, UnitInfo>;
  /** The source GeoJSON, kept so the palette can be exported with it. */
  geojson: unknown;
  /** The mode the shell is previewing, so the popup can follow it. */
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
  units: ReadonlyMap<string, UnitInfo>,
): Variant {
  const background = extractBackground(style);
  const classes = extractClasses(style).map((cls) => {
    const unit = unitOf(cls.id);
    const name = unit === undefined ? undefined : units.get(unit)?.fullName;
    if (name !== undefined && name !== '') {
      cls.displayName = name;
    }
    return cls;
  });
  return { key, label, style, ...auditView(classes, background) };
}

/* ------------------------------------------------------------------ *
 * The demo
 * ------------------------------------------------------------------ */

export interface DemoOptions {
  mapEl: HTMLElement;
  sidebar: HTMLElement;
  /** Ask the shell to render again, after the demo has changed its state. */
  rerender: () => void;
  /** The "audit your own map" call to action takes the reader to the other tab. */
  onAuditOwnMap: () => void;
}

export interface Demo {
  view(mode: VisionMode): ModeView;
}

async function loadJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${String(response.status)}`);
  }
  return response.json();
}

/**
 * Load the demo's data and style, put a map on the page, and audit it.
 *
 * @throws If the style or the geology cannot be fetched. The shell reports
 *   that in the demo tab and leaves the upload tab working.
 */
export async function createDemo(options: DemoOptions): Promise<Demo> {
  const [units, baseline, metadata] = await Promise.all([
    loadJson(UNITS_URL),
    loadJson(VARIANTS.original.url),
    loadJson(METADATA_URL),
  ]);

  const unitsById = unitInfo(metadata);
  const variants: Variant[] = [
    buildVariant('original', VARIANTS.original.label, baseline, unitsById),
  ];

  // The remediated style is optional: without it the demo simply has nothing
  // to compare against, rather than failing to start.
  try {
    const remediated = await loadJson(VARIANTS.accessible.url);
    variants.push(
      buildVariant('accessible', VARIANTS.accessible.label, remediated, unitsById),
    );
  } catch (error) {
    console.warn('[demo] no accessible version to compare with:', error);
  }

  const state: DemoState = {
    variants,
    active: 'original',
    bounds: unitBounds(units),
    units: unitsById,
    geojson: units,
    mode: 'normal',
    activePair: undefined,
    showAllClashes: false,
  };

  const map = new MapLibreMap({
    container: options.mapEl,
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
  }).observe(options.mapEl);

  if (import.meta.env.DEV) {
    // Handy when poking at the demo from the console; never shipped.
    (globalThis as unknown as { cartoMap?: MapLibreMap }).cartoMap = map;
  }
  map.on('error', (event) => {
    // A missing glyph server or a malformed source would otherwise fail
    // silently and leave an empty blue rectangle.
    console.error('[map]', event.error?.message ?? event);
  });

  // Re-added after every style swap, since setStyle takes the old layers away.
  map.on('style.load', () => {
    addHighlightLayer(map);
  });

  attachUnitPopup(map, state);

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
        { padding: framePadding(options.sidebar), duration: 0 },
      );
    }
  });

  const selectVariant = (key: VariantKey): void => {
    if (state.active === key) {
      return;
    }
    state.active = key;
    state.activePair = undefined;
    state.showAllClashes = false;
    // Only the paint colours differ between the two, and setStyle keeps the
    // camera, so the map recolours in place rather than jumping.
    map.setStyle(current(state).style as StyleSpecification, { diff: true });
    options.rerender();
  };

  return {
    view(mode) {
      state.mode = mode;
      const variant = current(state);
      const original = state.variants.find((entry) => entry.key === 'original');

      const body: HTMLElement[] = [
        clashPanel({
          view: variant,
          label: codeOf,
          activePair: state.activePair,
          showAll: state.showAllClashes,
          onPair: (pair) => {
            state.activePair = pair;
            focusPair(map, state, pair, options.sidebar);
            options.rerender();
          },
          onToggleAll: () => {
            state.showAllClashes = !state.showAllClashes;
            options.rerender();
          },
        }),
      ];
      if (variant.key === 'accessible' && original !== undefined) {
        body.push(changedPanel(original, variant, mode), exportPanel(state));
      }
      body.push(
        ownMapPanel(options.onAuditOwnMap),
        legendPanel(state, mode),
        technicalPanel(variant, codeOf),
        aboutPanel(),
      );

      return {
        caption: 'Hawaiʻi Geological Map',
        header:
          state.variants.length > 1
            ? [
                segmented({
                  segments: state.variants.map((entry) => ({
                    key: entry.key,
                    label: entry.label,
                  })),
                  active: state.active,
                  ariaLabel: 'Which version of the map to show',
                  onSelect: selectVariant,
                }),
              ]
            : [],
        score: [
          scoreCard(
            variant,
            variant.key === 'accessible' && original !== undefined ? original : undefined,
          ),
        ],
        body,
        cover: [],
        vision: true,
      };
    },
  };
}

/* ------------------------------------------------------------------ *
 * Map interaction
 * ------------------------------------------------------------------ */

/**
 * Clicking a polygon says what it is.
 *
 * The colour shown is the one the map is painting right now, so it follows the
 * before/after switch and the vision-mode preview rather than quoting the
 * style file.
 */
function attachUnitPopup(map: MapLibreMap, state: DemoState): void {
  let popup: Popup | undefined;

  map.on('click', 'geologic-units', (event) => {
    const feature = event.features?.[0];
    const unit = feature?.properties?.['MapUnit'];
    if (typeof unit !== 'string') {
      return;
    }
    const info = state.units.get(unit);
    const variant = current(state);
    const cls = variant.classes.find((entry) => unitOf(entry.id) === unit);
    const colour =
      cls === undefined ? undefined : seenColor(cls, variant.background, state.mode);

    const node = el('div', 'popup');
    const head = el('div', 'popup-head');
    if (colour !== undefined) {
      const chip = el('span', 'popup-swatch');
      chip.style.background = rgbToHex(colour);
      head.append(chip);
    }
    head.append(el('span', 'popup-code', unit));
    node.append(head);

    const name = info?.fullName ?? unit;
    if (name !== unit) {
      node.append(el('p', 'popup-name', name));
    }
    const rows: Array<[string, string]> = [];
    if (info?.age !== undefined && info.age !== '' && info.age !== 'unknown') {
      rows.push(['Age', info.age]);
    }
    if (info?.rockType !== undefined && info.rockType !== '') {
      rows.push(['Rock', info.rockType]);
    }
    if (info?.volcano !== undefined && info.volcano !== '') {
      rows.push(['Volcano', info.volcano]);
    }
    if (rows.length > 0) {
      const list = el('dl', 'popup-rows');
      for (const [term, value] of rows) {
        list.append(el('dt', undefined, term), el('dd', undefined, value));
      }
      node.append(list);
    }

    popup?.remove();
    popup = new Popup({ closeButton: true, maxWidth: '260px', className: 'unit-popup' })
      .setLngLat(event.lngLat)
      .setDOMContent(node)
      .addTo(map);
  });

  map.on('mouseenter', 'geologic-units', () => {
    map.getCanvas().style.cursor = 'pointer';
  });
  map.on('mouseleave', 'geologic-units', () => {
    map.getCanvas().style.cursor = '';
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
    // Nothing on the map to zoom to - a line or label colour.
    return;
  }

  const box = boxes.reduce(merge);
  const bounds: LngLatBoundsLike = [
    [box.west, box.south],
    [box.east, box.north],
  ];
  const padding = framePadding(sidebar);
  map.fitBounds(bounds, {
    padding: {
      ...padding,
      top: padding.top + 32,
      right: padding.right + 32,
      left: padding.left + 32,
    },
    duration: 700,
    maxZoom: 11,
  });
}

/* ------------------------------------------------------------------ *
 * Demo-only panels
 * ------------------------------------------------------------------ */

/** The way across to the other tab, for a reader who has a style of their own. */
function ownMapPanel(onAuditOwnMap: () => void): HTMLElement {
  const section = el('section', 'panel cta');
  section.append(el('h2', 'panel-title', 'Audit your own map'));
  section.append(
    el(
      'p',
      'cta-text',
      'Have a MapLibre style of your own? Check its colours the same way - in your browser, with nothing uploaded anywhere.',
    ),
  );
  const button = el('button', 'cta-button', 'Audit your own map →');
  button.type = 'button';
  button.addEventListener('click', onAuditOwnMap);
  section.append(button);
  return section;
}

/** The remediated palette, keyed by map unit. */
function remediatedColours(state: DemoState): Map<string, string> {
  const colours = new Map<string, string>();
  for (const cls of current(state).classes) {
    const unit = unitOf(cls.id);
    if (unit !== undefined) {
      colours.set(unit, rgbToHex(cls.color));
    }
  }
  return colours;
}

/** Take the remediated style away and use it elsewhere. */
function exportPanel(state: DemoState): HTMLElement {
  const section = el('section', 'panel');
  section.append(el('h2', 'panel-title', 'Take it with you'));

  const styleButton = el('button', 'secondary-button', 'Download remediated style');
  styleButton.type = 'button';
  styleButton.addEventListener('click', () => {
    download(
      'remediated-style.json',
      `${JSON.stringify(current(state).style, null, 2)}\n`,
      'application/json',
    );
  });
  section.append(
    styleButton,
    el('p', 'secondary-hint', 'Use this style in your own MapLibre map'),
  );

  const dataButton = el('button', 'secondary-button', 'Download remediated GeoJSON');
  dataButton.type = 'button';
  dataButton.addEventListener('click', () => {
    const colours = remediatedColours(state);
    const source = state.geojson as { features?: unknown } | null;
    const features = Array.isArray(source?.features) ? source.features : [];
    const exported = {
      ...(typeof source === 'object' && source !== null ? source : {}),
      features: features.map((feature) => {
        const entry = feature as { properties?: Record<string, unknown> };
        const unit = entry.properties?.['MapUnit'];
        const colour = typeof unit === 'string' ? colours.get(unit) : undefined;
        return {
          ...entry,
          properties: {
            ...entry.properties,
            ...(colour === undefined ? {} : { remediatedColor: colour }),
          },
        };
      }),
    };
    download('remediated-units.geojson', `${JSON.stringify(exported)}\n`, 'application/geo+json');
  });
  section.append(
    dataButton,
    el('p', 'secondary-hint', 'GeoJSON with accessible colours added to each feature'),
  );
  return section;
}

/**
 * Every map unit, grouped by the volcano that built it.
 *
 * The swatches show the colours the map is painting now, so the legend
 * follows the before/after switch and the vision-mode preview rather than
 * quoting the style file.
 */
function legendPanel(state: DemoState, mode: VisionMode): HTMLElement {
  const variant = current(state);
  const byVolcano = new Map<string, MapClass[]>();

  for (const cls of variant.classes) {
    const unit = unitOf(cls.id);
    if (unit === undefined) {
      continue;
    }
    const volcano = state.units.get(unit)?.volcano ?? 'Other';
    byVolcano.set(volcano, [...(byVolcano.get(volcano) ?? []), cls]);
  }

  const body = el('div', 'legend');
  const volcanoes = [...byVolcano.keys()].sort((a, b) => a.localeCompare(b));
  for (const volcano of volcanoes) {
    const group = byVolcano.get(volcano) ?? [];
    body.append(el('p', 'legend-group', `${volcano} · ${String(group.length)}`));
    const list = el('ul', 'legend-list');
    for (const cls of group) {
      const unit = unitOf(cls.id) ?? cls.id;
      const info = state.units.get(unit);
      const item = el('li', 'legend-item');
      const chip = el('span', 'legend-swatch');
      chip.style.background = rgbToHex(seenColor(cls, variant.background, mode));
      const name = info?.fullName ?? unit;
      item.title = `${unit} — ${name}`;
      item.append(chip, el('span', 'legend-code', unit), el('span', 'legend-name', name));
      list.append(item);
    }
    body.append(list);
  }

  const count = variant.classes.filter((cls) => unitOf(cls.id) !== undefined).length;
  return disclosure(`Legend · ${String(count)} units`, body);
}
