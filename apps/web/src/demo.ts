/**
 * The Hawaiʻi demo: a geological map, audited live, previewable through each
 * dichromacy, and switchable between the style as authored and a remediated
 * one.
 *
 * Everything the panel shows comes from `@carto-a11y/core` running in the
 * browser on the very style MapLibre is drawing, so what the audit says and
 * what the map shows cannot drift apart.
 */

import { Popup } from 'maplibre-gl';

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
  auditView,
  changedPanel,
  clashPanel,
  downloadsPanel,
  funFactPanel,
  scoreCard,
  seenColor,
  type AuditView,
  type ModeView,
} from './audit-view.js';
import { disclosure, download, el, toggleButton } from './dom.js';
import {
  createMap,
  fitBox,
  growBox,
  merge,
  type Bbox,
  type MapLibreMap,
  type StyleSpecification,
} from './map.js';

const BASE = import.meta.env.BASE_URL;

/** Which demo a reader has opened. */
export type DemoKey = 'hawaii' | 'nyc';

/** What one class of a demo is called, and what a popup should say about it. */
export interface ClassInfo {
  /** The readable name: "Lava flows of Mauna Loa", "Local Commercial". */
  name: string;
  /** The legend heading this class is filed under. */
  group: string;
  /** Rows for the popup, in order. */
  rows: Array<[string, string]>;
}

/**
 * Everything that differs between one real-data demo and another.
 *
 * The two demos are the same program - a style, its data, an audit of its
 * colours - and differ only in what their features are called and how their
 * metadata is shaped. Keeping that difference in one declaration rather than
 * in branches is what let the second demo cost a table rather than a rewrite.
 */
