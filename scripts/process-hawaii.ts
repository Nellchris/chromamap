#!/usr/bin/env node
/**
 * Turn the USGS Geologic Map of the State of Hawaiʻi into something a web map
 * can draw.
 *
 * Source: USGS Scientific Investigations Map 3143 (Sherrod, Sinton, Watkins
 * and Brunt, 2021), published as GeoJSON. Point this at the unpacked archive:
 *
 *     node --max-old-space-size=4096 scripts/process-hawaii.ts <dir>
 *     pnpm demo:data -- <dir>
 *
 * where <dir> holds `MapUnitPolys.json` and `DescriptionOfMapUnits.json`.
 *
 * Three things have to happen to the raw data before a browser can use it:
 *
 * 1. **Reproject.** The archive is EPSG:26904 - NAD83 / UTM zone 4N, in
 *    metres - and MapLibre wants longitude and latitude. The inverse
 *    transverse Mercator is implemented here rather than pulled in as a
 *    dependency; it is a published series and worth ~40 lines.
 * 2. **Filter.** The file covers the whole state. Only Hawaiʻi Island is
 *    wanted, which the `Island` property gives.
 * 3. **Simplify.** 5,851 Big Island features carry 837,617 vertices, far more
 *    than a z8-z12 map needs. Ramer-Douglas-Peucker thins them; again written
 *    out rather than depending on turf, which is a large tree for one
 *    function.
 *
 * Unit colours and names come from `DescriptionOfMapUnits.json`, which stores
 * the official `AreaFillRGB` for each unit - so the baseline style really is
 * the USGS palette rather than an approximation of it.
 */

import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const OUT_DIR = join(REPO_ROOT, 'demos', 'hawaii', 'data');
const OUT_GEOJSON = join(OUT_DIR, 'units.geojson');
const OUT_METADATA = join(OUT_DIR, 'unit-metadata.json');
const OUT_STYLE = join(REPO_ROOT, 'demos', 'hawaii', 'styles', 'baseline.json');

/** Vertices closer than this to a simplified line are dropped, in degrees. */
const SIMPLIFY_TOLERANCE = 0.0005;

/** Coordinates are written to this many decimals: ~1 m at this latitude. */
const COORD_DECIMALS = 5;

/** Units the source gives no fill colour for are drawn in this grey. */
const FALLBACK_COLOUR = '#cccccc';

/* ------------------------------------------------------------------ *
 * NAD83 / UTM zone 4N -> WGS84, inverse transverse Mercator
 * ------------------------------------------------------------------ */

const A = 6378137; // GRS80 semi-major axis, metres
const F = 1 / 298.257222101; // GRS80 flattening
const E2 = F * (2 - F);
const EP2 = E2 / (1 - E2);
const K0 = 0.9996;
const FALSE_EASTING = 500000;
const CENTRAL_MERIDIAN = -159; // zone 4
const DEG = 180 / Math.PI;

const E1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));
const M_DIVISOR = A * (1 - E2 / 4 - (3 * E2 ** 2) / 64 - (5 * E2 ** 3) / 256);

/**
 * Convert a UTM zone 4N easting/northing to longitude and latitude.
 *
 * Hawaiʻi Island actually sits in zone 5, and the survey still publishes it on
 * zone 4; the inverse series is exact either way, it is only the distortion
 * that grows, and that is the projection's business rather than ours.
 */
function utmToLonLat(easting: number, northing: number): [number, number] {
  const x = easting - FALSE_EASTING;
  const mu = northing / K0 / M_DIVISOR;

  const phi1 =
    mu +
    ((3 * E1) / 2 - (27 * E1 ** 3) / 32) * Math.sin(2 * mu) +
    ((21 * E1 ** 2) / 16 - (55 * E1 ** 4) / 32) * Math.sin(4 * mu) +
    ((151 * E1 ** 3) / 96) * Math.sin(6 * mu) +
    ((1097 * E1 ** 4) / 512) * Math.sin(8 * mu);

  const sinPhi1 = Math.sin(phi1);
  const cosPhi1 = Math.cos(phi1);
  const tanPhi1 = Math.tan(phi1);

  const c1 = EP2 * cosPhi1 ** 2;
  const t1 = tanPhi1 ** 2;
  const n1 = A / Math.sqrt(1 - E2 * sinPhi1 ** 2);
  const r1 = (A * (1 - E2)) / (1 - E2 * sinPhi1 ** 2) ** 1.5;
  const d = x / (n1 * K0);

  const latitude =
    phi1 -
    ((n1 * tanPhi1) / r1) *
      (d ** 2 / 2 -
        ((5 + 3 * t1 + 10 * c1 - 4 * c1 ** 2 - 9 * EP2) * d ** 4) / 24 +
        ((61 + 90 * t1 + 298 * c1 + 45 * t1 ** 2 - 252 * EP2 - 3 * c1 ** 2) * d ** 6) / 720);

  const longitude =
    CENTRAL_MERIDIAN / DEG +
    (d -
      ((1 + 2 * t1 + c1) * d ** 3) / 6 +
      ((5 - 2 * c1 + 28 * t1 - 3 * c1 ** 2 + 8 * EP2 + 24 * t1 ** 2) * d ** 5) / 120) /
      cosPhi1;

  return [longitude * DEG, latitude * DEG];
}

