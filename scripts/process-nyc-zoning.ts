#!/usr/bin/env node
/**
 * Build the Manhattan zoning demo from New York City's own zoning data.
 *
 * Run it with Node 24 or newer, which strips the types itself:
 *
 *     node scripts/process-nyc-zoning.ts            # or: pnpm demo:nyc
 *     node scripts/process-nyc-zoning.ts raw.json   # from a cached download
 *
 * The source is the Department of City Planning's `nyzd` layer - the zoning
 * districts of the whole city - served from DCP's own ArcGIS Online
 * organisation. The city's open-data portal publishes the same layer, but its
 * edge rejects requests from outside a browser, so this reads the authoritative
 * GIS service instead.
 *
 * Three things happen here:
 *
 * 1. **Manhattan only.** The layer covers five boroughs and 5,440 polygons;
 *    the demo needs one island. There is no borough column on `nyzd`, so the
 *    borough boundary is fetched too and every polygon is tested against it.
 * 2. **Categories.** `ZONEDIST` is granular to the point of being unmappable -
 *    175 distinct codes in Manhattan alone, `M1-5/R9X` among them. They are
 *    grouped into the dozen families a zoning map is actually drawn in.
 * 3. **Simplification.** Ramer-Douglas-Peucker, as for the Hawaiʻi demo, so
 *    the file is something a browser can hold.
 *
 * @see https://www.nyc.gov/content/planning/pages/resources/datasets/zoning-tax-lot-database
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const DEMO_DIR = join(REPO_ROOT, 'demos', 'nyc-zoning');
const OUT_GEOJSON = join(DEMO_DIR, 'data', 'zones.geojson');
const OUT_METADATA = join(DEMO_DIR, 'data', 'zone-metadata.json');
const OUT_STYLE = join(DEMO_DIR, 'styles', 'baseline.json');

/** DCP's own ArcGIS organisation. */
const ARCGIS = 'https://services5.arcgis.com/GfwWNkhOj9bNBqoJ/arcgis/rest/services';
const ZONING_LAYER = `${ARCGIS}/nyzd/FeatureServer/0/query`;
const BOROUGH_LAYER = `${ARCGIS}/NYC_Borough_Boundary/FeatureServer/0/query`;

/** The service pages at 2,000 features a request. */
const PAGE_SIZE = 2000;

/** Manhattan plus a margin, to narrow the download before the exact test. */
const MANHATTAN_ENVELOPE = '-74.03,40.68,-73.90,40.89';

/**
 * Vertices closer than this to a simplified line are dropped, in degrees.
 *
 * About two metres at this latitude. Zoning follows streets, so the lines are
 * already close to straight and this costs nothing visible at zoom 12-16 while
 * taking the file well under the size a demo should ask anyone to download.
 */
const SIMPLIFY_TOLERANCE = 0.00002;

/** Decimal places kept per coordinate: ~1 m, which is finer than the source. */
const COORD_DECIMALS = 6;

const ATTRIBUTION = 'NYC Department of City Planning';

/* ------------------------------------------------------------------ *
 * Zoning categories
 *
 * The groupings and the colour families are the ones a zoning map has been
 * drawn in since the 1920s: residential in yellows, commercial in reds,
 * manufacturing in purples, parkland in green. Each family is a ramp, light to
 * dark, by intensity of use - which is exactly the convention this tool exists
 * to question, since a ramp of one hue is what dichromacy flattens first.
 * ------------------------------------------------------------------ */

interface Category {
  /** The key the style's match expression switches on. */
  readonly id: string;
  /** Short label, for a legend. */
  readonly name: string;
  /** What the category covers, for a popup. */
  readonly fullName: string;
  readonly color: string;
}

