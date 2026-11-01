/**
 * Turning a GeoJSON file into a style, so it can go down the same road.
 *
 * The app already knows how to audit a MapLibre style and, when that style
 * carries its data inline, how to draw it. A bare GeoJSON file is one step
 * short of that: it has the data and no statement about colour. So rather
 * than a second pipeline beside the first, a generated style is put in front
 * of the existing one - and everything downstream, the audit, the map, the
 * remediation and the downloads, carries on as if the reader had uploaded a
 * style all along.
 *
 * The interesting question is which colours to audit, since the file may not
 * name any. In order of preference:
 *
 * 1. **The data's own.** geojson.io, GitHub and Mapbox all write simplestyle
 *    properties - `fill`, `stroke`, `marker-color` - and those are real
 *    cartographic choices somebody made, so they are what the audit is for.
 * 2. **A category.** Failing that, a property with few enough distinct values
 *    to be a classification gets a palette, and the audit then says something
 *    about the palette a reader is likely to reach for next.
 * 3. **One default.** Otherwise a single colour, and the audit has little to
 *    say - correctly, because a one-colour map cannot have a colour clash.
 *
 * This module deliberately depends on nothing but `./basemap.js`: it only
 * describes a style, and describing one should not require a renderer.
 */

import { BASEMAP_LAYER, BASEMAP_SOURCE, BASEMAP_SOURCE_ID } from './basemap.js';

/** The id the uploaded data goes in under. */
export const DATA_SOURCE_ID = 'uploaded';

/** Leaflet's default blue, which is what most of the web expects to see. */
const DEFAULT_FILL = '#3388ff';
const DEFAULT_LINE = '#333333';

/**
 * ColorBrewer Set2, eight classes.
 *
 * Qualitative and print-safe, and - the point of using it here rather than
 * inventing one - not itself free of clashes, so an audit of a generated
 * palette tells a reader something true rather than something flattering.
 */
const PALETTE = [
  '#66c2a5',
  '#fc8d62',
  '#8da0cb',
  '#e78ac3',
  '#a6d854',
  '#ffd92f',
  '#e5c494',
  '#b3b3b3',
] as const;

/** Properties worth trying as a classification, best first. */
const CATEGORY_KEYS = ['type', 'category', 'class', 'kind', 'name'] as const;

/** Above this many categories a palette stops being a legend. */
const MAX_CATEGORIES = 8;

/**
 * A ceiling on how many distinct simplestyle colours become classes.
 *
 * The audit is quadratic in the class count and remediation more so. Forty
 * colours is already a palette nobody can hold in their head; past that the
 * most-used ones are kept and the tail falls back to the default.
 */
const MAX_SIMPLESTYLE_COLOURS = 40;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/* ------------------------------------------------------------------ *
 * What kind of file is this?
 * ------------------------------------------------------------------ */

const GEOMETRY_TYPES = new Set([
  'Point',
  'MultiPoint',
  'LineString',
  'MultiLineString',
  'Polygon',
  'MultiPolygon',
  'GeometryCollection',
]);

/** A MapLibre style says so by having both halves of one. */
export function isMapLibreStyle(value: unknown): boolean {
  return isRecord(value) && 'sources' in value && 'layers' in value;
}

/** A FeatureCollection, a lone Feature, or a bare geometry. */
export function isGeoJson(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  const type = value['type'];
  if (typeof type !== 'string') {
    return false;
  }
  return type === 'FeatureCollection' || type === 'Feature' || GEOMETRY_TYPES.has(type);
}

/** Whatever shape it arrived in, as a FeatureCollection. */
export function normaliseGeoJson(value: unknown): { type: string; features: unknown[] } {
  if (!isRecord(value)) {
    return { type: 'FeatureCollection', features: [] };
  }
  const type = value['type'];
  if (type === 'FeatureCollection') {
    const features = value['features'];
    return { type: 'FeatureCollection', features: Array.isArray(features) ? features : [] };
  }
  if (type === 'Feature') {
    return { type: 'FeatureCollection', features: [value] };
  }
  return {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: {}, geometry: value }],
  };
}

/** How a collection fails to be drawable, if it does. */
export type GeoJsonProblem = 'no-features' | 'no-geometry';