/* ------------------------------------------------------------------ *
 * Ramer-Douglas-Peucker
 * ------------------------------------------------------------------ */

type Position = [number, number];

/** Perpendicular distance from `point` to the segment `start`-`end`. */
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

  // Iterative rather than recursive: some rings here are tens of thousands of
  // points long and would overflow the stack.
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

/**
 * Project, thin and round one ring.
 *
 * Returns undefined when the ring has collapsed to something that is no
 * longer a polygon - which simplification will do to the smallest flows.
 */
function processRing(ring: readonly Position[], tolerance: number): Position[] | undefined {
  const projected = ring.map(([x, y]) => utmToLonLat(x, y));
  const simplified = simplifyLine(projected, tolerance);
  // A ring needs three distinct corners plus the repeated first point.
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
  // Rounding can fold neighbours together; make sure it is still a polygon.
  const distinct = new Set(rounded.map((position) => position.join(',')));
  return distinct.size >= 3 ? rounded : undefined;
}

/* ------------------------------------------------------------------ *
 * The map unit table
 * ------------------------------------------------------------------ */

/** What `DescriptionOfMapUnits.json` knows about one unit. */
interface UnitMetadata {
  name: string;
  fullName: string;
  age: string;
  color: string;
  volcano: string;
}

/**
 * The description table is stored column-first, as pandas writes it:
 * `{ "MapUnit": { "0": "Qf", "1": ... }, "FullName": { "0": ... } }`.
 */
function readColumns(raw: unknown): Array<Record<string, unknown>> {
  if (typeof raw !== 'object' || raw === null) {
    return [];
  }
  const columns = Object.entries(raw as Record<string, unknown>).filter(
    (entry): entry is [string, Record<string, unknown>] =>
      typeof entry[1] === 'object' && entry[1] !== null,
  );
  const keys = new Set<string>();
  for (const [, values] of columns) {
    for (const key of Object.keys(values)) {
      keys.add(key);
    }
  }
  return [...keys].map((rowKey) => {
    const row: Record<string, unknown> = {};
    for (const [name, values] of columns) {
      row[name] = values[rowKey];
    }
    return row;
  });
}

/** "255, 235, 128" becomes "#ffeb80"; anything else becomes undefined. */
function rgbStringToHex(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const parts = value.split(',').map((part) => Number(part.trim()));
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) {
    return undefined;
  }
  return `#${parts
    .map((part) => Math.min(255, Math.max(0, Math.round(part))).toString(16).padStart(2, '0'))
    .join('')}`;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' && value !== 'None' ? value : undefined;
}

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */

const sourceDir = process.argv[2];
if (sourceDir === undefined) {
  console.error(
    'Usage: node --max-old-space-size=4096 scripts/process-hawaii.ts <HawaiiStateGeologicMap_GeoJSON dir>',
  );
  process.exit(2);
}

const polysPath = join(sourceDir, 'MapUnitPolys.json');
const dmuPath = join(sourceDir, 'DescriptionOfMapUnits.json');

console.error(`Reading ${polysPath}…`);
const polys: unknown = JSON.parse(readFileSync(polysPath, 'utf8'));
const dmuRows = readColumns(JSON.parse(readFileSync(dmuPath, 'utf8')));