const CATEGORIES: readonly Category[] = [
  {
    id: 'R1-R2',
    name: 'Single-Family Residential',
    fullName: 'R1–R2 · Single-family detached housing',
    color: '#fffbc8',
  },
  {
    id: 'R3-R5',
    name: 'Low-Density Residential',
    fullName: 'R3–R5 · Low-density housing, up to four storeys',
    color: '#fff07f',
  },
  {
    id: 'R6-R7',
    name: 'Medium-Density Residential',
    fullName: 'R6–R7 · Medium-density apartment housing',
    color: '#ffd42a',
  },
  {
    id: 'R8-R10',
    name: 'High-Density Residential',
    fullName: 'R8–R10 · High-density apartment housing',
    color: '#ffaa00',
  },
  {
    id: 'C1-C2',
    name: 'Local Commercial',
    fullName: 'C1–C2 · Local retail serving nearby residences',
    color: '#ff9e9e',
  },
  {
    id: 'C3-C6',
    name: 'General Commercial',
    fullName: 'C3–C6 · General and central commercial districts',
    color: '#ec1c24',
  },
  {
    id: 'C7-C8',
    name: 'Commercial Amusement and Service',
    fullName: 'C7–C8 · Amusement parks and heavy service uses',
    color: '#a3151b',
  },
  {
    id: 'M1',
    name: 'Light Manufacturing',
    fullName: 'M1 · Light manufacturing, high performance standards',
    color: '#d9b3e6',
  },
  {
    id: 'M2-M3',
    name: 'Heavy Manufacturing',
    fullName: 'M2–M3 · Medium and heavy manufacturing',
    color: '#8b3fa8',
  },
  {
    id: 'MX',
    name: 'Mixed Manufacturing–Residential',
    fullName: 'MX · Special mixed use districts, such as M1-5/R9X',
    color: '#b87fd0',
  },
  {
    id: 'PARK',
    name: 'Parks and Open Space',
    fullName: 'Public parks and open space',
    color: '#a3d977',
  },
  {
    id: 'BPC',
    name: 'Battery Park City',
    fullName: 'Battery Park City Authority jurisdiction',
    color: '#4fb3a5',
  },
];

const FALLBACK: Category = {
  id: 'OTHER',
  name: 'Other district',
  fullName: 'A district outside the usual families',
  color: '#cccccc',
};

/**
 * Which family a zoning district belongs to.
 *
 * A code carrying a slash is a Special Mixed Use District - manufacturing and
 * residential on the same block - and is its own category rather than being
 * filed under whichever half happens to come first.
 */
function categorise(zonedist: string): string {
  const code = zonedist.trim().toUpperCase();
  if (code === '') {
    return FALLBACK.id;
  }
  if (code.startsWith('PARK')) {
    return 'PARK';
  }
  if (code.startsWith('BPC')) {
    return 'BPC';
  }
  if (code.includes('/')) {
    return 'MX';
  }

  const match = /^([RCM])(\d+)/.exec(code);
  if (match === null) {
    return FALLBACK.id;
  }
  const family = match[1];
  const number = Number(match[2]);

  if (family === 'R') {
    if (number <= 2) return 'R1-R2';
    if (number <= 5) return 'R3-R5';
    if (number <= 7) return 'R6-R7';
    return 'R8-R10';
  }
  if (family === 'C') {
    if (number <= 2) return 'C1-C2';
    if (number <= 6) return 'C3-C6';
    return 'C7-C8';
  }
  return number <= 1 ? 'M1' : 'M2-M3';
}

/* ------------------------------------------------------------------ *
 * Ramer-Douglas-Peucker
 *
 * The same thinning the Hawaiʻi demo uses, minus the projection step: this
 * source already comes back in WGS84.
 * ------------------------------------------------------------------ */

type Position = [number, number];

function segmentDistance(point: Position, start: Position, end: Position): number {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  if (dx === 0 && dy === 0) {
    return Math.hypot(point[0] - start[0], point[1] - start[1]);
  }
  const t = ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / (dx * dx + dy * dy);
  const clamped = Math.max(0, Math.min(1, t));
  return Math.hypot(point[0] - (start[0] + clamped * dx), point[1] - (start[1] + clamped * dy));
}

/** Thin a polyline, keeping its ends and anything further than `tolerance`. */
function simplifyLine(points: readonly Position[], tolerance: number): Position[] {
  if (points.length <= 2) {
    return [...points];
  }
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  // Iterative rather than recursive, so a long ring cannot overflow the stack.
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length > 0) {
    const span = stack.pop();
    if (span === undefined) {
      break;
    }
    const [first, last] = span;
    const start = points[first];
    const end = points[last];
    if (start === undefined || end === undefined) {
      continue;
    }
    let farthest = -1;
    let farthestDistance = tolerance;
    for (let index = first + 1; index < last; index += 1) {
      const point = points[index];
      if (point === undefined) {
        continue;
      }
      const distance = segmentDistance(point, start, end);
      if (distance > farthestDistance) {
        farthest = index;
        farthestDistance = distance;
      }
    }
    if (farthest !== -1) {
      keep[farthest] = 1;
      stack.push([first, farthest], [farthest, last]);
    }
  }

  return points.filter((_, index) => keep[index] === 1);
}

function round(value: number): number {
  return Number(value.toFixed(COORD_DECIMALS));
}