export function geoJsonProblem(
  collection: { features: unknown[] },
): GeoJsonProblem | undefined {
  if (collection.features.length === 0) {
    return 'no-features';
  }
  const anyGeometry = collection.features.some(
    (feature) => isRecord(feature) && isRecord(feature['geometry']),
  );
  return anyGeometry ? undefined : 'no-geometry';
}

/* ------------------------------------------------------------------ *
 * What is in it?
 * ------------------------------------------------------------------ */

/** Which of the three drawable shapes the data contains. */
export interface Shapes {
  area: boolean;
  line: boolean;
  point: boolean;
}

export function shapesIn(collection: { features: unknown[] }): Shapes {
  const shapes: Shapes = { area: false, line: false, point: false };
  const note = (type: unknown): void => {
    if (type === 'Polygon' || type === 'MultiPolygon') {
      shapes.area = true;
    } else if (type === 'LineString' || type === 'MultiLineString') {
      shapes.line = true;
    } else if (type === 'Point' || type === 'MultiPoint') {
      shapes.point = true;
    }
  };
  const walk = (geometry: unknown): void => {
    if (!isRecord(geometry)) {
      return;
    }
    note(geometry['type']);
    const nested = geometry['geometries'];
    if (Array.isArray(nested)) {
      for (const child of nested) {
        walk(child);
      }
    }
  };
  for (const feature of collection.features) {
    if (isRecord(feature)) {
      walk(feature['geometry']);
    }
  }
  return shapes;
}

function propertiesOf(feature: unknown): Record<string, unknown> {
  return isRecord(feature) && isRecord(feature['properties']) ? feature['properties'] : {};
}