const descriptions = new Map<string, { fullName?: string; age?: string; colour?: string; name?: string }>();
for (const row of dmuRows) {
  const unit = text(row['MapUnit']);
  if (unit === undefined) {
    continue;
  }
  const entry: { fullName?: string; age?: string; colour?: string; name?: string } = {};
  const fullName = text(row['FullName']);
  const age = text(row['Age']);
  const name = text(row['Name']);
  const colour = rgbStringToHex(row['AreaFillRGB']);
  if (fullName !== undefined) entry.fullName = fullName;
  if (age !== undefined) entry.age = age;
  if (name !== undefined) entry.name = name;
  if (colour !== undefined) entry.colour = colour;
  descriptions.set(unit, entry);
}
console.error(`  ${String(descriptions.size)} units described, with ${String(
  [...descriptions.values()].filter((entry) => entry.colour !== undefined).length,
)} fill colours`);

const allFeatures =
  typeof polys === 'object' && polys !== null && Array.isArray((polys as { features?: unknown }).features)
    ? ((polys as { features: unknown[] }).features as Array<Record<string, unknown>>)
    : [];

interface OutputFeature {
  type: 'Feature';
  properties: Record<string, string>;
  geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: unknown };
}

const output: OutputFeature[] = [];
const volcanoesByUnit = new Map<string, Map<string, number>>();
let positionsIn = 0;
let positionsOut = 0;
let droppedFeatures = 0;

for (const feature of allFeatures) {
  const properties = feature['properties'];
  if (typeof properties !== 'object' || properties === null) {
    continue;
  }
  const props = properties as Record<string, unknown>;
  if (!String(props['Island'] ?? '').includes('Hawai')) {
    continue;
  }
  const unit = text(props['MapUnit']);
  const geometry = feature['geometry'];
  if (unit === undefined || typeof geometry !== 'object' || geometry === null) {
    continue;
  }
  const geom = geometry as { type?: unknown; coordinates?: unknown };

  const countRing = (ring: readonly Position[]): void => {
    positionsIn += ring.length;
  };

  let processed: unknown;
  if (geom.type === 'Polygon' && Array.isArray(geom.coordinates)) {
    const rings: Position[][] = [];
    for (const ring of geom.coordinates as Array<readonly Position[]>) {
      countRing(ring);
      const next = processRing(ring, SIMPLIFY_TOLERANCE);
      if (next !== undefined) {
        rings.push(next);
        positionsOut += next.length;
      }
    }
    // Without an exterior ring there is nothing to draw.
    processed = rings.length > 0 ? rings : undefined;
  } else if (geom.type === 'MultiPolygon' && Array.isArray(geom.coordinates)) {
    const polygons: Position[][][] = [];
    for (const polygon of geom.coordinates as Array<Array<readonly Position[]>>) {
      const rings: Position[][] = [];
      for (const ring of polygon) {
        countRing(ring);
        const next = processRing(ring, SIMPLIFY_TOLERANCE);
        if (next !== undefined) {
          rings.push(next);
          positionsOut += next.length;
        }
      }
      if (rings.length > 0) {
        polygons.push(rings);
      }
    }
    processed = polygons.length > 0 ? polygons : undefined;
  }

  if (processed === undefined) {
    droppedFeatures += 1;
    continue;
  }

  const described = descriptions.get(unit) ?? {};
  const volcano = text(props['Volcano']) ?? 'Hawaiʻi';
  const counts = volcanoesByUnit.get(unit) ?? new Map<string, number>();
  counts.set(volcano, (counts.get(volcano) ?? 0) + 1);
  volcanoesByUnit.set(unit, counts);

  output.push({
    type: 'Feature',
    properties: {
      MapUnit: unit,
      FullName: described.fullName ?? described.name ?? unit,
      Age: described.age ?? text(props['AgeRange']) ?? 'unknown',
      Volcano: volcano,
      color: described.colour ?? FALLBACK_COLOUR,
    },
    geometry: {
      type: geom.type === 'Polygon' ? 'Polygon' : 'MultiPolygon',
      coordinates: processed,
    },
  });
}

/* ---- the per-unit lookup ---- */