/** Thin and round one ring, or drop it if it has stopped being a polygon. */
function processRing(ring: readonly Position[]): Position[] | undefined {
  const simplified = simplifyLine(ring, SIMPLIFY_TOLERANCE);
  if (simplified.length < 4) {
    return undefined;
  }
  const rounded: Position[] = simplified.map(([lon, lat]) => [round(lon), round(lat)]);
  const first = rounded[0];
  const last = rounded[rounded.length - 1];
  if (first === undefined || last === undefined) {
    return undefined;
  }
  if (first[0] !== last[0] || first[1] !== last[1]) {
    rounded.push([first[0], first[1]]);
  }
  const distinct = new Set(rounded.map((position) => position.join(',')));
  return distinct.size >= 3 ? rounded : undefined;
}

/* ------------------------------------------------------------------ *
 * Geometry helpers
 * ------------------------------------------------------------------ */

/** Even-odd ray casting against one polygon, holes included. */
function inPolygon(point: Position, rings: readonly (readonly Position[])[]): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
      const a = ring[index];
      const b = ring[previous];
      if (a === undefined || b === undefined) {
        continue;
      }
      const crosses = a[1] > point[1] !== b[1] > point[1];
      if (
        crosses &&
        point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]
      ) {
        inside = !inside;
      }
    }
  }
  return inside;
}

/** Every ring of a Polygon or MultiPolygon, flattened to one list per polygon. */
function polygonsOf(geometry: unknown): Array<readonly (readonly Position[])[]> {
  const shape = geometry as { type?: string; coordinates?: unknown };
  if (shape.type === 'Polygon') {
    return [shape.coordinates as readonly (readonly Position[])[]];
  }
  if (shape.type === 'MultiPolygon') {
    return (shape.coordinates as Array<readonly (readonly Position[])[]>).slice();
  }
  return [];
}

/** The mean of a ring's vertices: good enough to say which island this is on. */
function centroid(rings: readonly (readonly Position[])[]): Position | undefined {
  const outer = rings[0];
  if (outer === undefined || outer.length === 0) {
    return undefined;
  }
  let x = 0;
  let y = 0;
  for (const [lon, lat] of outer) {
    x += lon;
    y += lat;
  }
  return [x / outer.length, y / outer.length];
}

/* ------------------------------------------------------------------ *
 * Fetching
 * ------------------------------------------------------------------ */

interface GeoJsonFeature {
  type: 'Feature';
  properties: Record<string, unknown>;
  geometry: unknown;
}