/** Distinct values of one property, most common first. */
function valuesByFrequency(
  collection: { features: unknown[] },
  key: string,
): string[] {
  const counts = new Map<string, number>();
  for (const feature of collection.features) {
    const value = propertiesOf(feature)[key];
    if (typeof value === 'string' && value !== '') {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([value]) => value);
}

/* ------------------------------------------------------------------ *
 * Where the colours come from
 * ------------------------------------------------------------------ */

export type ColourSource = 'simplestyle' | 'categorical' | 'default';

export interface ColourPlan {
  source: ColourSource;
  /** The property a match expression switches on, when there is one. */
  property?: string;
  /** What the panel tells the reader about where these colours came from. */
  note: string;
}

/** The simplestyle key each kind of layer reads. */
const SIMPLESTYLE_KEYS = {
  area: 'fill',
  line: 'stroke',
  point: 'marker-color',
} as const;

function hasSimplestyle(collection: { features: unknown[] }): boolean {
  return collection.features.some((feature) => {
    const properties = propertiesOf(feature);
    return Object.values(SIMPLESTYLE_KEYS).some(
      (key) => typeof properties[key] === 'string' && properties[key] !== '',
    );
  });
}

/** The first property that looks like a classification, if any. */
function categoryProperty(collection: { features: unknown[] }): string | undefined {
  for (const key of CATEGORY_KEYS) {
    const values = valuesByFrequency(collection, key);
    if (values.length >= 2 && values.length <= MAX_CATEGORIES) {
      return key;
    }
  }
  return undefined;
}

export function planColours(collection: { features: unknown[] }): ColourPlan {
  if (hasSimplestyle(collection)) {
    return {
      source: 'simplestyle',
      note: 'Style auto-generated from GeoJSON. The colours audited are the ones your data carries in its fill, stroke and marker-color properties.',
    };
  }
  const property = categoryProperty(collection);
  if (property !== undefined) {
    return {
      source: 'categorical',
      property,
      note: `Style auto-generated from GeoJSON. Your data carries no colours, so one was assigned per “${property}” value from a standard palette — which is what this audit is judging.`,
    };
  }
  return {
    source: 'default',
    note: 'Style auto-generated from GeoJSON. Your data carries no colours and no obvious category, so everything is drawn in one default colour.',
  };
}

/**
 * A `match` over the colours the data itself names.
 *
 * `["coalesce", ["get", "fill"], …]` would be the natural way to write this,
 * but nothing static can read a colour out of it: the audit would see the
 * fallback and nothing else, which for a file whose whole point is that it
 * carries its own colours would make the audit worthless. Matching each
 * distinct value to itself says the same thing to the renderer and leaves
 * every colour in the file visible to the auditor.
 */
function simplestyleColour(
  collection: { features: unknown[] },
  key: string,
  fallback: string,
): unknown {
  const values = valuesByFrequency(collection, key).slice(0, MAX_SIMPLESTYLE_COLOURS);
  if (values.length === 0) {
    return fallback;
  }
  const match: unknown[] = ['match', ['get', key]];
  for (const value of values) {
    match.push(value, value);
  }
  match.push(fallback);
  return match;
}

/** A `match` over a classification, painted from the standard palette. */
function categoricalColour(
  collection: { features: unknown[] },
  property: string,
  fallback: string,
): unknown {
  const values = valuesByFrequency(collection, property).slice(0, MAX_CATEGORIES);
  if (values.length === 0) {
    return fallback;
  }
  const match: unknown[] = ['match', ['get', property]];
  values.forEach((value, index) => {
    match.push(value, PALETTE[index % PALETTE.length]);
  });
  match.push(fallback);
  return match;
}

function colourFor(
  collection: { features: unknown[] },
  plan: ColourPlan,
  kind: keyof Shapes,
  fallback: string,
): unknown {
  if (plan.source === 'simplestyle') {
    return simplestyleColour(collection, SIMPLESTYLE_KEYS[kind], fallback);
  }
  if (plan.source === 'categorical' && plan.property !== undefined) {
    return categoricalColour(collection, plan.property, fallback);
  }
  return fallback;
}

/* ------------------------------------------------------------------ *
 * The style
 * ------------------------------------------------------------------ */

export interface GeneratedStyle {
  style: Record<string, unknown>;
  plan: ColourPlan;
}

/**
 * Wrap a GeoJSON file in a style that draws it.
 *
 * One layer per kind of geometry present, and nothing for the kinds that are
 * not: a file of points gets no empty polygon layer whose colour the audit
 * would then solemnly report on.
 *
 * @param data - The file, in any of the shapes GeoJSON allows.
 * @param name - What to call the style, usually the file name.
 */
export function styleFromGeoJson(data: unknown, name: string): GeneratedStyle {
  const collection = normaliseGeoJson(data);
  const shapes = shapesIn(collection);
  const plan = planColours(collection);

  const layers: Array<Record<string, unknown>> = [{ ...BASEMAP_LAYER }];

  if (shapes.area) {
    layers.push({
      id: 'uploaded-fill',
      type: 'fill',
      source: DATA_SOURCE_ID,
      filter: ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false],
      paint: {
        'fill-color': colourFor(collection, plan, 'area', DEFAULT_FILL),
        'fill-opacity': 0.85,
      },
    });
    layers.push({
      id: 'uploaded-fill-outline',
      type: 'line',
      source: DATA_SOURCE_ID,
      filter: ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false],
      paint: {
        'line-color': colourFor(collection, plan, 'line', DEFAULT_LINE),
        'line-width': 0.8,
        'line-opacity': 0.7,
      },
    });
  }

  if (shapes.line) {
    layers.push({
      id: 'uploaded-line',
      type: 'line',
      source: DATA_SOURCE_ID,
      filter: ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false],
      paint: {
        'line-color': colourFor(collection, plan, 'line', DEFAULT_LINE),
        'line-width': 2,
      },
    });
  }

  if (shapes.point) {
    layers.push({
      id: 'uploaded-point',
      type: 'circle',
      source: DATA_SOURCE_ID,
      filter: ['match', ['geometry-type'], ['Point', 'MultiPoint'], true, false],
      paint: {
        'circle-color': colourFor(collection, plan, 'point', DEFAULT_FILL),
        'circle-radius': 6,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1,
      },
    });
  }

  return {
    style: {
      version: 8,
      name,
      metadata: { 'carto-a11y:generatedFrom': 'GeoJSON upload' },
      sources: {
        [BASEMAP_SOURCE_ID]: BASEMAP_SOURCE,
        [DATA_SOURCE_ID]: { type: 'geojson', data: collection },
      },
      layers,
    },
    plan,
  };
}