const metadata: Record<string, UnitMetadata> = {};
const uncoloured: string[] = [];
for (const unit of [...new Set(output.map((feature) => feature.properties['MapUnit']))].sort()) {
  if (unit === undefined) {
    continue;
  }
  const described = descriptions.get(unit) ?? {};
  if (described.colour === undefined) {
    uncoloured.push(unit);
  }
  const counts = volcanoesByUnit.get(unit) ?? new Map<string, number>();
  const volcano =
    [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Hawaiʻi';
  metadata[unit] = {
    name: described.name ?? unit,
    fullName: described.fullName ?? described.name ?? unit,
    age: described.age ?? 'unknown',
    color: described.colour ?? FALLBACK_COLOUR,
    volcano,
  };
}

/* ---- the baseline style, built from the same colour table ---- */

/**
 * The USGS palette as a MapLibre style.
 *
 * Generated rather than hand-written: a 97-branch match expression kept by
 * hand would drift away from the data behind it the first time a unit
 * changed.
 */
function buildBaselineStyle(units: Record<string, UnitMetadata>): unknown {
  const match: unknown[] = ['match', ['get', 'MapUnit']];
  for (const [unit, entry] of Object.entries(units)) {
    match.push(unit, entry.color);
  }
  match.push(FALLBACK_COLOUR);

  return {
    version: 8,
    name: 'Hawaiʻi geological map — baseline',
    metadata: {
      'carto-a11y:purpose':
        'The before picture: the official USGS fill colours from SIM 3143, exactly as ' +
        'published. Readable to normal colour vision, and the subject of audit-baseline.json.',
      'carto-a11y:palette': 'AreaFillRGB from DescriptionOfMapUnits.json, SIM 3143',
      'carto-a11y:generatedBy': 'scripts/process-hawaii.ts',
    },
    center: [-155.5, 19.6],
    zoom: 8,
    bearing: 0,
    pitch: 0,
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
    sources: {
      units: {
        type: 'geojson',
        data: '../data/units.geojson',
        attribution:
          'USGS Geologic Map of the State of Hawaiʻi (SIM 3143, Sherrod and others, 2021)',
      },
    },
    layers: [
      { id: 'ocean', type: 'background', paint: { 'background-color': '#a8cbe0' } },
      { id: 'geologic-units', type: 'fill', source: 'units', paint: { 'fill-color': match } },
      {
        id: 'unit-contacts',
        type: 'line',
        source: 'units',
        paint: { 'line-color': '#6b6b6b', 'line-width': 0.5, 'line-opacity': 0.55 },
      },
      {
        id: 'unit-labels',
        type: 'symbol',
        source: 'units',
        minzoom: 10,
        layout: {
          'text-field': ['get', 'MapUnit'],
          'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
          'text-size': 11,
          'symbol-placement': 'point',
        },
        paint: {
          'text-color': '#2b2b2b',
          'text-halo-color': '#ffffff',
          'text-halo-width': 1.2,
        },
      },
    ],
  };
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(
  OUT_GEOJSON,
  `${JSON.stringify({
    type: 'FeatureCollection',
    metadata: {
      title: 'Geologic units, Hawaiʻi Island',
      source:
        'USGS Geologic Map of the State of Hawaiʻi (SIM 3143, Sherrod and others, 2021)',
      sourceFile: 'MapUnitPolys.json',
      processedBy: 'scripts/process-hawaii.ts',
      processedAt: new Date().toISOString(),
      crs: 'EPSG:4326, reprojected from EPSG:26904 (NAD83 / UTM zone 4N)',
      simplification: `Ramer-Douglas-Peucker, tolerance ${String(SIMPLIFY_TOLERANCE)} degrees`,
      note: 'Hawaiʻi Island only. Geometry is simplified for web display and is not survey accurate.',
    },
    features: output,
  })}\n`,
  'utf8',
);
writeFileSync(OUT_METADATA, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
writeFileSync(OUT_STYLE, `${JSON.stringify(buildBaselineStyle(metadata), null, 2)}\n`, 'utf8');

const sizeMb = statSync(OUT_GEOJSON).size / 1024 / 1024;
console.error(`Wrote ${OUT_GEOJSON}`);
console.error(
  `  ${String(output.length)} features, ${String(Object.keys(metadata).length)} units, ${sizeMb.toFixed(2)} MB`,
);
console.error(
  `  vertices ${String(positionsIn)} -> ${String(positionsOut)} (${((positionsOut / positionsIn) * 100).toFixed(1)}% kept)`,
);
if (droppedFeatures > 0) {
  console.error(`  ${String(droppedFeatures)} features too small to survive simplification`);
}
if (uncoloured.length > 0) {
  console.error(
    `  ${String(uncoloured.length)} units have no AreaFillRGB and fall back to ${FALLBACK_COLOUR}: ${uncoloured.join(', ')}`,
  );
}
console.error(`Wrote ${OUT_METADATA}`);
console.error(`Wrote ${OUT_STYLE}`);