async function getJson(url: string, params: Record<string, string>): Promise<unknown> {
  const query = new URLSearchParams(params).toString();
  const response = await fetch(`${url}?${query}`, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${String(response.status)}`);
  }
  return response.json();
}

/** Manhattan's outline, as the polygons to test every zoning district against. */
async function fetchManhattan(): Promise<Array<readonly (readonly Position[])[]>> {
  const data = await getJson(BOROUGH_LAYER, {
    where: "BoroName = 'Manhattan'",
    outFields: 'BoroName',
    returnGeometry: 'true',
    outSR: '4326',
    f: 'geojson',
  });
  const features = (data as { features?: GeoJsonFeature[] }).features ?? [];
  const polygons = features.flatMap((feature) => polygonsOf(feature.geometry));
  if (polygons.length === 0) {
    throw new Error('the borough service returned no geometry for Manhattan');
  }
  return polygons;
}

/** Every zoning district whose envelope touches Manhattan, in pages of 2,000. */
async function fetchZoningDistricts(): Promise<GeoJsonFeature[]> {
  const all: GeoJsonFeature[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await getJson(ZONING_LAYER, {
      where: '1=1',
      geometry: MANHATTAN_ENVELOPE,
      geometryType: 'esriGeometryEnvelope',
      inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      outFields: 'ZONEDIST',
      returnGeometry: 'true',
      outSR: '4326',
      resultOffset: String(offset),
      resultRecordCount: String(PAGE_SIZE),
      f: 'geojson',
    });
    const features = (page as { features?: GeoJsonFeature[] }).features ?? [];
    all.push(...features);
    process.stderr.write(`  fetched ${String(all.length)} districts\n`);
    if (features.length < PAGE_SIZE) {
      return all;
    }
  }
}

/* ------------------------------------------------------------------ *
 * The build
 * ------------------------------------------------------------------ */

const cachedPath = process.argv[2];
const raw: GeoJsonFeature[] =
  cachedPath === undefined
    ? await (async () => {
        process.stderr.write('Fetching Manhattan zoning districts from NYC DCP…\n');
        return fetchZoningDistricts();
      })()
    : ((JSON.parse(readFileSync(cachedPath, 'utf8')) as { features: GeoJsonFeature[] })
        .features ?? []);

process.stderr.write('Fetching the borough boundary…\n');
const manhattan = await fetchManhattan();

const byCategory = new Map<string, number>();
const kept: GeoJsonFeature[] = [];
let dropped = 0;

for (const feature of raw) {
  const zonedist = feature.properties['ZONEDIST'];
  if (typeof zonedist !== 'string') {
    continue;
  }

  // The envelope reaches into four other boroughs and New Jersey; the
  // boundary itself is what says whether this district is on the island.
  const polygons = polygonsOf(feature.geometry);
  const onIsland = polygons.some((rings) => {
    const middle = centroid(rings);
    return (
      middle !== undefined && manhattan.some((borough) => inPolygon(middle, borough))
    );
  });
  if (!onIsland) {
    continue;
  }

  const simplified = polygons
    .map((rings) =>
      rings
        .map((ring) => processRing(ring))
        .filter((ring): ring is Position[] => ring !== undefined),
    )
    .filter((rings) => rings.length > 0);
  if (simplified.length === 0) {
    dropped += 1;
    continue;
  }

  const category = categorise(zonedist);
  byCategory.set(category, (byCategory.get(category) ?? 0) + 1);

  kept.push({
    type: 'Feature',
    properties: { ZoneDist: zonedist, Category: category },
    geometry:
      simplified.length === 1
        ? { type: 'Polygon', coordinates: simplified[0] }
        : { type: 'MultiPolygon', coordinates: simplified },
  });
}

if (kept.length === 0) {
  throw new Error('no Manhattan zoning districts survived processing');
}

mkdirSync(dirname(OUT_GEOJSON), { recursive: true });
mkdirSync(dirname(OUT_STYLE), { recursive: true });

writeFileSync(
  OUT_GEOJSON,
  `${JSON.stringify({ type: 'FeatureCollection', features: kept })}\n`,
  'utf8',
);

/** Only the categories the data actually contains, in the order declared. */
const present = [...CATEGORIES, FALLBACK].filter((category) =>
  byCategory.has(category.id),
);

writeFileSync(
  OUT_METADATA,
  `${JSON.stringify(
    Object.fromEntries(
      present.map((category) => [
        category.id,
        {
          name: category.name,
          fullName: category.fullName,
          color: category.color,
          districts: byCategory.get(category.id) ?? 0,
        },
      ]),
    ),
    null,
    2,
  )}\n`,
  'utf8',
);

const match: unknown[] = ['match', ['get', 'Category']];
for (const category of present) {
  match.push(category.id, category.color);
}
match.push(FALLBACK.color);

writeFileSync(
  OUT_STYLE,
  `${JSON.stringify(
    {
      version: 8,
      name: 'Manhattan zoning — baseline',
      metadata: {
        'carto-a11y:purpose':
          'New York City zoning districts for Manhattan, drawn in the colour ' +
          'families a zoning map has conventionally used: a ramp per family, ' +
          'by intensity of use.',
        'carto-a11y:source': ATTRIBUTION,
      },
      sources: {
        basemap: {
          type: 'raster',
          tiles: [
            'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
          ],
          tileSize: 256,
          maxzoom: 16,
          attribution: 'Esri, HERE, Garmin, © OpenStreetMap contributors',
        },
        zones: {
          type: 'geojson',
          data: '../data/zones.geojson',
          attribution: ATTRIBUTION,
        },
      },
      glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
      center: [-73.97, 40.78],
      zoom: 12,
      layers: [
        { id: 'backdrop', type: 'background', paint: { 'background-color': '#f2efe9' } },
        { id: 'basemap', type: 'raster', source: 'basemap', paint: { 'raster-opacity': 0.9 } },
        {
          id: 'zoning-districts',
          type: 'fill',
          source: 'zones',
          paint: { 'fill-color': match, 'fill-opacity': 0.85 },
        },
        {
          id: 'district-outlines',
          type: 'line',
          source: 'zones',
          paint: { 'line-color': '#6b6b6b', 'line-width': 0.4, 'line-opacity': 0.55 },
        },
      ],
    },
    null,
    2,
  )}\n`,
  'utf8',
);

const bytes = readFileSync(OUT_GEOJSON).byteLength;
process.stderr.write(`\nWrote ${OUT_GEOJSON}\n`);
process.stderr.write(
  `  ${String(kept.length)} districts, ${(bytes / 1024 / 1024).toFixed(2)} MB` +
    `${dropped > 0 ? `, ${String(dropped)} dropped by simplification` : ''}\n`,
);
process.stderr.write(`Wrote ${OUT_METADATA}\n`);
process.stderr.write(`Wrote ${OUT_STYLE}\n`);
for (const category of present) {
  process.stderr.write(
    `  ${category.id.padEnd(8)} ${String(byCategory.get(category.id) ?? 0).padStart(5)}  ${category.color}  ${category.name}\n`,
  );
}