export interface DemoSpec {
  key: DemoKey;
  /** The caption over the map. */
  title: string;
  /** The line under the title on the landing page. */
  blurb: string;
  /** A handful of real colours from the palette, for the landing card. */
  preview: string[];
  /** Where this demo's files are served from, e.g. `/hawaii/`. */
  base: string;
  /** The fill layer the popups attach to. */
  layerId: string;
  /** The source id the highlight layer borrows. */
  sourceId: string;
  /** Feature property the style's match expression switches on. */
  classProperty: string;
  /** Feature property a popup shows as the short code. */
  codeProperty: string;
  /** The metadata file, keyed by class. */
  metadataFile: string;
  /** The data file, kept so the palette can be exported with it. */
  dataFile: string;
  /** Turn that metadata into the table the panel reads. */
  readInfo(raw: unknown): Map<string, ClassInfo>;
  /** What to call the GeoJSON this demo exports. */
  exportName: string;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Each entry of a metadata object, as a record. */
function entries(raw: unknown): Array<[string, Record<string, unknown>]> {
  if (typeof raw !== 'object' || raw === null) {
    return [];
  }
  return Object.entries(raw as Record<string, unknown>).map(([key, value]) => [
    key,
    (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>,
  ]);
}

export const DEMOS: Record<DemoKey, DemoSpec> = {
  hawaii: {
    key: 'hawaii',
    title: 'Hawaiʻi Geological Map',
    blurb: '97 units · Real USGS data',
    preview: ['#ffffcc', '#ffff00', '#99b3b3', '#004db3', '#ebde99', '#deb399'],
    base: `${BASE}hawaii/`,
    layerId: 'geologic-units',
    sourceId: 'units',
    classProperty: 'MapUnit',
    codeProperty: 'MapUnit',
    metadataFile: 'data/unit-metadata.json',
    dataFile: 'data/units.geojson',
    exportName: 'accessible-units.geojson',
    readInfo(raw) {
      const table = new Map<string, ClassInfo>();
      for (const [unit, entry] of entries(raw)) {
        const full = str(entry['fullName']);
        const rock = str(entry['rockType']);
        const volcano = str(entry['volcano']) || 'Hawaiʻi';
        const age = str(entry['age']);
        // Five of the 97 units have no description in the USGS table at all
        // and `fullName` is just the code repeated; rock type and volcano are
        // then the best a reader can be given.
        const name =
          full !== '' && full !== unit
            ? full
            : [rock, volcano].filter((part) => part !== '').join(', ') || unit;
        const rows: Array<[string, string]> = [];
        if (age !== '' && age !== 'unknown') {
          rows.push(['Age', age]);
        }
        if (rock !== '') {
          rows.push(['Rock', rock]);
        }
        rows.push(['Volcano', volcano]);
        table.set(unit, { name, group: volcano, rows });
      }
      return table;
    },
  },
  nyc: {
    key: 'nyc',
    title: 'Manhattan Zoning',
    blurb: '11 zone types · NYC Open Data',
    preview: ['#fff07f', '#ffd42a', '#ffaa00', '#ff9e9e', '#ec1c24', '#8b3fa8'],
    base: `${BASE}nyc-zoning/`,
    layerId: 'zoning-districts',
    sourceId: 'zones',
    classProperty: 'Category',
    codeProperty: 'ZoneDist',
    metadataFile: 'data/zone-metadata.json',
    dataFile: 'data/zones.geojson',
    exportName: 'accessible-zones.geojson',
    readInfo(raw) {
      const table = new Map<string, ClassInfo>();
      for (const [category, entry] of entries(raw)) {
        const name = str(entry['name']) || category;
        const full = str(entry['fullName']);
        const districts = entry['districts'];
        // The name is already the popup's heading; the rows say what it covers.
        const rows: Array<[string, string]> = [];
        if (full !== '') {
          rows.push(['Covers', full]);
        }
        if (typeof districts === 'number') {
          rows.push(['Districts on the island', String(districts)]);
        }
        table.set(category, { name, group: familyOf(category), rows });
      }
      return table;
    },
  },
};

/** Residential, commercial, manufacturing, open space: the legend's headings. */
function familyOf(category: string): string {
  if (category.startsWith('R')) return 'Residential';
  if (category.startsWith('C')) return 'Commercial';
  if (category.startsWith('M')) return 'Manufacturing';
  if (category === 'PARK' || category === 'BPC') return 'Open space and special districts';
  return 'Other';
}

/** Which of the two palettes the panel is showing. */
type VariantKey = 'original' | 'accessible';

/** The id of the highlight layer this app adds on top of a demo style. */
const HIGHLIGHT_LAYER = 'carto-a11y-highlight';

/* ------------------------------------------------------------------ *
 * Demo data
 * ------------------------------------------------------------------ */

/** Bounding box per class, so a clash can be zoomed to. */
function featureBounds(geojson: unknown, property: string): Map<string, Bbox> {
  const bounds = new Map<string, Bbox>();
  const features = (geojson as { features?: unknown }).features;
  if (!Array.isArray(features)) {
    return bounds;
  }

  for (const feature of features) {
    const unit = (feature as { properties?: Record<string, unknown> }).properties?.[
      property
    ];
    const coordinates = (feature as { geometry?: { coordinates?: unknown } }).geometry
      ?.coordinates;
    if (typeof unit !== 'string' || !Array.isArray(coordinates)) {
      continue;
    }
    const box = bounds.get(unit) ?? { west: 180, south: 90, east: -180, north: -90 };
    growBox(box, coordinates as readonly unknown[]);
    bounds.set(unit, box);
  }
  return bounds;
}

/**
 * `geologic-units/Qkh` names class `Qkh`; a plain layer id names nothing.
 *
 * The branch label of a match expression is the key both demos' metadata is
 * filed under - a map unit on one, a zoning category on the other.
 */
function classKey(classId: string): string | undefined {
  const slash = classId.lastIndexOf('/');
  if (slash === -1) {
    return undefined;
  }
  const key = classId.slice(slash + 1);
  return key === '' || key === 'default' ? undefined : key;
}

/**
 * What to call a class anywhere a reader is being spoken to.
 *
 * `Qk5` is what the style knows and what the map is labelled with, and it is
 * no use at all to someone reading a clash for the first time. The name from
 * the demo's metadata leads, with the key kept after it so the two can still
 * be matched up against the map.
 */
function nameOf(cls: MapClass): string {
  const key = classKey(cls.id);
  const name = humaniseClassId(cls);
  return key === undefined || name === key ? name : `${name} (${key})`;
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
  spec: DemoSpec;
  variants: Variant[];
  active: VariantKey;
  bounds: Map<string, Bbox>;
  /** What this demo's metadata says about each class. */
  info: Map<string, ClassInfo>;
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
  info: ReadonlyMap<string, ClassInfo>,
): Variant {
  const background = extractBackground(style);
  const classes = extractClasses(style).map((cls) => {
    const key_ = classKey(cls.id);
    const name = key_ === undefined ? undefined : info.get(key_)?.name;
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
  /** Which of the demos to open. */
  spec: DemoSpec;
  mapEl: HTMLElement;
  sidebar: HTMLElement;
  /** Ask the shell to render again, after the demo has changed its state. */
  rerender: () => void;
}

export interface Demo {
  view(mode: VisionMode): ModeView;
  /**
   * Take this demo's map off the page.
   *
   * Both demos draw into the same container, so the one being left has to let
   * go of it before the next one takes it; two live maps on one element leaves
   * a canvas neither of them owns.
   */
  destroy(): void;
}

/**
 * Point a style's GeoJSON source at the file that sits beside it.
 *
 * A style on disk says `../data/zones.geojson`, which is what the CLI and the
 * repo want: the two files travel together. MapLibre, though, resolves a
 * relative source against the *document*, not against the style it came from,
 * so a style served at `/nyc-zoning/styles/` would send it looking in
 * `/data/`. Rewriting the source here keeps the file portable and the map fed.
 */
function withResolvedData(style: unknown, spec: DemoSpec): unknown {
  if (typeof style !== 'object' || style === null) {
    return style;
  }
  const sources = (style as { sources?: Record<string, unknown> }).sources;
  const source = sources?.[spec.sourceId];
  if (typeof source !== 'object' || source === null) {
    return style;
  }
  const data = (source as { data?: unknown }).data;
  if (typeof data !== 'string') {
    // Already inline, or already absolute: nothing to resolve.
    return style;
  }
  return {
    ...(style as Record<string, unknown>),
    sources: {
      ...sources,
      [spec.sourceId]: { ...source, data: `${spec.base}${spec.dataFile}` },
    },
  };
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
  const { spec } = options;
  const baselineUrl = `${spec.base}styles/baseline.json`;

  const [data, baseline, metadata] = await Promise.all([
    loadJson(`${spec.base}${spec.dataFile}`),
    loadJson(baselineUrl),
    loadJson(`${spec.base}${spec.metadataFile}`),
  ]);

  const info = spec.readInfo(metadata);
  const variants: Variant[] = [
    buildVariant('original', 'Original', withResolvedData(baseline, spec), info),
  ];

  // The remediated style is optional: without it the demo simply has nothing
  // to compare against, rather than failing to start.
  try {
    const remediated = await loadJson(`${spec.base}styles/remediated.json`);
    variants.push(
      buildVariant('accessible', 'Accessible', withResolvedData(remediated, spec), info),
    );
  } catch (error) {
    console.warn('[demo] no accessible version to compare with:', error);
  }

  const state: DemoState = {
    spec,
    variants,
    active: 'original',
    bounds: featureBounds(data, spec.classProperty),
    info,
    geojson: data,
    mode: 'normal',
    activePair: undefined,
    showAllClashes: false,
  };

  const map = createMap(options.mapEl, variants[0]?.style);

  // Re-added after every style swap, since setStyle takes the old layers away.
  map.on('style.load', () => {
    addHighlightLayer(map, spec);
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
      fitBox(map, box, options.sidebar);
    }
  });

  const showVariant = (key: VariantKey): void => {
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
    destroy() {
      map.remove();
    },
    view(mode) {
      state.mode = mode;
      const variant = current(state);
      const original = state.variants.find((entry) => entry.key === 'original');

      const body: HTMLElement[] = [
        clashPanel({
          view: variant,
          label: nameOf,
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
      const accessible = state.variants.find((entry) => entry.key === 'accessible');
      if (variant.key === 'accessible' && original !== undefined) {
        body.push(changedPanel(original, variant, mode));
      }
      body.push(
        legendPanel(state, mode),
        downloadsPanel({
          source: `${spec.key}-baseline.json`,
          before: original ?? variant,
          after: accessible,
          extra:
            accessible === undefined ? [] : exportButtons(spec, accessible, state.geojson),
        }),
        funFactPanel(),
      );

      return {
        caption:
          variant.key === 'accessible'
            ? `${spec.title} · accessible palette`
            : spec.title,
        header:
          state.variants.length > 1
            ? [
                toggleButton({
                  label:
                    state.active === 'original'
                      ? 'Show accessible version'
                      : 'Show original',
                  pressed: state.active === 'accessible',
                  onToggle: () => {
                    showVariant(state.active === 'original' ? 'accessible' : 'original');
                  },
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

  map.on('click', state.spec.layerId, (event) => {
    const feature = event.features?.[0];
    const properties = feature?.properties ?? {};
    const key = properties[state.spec.classProperty];
    if (typeof key !== 'string') {
      return;
    }
    const code = properties[state.spec.codeProperty];
    const label = typeof code === 'string' && code !== '' ? code : key;
    const info = state.info.get(key);
    const variant = current(state);
    const cls = variant.classes.find((entry) => classKey(entry.id) === key);
    const colour =
      cls === undefined ? undefined : seenColor(cls, variant.background, state.mode);

    const node = el('div', 'popup');
    const head = el('div', 'popup-head');
    if (colour !== undefined) {
      const chip = el('span', 'popup-swatch');
      chip.style.background = rgbToHex(colour);
      head.append(chip);
    }
    head.append(el('span', 'popup-code', label));
    node.append(head);

    if (info !== undefined && info.name !== label) {
      node.append(el('p', 'popup-name', info.name));
    }
    const rows = info?.rows ?? [];
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

  map.on('mouseenter', state.spec.layerId, () => {
    map.getCanvas().style.cursor = 'pointer';
  });
  map.on('mouseleave', state.spec.layerId, () => {
    map.getCanvas().style.cursor = '';
  });
}

/** A thin outline layer used to pick out the two units of a clash. */
function addHighlightLayer(map: MapLibreMap, spec: DemoSpec): void {
  if (
    map.getLayer(HIGHLIGHT_LAYER) !== undefined ||
    map.getSource(spec.sourceId) === undefined
  ) {
    return;
  }
  map.addLayer({
    id: HIGHLIGHT_LAYER,
    type: 'line',
    source: spec.sourceId,
    filter: ['in', ['get', spec.classProperty], ['literal', []]],
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
  const unitA = classKey(pair.classA.id);
  const unitB = classKey(pair.classB.id);
  const boxes = [unitA, unitB]
    .filter((unit): unit is string => unit !== undefined)
    .map((unit) => state.bounds.get(unit))
    .filter((box): box is Bbox => box !== undefined);

  if (map.getLayer(HIGHLIGHT_LAYER) !== undefined) {
    const wanted = [unitA, unitB].filter((unit): unit is string => unit !== undefined);
    map.setFilter(HIGHLIGHT_LAYER, [
      'in',
      ['get', state.spec.classProperty],
      ['literal', wanted],
    ]);
  }

  if (boxes.length === 0) {
    // Nothing on the map to zoom to - a line or label colour.
    return;
  }

  fitBox(map, boxes.reduce(merge), sidebar, {
    duration: 700,
    maxZoom: 11,
    extraPadding: 32,
  });
}

/* ------------------------------------------------------------------ *
 * Demo-only panels
 * ------------------------------------------------------------------ */

/** The remediated palette, keyed by the class the data is filed under. */
function remediatedColours(variant: Variant): Map<string, string> {
  const colours = new Map<string, string>();
  for (const cls of variant.classes) {
    const unit = classKey(cls.id);
    if (unit !== undefined) {
      colours.set(unit, rgbToHex(cls.color));
    }
  }
  return colours;
}

/**
 * The demo's own two downloads, handed to the shared Downloads card.
 *
 * The style and the data go out together: a palette is only usable if whatever
 * draws the map can be told about it, and not every pipeline reads a style.
 */
function exportButtons(
  spec: DemoSpec,
  accessible: Variant,
  geojson: unknown,
): HTMLElement[] {
  const styleButton = el('button', 'secondary-button', 'Download fixed style');
  styleButton.type = 'button';
  styleButton.addEventListener('click', () => {
    download(
      'accessible-style.json',
      JSON.stringify(accessible.style, null, 2) + '\n',
      'application/json',
    );
  });

  const dataButton = el('button', 'secondary-button', 'Download fixed GeoJSON');
  dataButton.type = 'button';
  dataButton.addEventListener('click', () => {
    const colours = remediatedColours(accessible);
    const source = geojson as { features?: unknown } | null;
    const features = Array.isArray(source?.features) ? source.features : [];
    const exported = {
      ...(typeof source === 'object' && source !== null ? source : {}),
      features: features.map((feature) => {
        const entry = feature as { properties?: Record<string, unknown> };
        const unit = entry.properties?.[spec.classProperty];
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
    download(spec.exportName, `${JSON.stringify(exported)}\n`, 'application/geo+json');
  });

  return [
    styleButton,
    el('p', 'secondary-hint', 'Use this style in your own MapLibre map'),
    dataButton,
    el('p', 'secondary-hint', 'GeoJSON with accessible colours on each feature'),
  ];
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
  const byGroup = new Map<string, MapClass[]>();

  for (const cls of variant.classes) {
    const unit = classKey(cls.id);
    if (unit === undefined) {
      continue;
    }
    const group = state.info.get(unit)?.group ?? 'Other';
    byGroup.set(group, [...(byGroup.get(group) ?? []), cls]);
  }

  const body = el('div', 'legend');
  const groups = [...byGroup.keys()].sort((a, b) => a.localeCompare(b));
  for (const group of groups) {
    const members = byGroup.get(group) ?? [];
    body.append(el('p', 'legend-group', `${group} · ${String(members.length)}`));
    const list = el('ul', 'legend-list');
    for (const cls of members) {
      const unit = classKey(cls.id) ?? cls.id;
      const info = state.info.get(unit);
      const item = el('li', 'legend-item');
      const chip = el('span', 'legend-swatch');
      chip.style.background = rgbToHex(seenColor(cls, variant.background, mode));
      const name = info?.name ?? unit;
      item.title = `${unit} — ${name}`;
      item.append(chip, el('span', 'legend-code', unit), el('span', 'legend-name', name));
      list.append(item);
    }
    body.append(list);
  }

  const count = variant.classes.filter((cls) => classKey(cls.id) !== undefined).length;
  return disclosure(`Legend · ${String(count)} classes`, body);
}
