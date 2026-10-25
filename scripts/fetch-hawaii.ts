#!/usr/bin/env node
/**
 * Produce geological unit polygons for Hawai'i Island (the Big Island) at
 * `demos/hawaii/data/units.geojson`.
 *
 * Run it with Node 24 or newer, which strips the types itself:
 *
 *     node scripts/fetch-hawaii.ts            # or: pnpm demo:data
 *
 * Sources are tried in order and the first one that answers wins:
 *
 * 1. The USGS National Geologic Map Database MapView ArcGIS REST service.
 * 2. The USGS ScienceBase item for SIM 3143, the Hawai'i state geologic map.
 * 3. A representative synthetic dataset, built here.
 *
 * As of October 2026 neither remote source is usable from a plain HTTP client:
 * `ngmdb.usgs.gov/mapview/rest/services` redirects to a 404 page, ScienceBase
 * sits behind a Cloudflare interstitial that returns 403 to non-browsers, and
 * the one USGS geology service that does answer (the State Geologic Map
 * Compilation at mrdata.usgs.gov) speaks WMS only - raster tiles, not the
 * polygons an audit needs. So in practice this script synthesises, and says so
 * both on stderr and in the file's own metadata.
 *
 * The synthetic data is a *representative* geological map, not a real one. It
 * has the right shape for the job - fifteen units with USGS-style labels, ages
 * and colours, tiling the island by volcano and by flow age - which is what
 * the accessibility audit exercises. Swap in real polygons when a machine
 * readable source is available; nothing downstream depends on how it was made.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const OUTPUT = join(REPO_ROOT, 'demos', 'hawaii', 'data', 'units.geojson');

const FETCH_TIMEOUT_MS = 12_000;
const USER_AGENT = 'carto-a11y-studio/0.0.0 (geological map accessibility audit)';

/* ------------------------------------------------------------------ *
 * GeoJSON types - just enough of RFC 7946 for what this writes.
 * ------------------------------------------------------------------ */

type Position = [number, number];
type LinearRing = Position[];

interface UnitProperties {
  /** Map label, e.g. `Qku`. */
  unit: string;
  /** Full unit name. */
  name: string;
  /** Age as a geologist would write it. */
  age: string;
  /** Which volcano the unit belongs to. */
  volcano: string;
  /** 1 = youngest. Handy for ordering a legend. */
  ageRank: number;
}

interface UnitFeature {
  type: 'Feature';
  properties: UnitProperties;
  geometry: { type: 'Polygon'; coordinates: LinearRing[] };
}

interface UnitCollection {
  type: 'FeatureCollection';
  metadata: Record<string, unknown>;
  features: UnitFeature[];
}

/* ------------------------------------------------------------------ *
 * Remote sources
 * ------------------------------------------------------------------ */

async function probe(url: string): Promise<Response | undefined> {
  try {
    const response = await fetch(url, {
      headers: { 'user-agent': USER_AGENT, accept: 'application/json,*/*' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      console.error(`  ${url}\n    -> HTTP ${String(response.status)}`);
      return undefined;
    }
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`  ${url}\n    -> ${message}`);
    return undefined;
  }
}

/**
 * Ask the NGMDB MapView ArcGIS REST service for a Hawai'i geologic layer.
 *
 * Walks the service directory looking for a layer whose name mentions Hawaii,
 * then queries it for GeoJSON. Returns undefined if the service directory is
 * not there, which is the situation today.
 */
async function tryNgmdb(): Promise<UnitFeature[] | undefined> {
  console.error('Trying USGS NGMDB MapView ArcGIS REST…');
  const root = await probe('https://ngmdb.usgs.gov/mapview/rest/services?f=json');
  if (root === undefined) {
    return undefined;
  }
  const catalog: unknown = await root.json().catch(() => undefined);
  if (typeof catalog !== 'object' || catalog === null || !('services' in catalog)) {
    console.error('    -> no service directory in the response');
    return undefined;
  }
  const services = (catalog as { services?: unknown }).services;
  if (!Array.isArray(services)) {
    console.error('    -> service list was not an array');
    return undefined;
  }
  const hawaii = services.find((service) => {
    const name = (service as { name?: unknown }).name;
    return typeof name === 'string' && /hawaii|hi_/i.test(name);
  });
  if (hawaii === undefined) {
    console.error('    -> no Hawai‘i layer in the service list');
    return undefined;
  }
  const name = (hawaii as { name: string }).name;
  const query =
    `https://ngmdb.usgs.gov/mapview/rest/services/${name}/MapServer/0/query` +
    '?where=1%3D1&outFields=*&f=geojson&outSR=4326';
  const response = await probe(query);
  if (response === undefined) {
    return undefined;
  }
  const collection: unknown = await response.json().catch(() => undefined);
  return normaliseRemote(collection);
}

/**
 * Ask ScienceBase for the SIM 3143 item and any GeoJSON attached to it.
 *
 * Returns undefined when ScienceBase answers with its bot interstitial, which
 * is what it does for anything that is not a browser.
 */
async function trySciencebase(): Promise<UnitFeature[] | undefined> {
  console.error('Trying USGS ScienceBase for SIM 3143…');
  const search = await probe(
    'https://www.sciencebase.gov/catalog/items?q=SIM%203143%20Hawaii%20geologic&format=json&max=5',
  );
  if (search === undefined) {
    return undefined;
  }
  const payload: unknown = await search.json().catch(() => undefined);
  const items =
    typeof payload === 'object' && payload !== null && 'items' in payload
      ? (payload as { items?: unknown }).items
      : undefined;
  if (!Array.isArray(items) || items.length === 0) {
    console.error('    -> no catalogue items matched');
    return undefined;
  }
  for (const item of items) {
    const id = (item as { id?: unknown }).id;
    if (typeof id !== 'string') {
      continue;
    }
    const response = await probe(
      `https://www.sciencebase.gov/catalog/item/${id}?format=json&fields=files,webLinks`,
    );
    if (response === undefined) {
      continue;
    }
    const detail: unknown = await response.json().catch(() => undefined);
    const files = (detail as { files?: unknown }).files;
    if (!Array.isArray(files)) {
      continue;
    }
    const geojson = files.find((file) => {
      const fileName = (file as { name?: unknown }).name;
      return typeof fileName === 'string' && fileName.toLowerCase().endsWith('.geojson');
    });
    const url = (geojson as { url?: unknown } | undefined)?.url;
    if (typeof url !== 'string') {
      continue;
    }
    const data = await probe(url);
    if (data === undefined) {
      continue;
    }
    const collection: unknown = await data.json().catch(() => undefined);
    const features = normaliseRemote(collection);
    if (features !== undefined) {
      return features;
    }
  }
  console.error('    -> no GeoJSON attachment found');
  return undefined;
}

/** Map whatever a remote service returns onto this file's property names. */
function normaliseRemote(collection: unknown): UnitFeature[] | undefined {
  if (
    typeof collection !== 'object' ||
    collection === null ||
    !('features' in collection) ||
    !Array.isArray((collection as { features: unknown }).features)
  ) {
    return undefined;
  }
  const raw = (collection as { features: unknown[] }).features;
  const features: UnitFeature[] = [];
  for (const entry of raw) {
    const properties = (entry as { properties?: Record<string, unknown> }).properties ?? {};
    const geometry = (entry as { geometry?: unknown }).geometry;
    if (
      typeof geometry !== 'object' ||
      geometry === null ||
      (geometry as { type?: unknown }).type !== 'Polygon'
    ) {
      continue;
    }
    const pick = (...keys: string[]): string => {
      for (const key of keys) {
        const value = properties[key];
        if (typeof value === 'string' && value !== '') {
          return value;
        }
      }
      return 'unknown';
    };
    features.push({
      type: 'Feature',
      properties: {
        unit: pick('UNIT_LINK', 'unit', 'MAP_UNIT', 'label', 'SYMBOL'),
        name: pick('UNIT_NAME', 'name', 'UNITNAME', 'description'),
        age: pick('UNIT_AGE', 'age', 'AGE', 'MIN_AGE'),
        volcano: pick('VOLCANO', 'volcano', 'PROVINCE'),
        ageRank: 0,
      },
      geometry: geometry as UnitFeature['geometry'],
    });
  }
  return features.length > 0 ? features : undefined;
}

/* ------------------------------------------------------------------ *
 * Synthetic dataset
 * ------------------------------------------------------------------ */

/**
 * An approximate coastline of Hawai'i Island, clockwise from Upolu Point.
 *
 * Roughly 40 points traced from the island's real outline: enough for the
 * shape to be recognisable - Hilo bay, Cape Kumukahi in the east, Ka Lae at
 * the southern tip, the Kona coast running back up the west side.
 */
const COASTLINE: Position[] = [
  [-155.88, 20.267], // Upolu Point, the northern tip
  [-155.8, 20.24],
  [-155.72, 20.2],
  [-155.61, 20.11],
  [-155.47, 20.03],
  [-155.35, 19.97],
  [-155.23, 19.91],
  [-155.14, 19.83],
  [-155.06, 19.74], // Hilo
  [-155.0, 19.66],
  [-154.93, 19.6],
  [-154.85, 19.55],
  [-154.81, 19.52], // Cape Kumukahi, the eastern tip
  [-154.84, 19.45],
  [-154.92, 19.37],
  [-155.03, 19.3],
  [-155.15, 19.25],
  [-155.28, 19.18],
  [-155.4, 19.11],
  [-155.52, 19.03],
  [-155.62, 18.95],
  [-155.68, 18.91], // Ka Lae, the southern tip
  [-155.76, 18.95],
  [-155.84, 19.02],
  [-155.88, 19.12],
  [-155.9, 19.22],
  [-155.92, 19.32],
  [-155.95, 19.42],
  [-155.97, 19.52],
  [-156.01, 19.62],
  [-156.06, 19.72], // Keāhole Point, the western tip
  [-156.03, 19.8],
  [-155.99, 19.88],
  [-155.93, 19.96],
  [-155.89, 20.05],
  [-155.87, 20.14],
  [-155.88, 20.2],
];

/** A unit that fills an annulus of its volcano's territory. */
interface BandUnit {
  code: string;
  name: string;
  age: string;
  ageRank: number;
  /** Inner and outer radius, as a fraction of the distance to the territory edge. */
  from: number;
  to: number;
  /** Filled in when the unit is attached to a volcano. */
  volcano?: string;
}

/** A unit that follows a rift zone: a wedge running out from the summit. */
interface SectorUnit extends BandUnit {
  /** Compass-free angles, degrees counterclockwise from east. */
  fromAngle: number;
  toAngle: number;
}

interface Volcano {
  name: string;
  summit: Position;
  bands: BandUnit[];
  sectors: SectorUnit[];
}

/** Where the coastal fringe starts, as a fraction of the territory radius. */
const COAST_FRACTION = 0.96;

const ALLUVIUM: BandUnit = {
  code: 'Qa',
  name: 'Alluvium and beach deposits',
  age: 'Holocene',
  ageRank: 1,
  from: COAST_FRACTION,
  to: 1,
};

/**
 * The five shield volcanoes that built the island, youngest work outward from
 * each summit the way a real shield is mapped: recent flows near the vents and
 * on the rift zones, older shield-stage lavas on the lower flanks.
 */
const VOLCANOES: Volcano[] = [
  {
    name: 'Kīlauea',
    summit: [-155.287, 19.421],
    sectors: [
      {
        code: 'Qkh',
        name: 'Kīlauea historical flows, East Rift Zone',
        age: 'Historical (1790–2018)',
        ageRank: 1,
        from: 0,
        to: COAST_FRACTION,
        fromAngle: -2,
        toAngle: 28,
      },
      {
        code: 'Qksw',
        name: 'Kīlauea Southwest Rift Zone flows',
        age: 'Historical to late Holocene',
        ageRank: 2,
        from: 0,
        to: COAST_FRACTION,
        fromAngle: 212,
        toAngle: 244,
      },
    ],
    bands: [
      {
        code: 'Qkp',
        name: 'Puna Basalt, Kīlauea',
        age: 'Holocene (<10 ka)',
        ageRank: 3,
        from: 0,
        to: 0.6,
      },
      {
        code: 'Qkhi',
        name: 'Hilina Basalt, Kīlauea',
        age: 'Pleistocene (10–100 ka)',
        ageRank: 6,
        from: 0.6,
        to: COAST_FRACTION,
      },
    ],
  },
  {
    name: 'Mauna Loa',
    summit: [-155.608, 19.475],
    sectors: [
      {
        code: 'Qmlh',
        name: 'Mauna Loa historical flows',
        age: 'Historical (1843–1984)',
        ageRank: 1,
        from: 0,
        to: COAST_FRACTION,
        fromAngle: 34,
        toAngle: 62,
      },
      {
        code: 'Qmlh',
        name: 'Mauna Loa historical flows',
        age: 'Historical (1843–1984)',
        ageRank: 1,
        from: 0,
        to: COAST_FRACTION,
        fromAngle: 206,
        toAngle: 236,
      },
    ],
    bands: [
      {
        code: 'Qku',
        name: 'Kaʻū Basalt, Mauna Loa',
        age: 'Holocene (<10 ka)',
        ageRank: 3,
        from: 0,
        to: 0.55,
      },
      {
        code: 'Qkk',
        name: 'Kahuku Basalt, Mauna Loa',
        age: 'Pleistocene (10–100 ka)',
        ageRank: 6,
        from: 0.55,
        to: 0.82,
      },
      {
        code: 'Qni',
        name: 'Nīnole Basalt, Mauna Loa',
        age: 'Pleistocene (100–200 ka)',
        ageRank: 8,
        from: 0.82,
        to: COAST_FRACTION,
      },
    ],
  },
  {
    name: 'Hualālai',
    summit: [-155.871, 19.692],
    sectors: [
      {
        code: 'Qhu1801',
        name: 'Hualālai flows of 1800–01',
        age: 'Historical (1800–01)',
        ageRank: 1,
        from: 0,
        to: COAST_FRACTION,
        fromAngle: 124,
        toAngle: 162,
      },
    ],
    bands: [
      {
        code: 'Qhv',
        name: 'Hualālai Volcanics',
        age: 'Holocene to late Pleistocene (<14 ka)',
        ageRank: 4,
        from: 0,
        to: COAST_FRACTION,
      },
    ],
  },
  {
    name: 'Mauna Kea',
    summit: [-155.468, 19.821],
    sectors: [],
    bands: [
      {
        code: 'Qlp',
        name: 'Laupāhoehoe Volcanics, Mauna Kea',
        age: 'Pleistocene (65–4 ka)',
        ageRank: 5,
        from: 0,
        to: 0.4,
      },
      {
        code: 'Qhm',
        name: 'Hāmākua Volcanics, Mauna Kea',
        age: 'Pleistocene (250–65 ka)',
        ageRank: 7,
        from: 0.4,
        to: COAST_FRACTION,
      },
    ],
  },
  {
    name: 'Kohala',
    summit: [-155.717, 20.086],
    sectors: [],
    bands: [
      {
        code: 'Qhw',
        name: 'Hāwī Volcanics, Kohala',
        age: 'Pleistocene (260–140 ka)',
        ageRank: 9,
        from: 0,
        to: 0.45,
      },
      {
        code: 'Qpl',
        name: 'Pololū Volcanics, Kohala',
        age: 'Pleistocene (780–460 ka)',
        ageRank: 10,
        from: 0.45,
        to: COAST_FRACTION,
      },
    ],
  },
];

/* --- a local flat metric, so the geometry can be plain Euclidean --- */

const LAT0 = 19.6;
const LON0 = -155.5;
const COS_LAT = Math.cos((LAT0 * Math.PI) / 180);

function toPlane(position: Position): Position {
  return [(position[0] - LON0) * COS_LAT, position[1] - LAT0];
}

function toGeo(point: Position): Position {
  return [
    Number((LON0 + point[0] / COS_LAT).toFixed(5)),
    Number((LAT0 + point[1]).toFixed(5)),
  ];
}

function cross(a: Position, b: Position): number {
  return a[0] * b[1] - a[1] * b[0];
}

/** Distance from `origin` along `direction` to the first coastline crossing. */
function distanceToCoast(origin: Position, direction: Position, coast: Position[]): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (let index = 0; index < coast.length; index += 1) {
    const a = coast[index];
    const b = coast[(index + 1) % coast.length];
    if (a === undefined || b === undefined) {
      continue;
    }
    const edge: Position = [b[0] - a[0], b[1] - a[1]];
    const denominator = cross(direction, edge);
    if (Math.abs(denominator) < 1e-12) {
      continue;
    }
    const offset: Position = [a[0] - origin[0], a[1] - origin[1]];
    const t = cross(offset, edge) / denominator;
    const s = cross(offset, direction) / denominator;
    if (t > 0 && s >= 0 && s <= 1 && t < nearest) {
      nearest = t;
    }
  }
  return nearest;
}

/**
 * Distance along the ray to the point where another volcano takes over.
 *
 * The boundary between two summits is their perpendicular bisector, so this is
 * a plain Voronoi partition: every point belongs to the nearest volcano. With
 * the real summit positions that lands surprisingly close to the real map -
 * Mauna Loa takes the centre and south, Kīlauea the southeast, Kohala the
 * northern tip.
 */
function distanceToNeighbour(
  summit: Position,
  direction: Position,
  others: readonly Position[],
): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (const other of others) {
    const delta: Position = [other[0] - summit[0], other[1] - summit[1]];
    const along = direction[0] * delta[0] + direction[1] * delta[1];
    if (along <= 1e-12) {
      continue;
    }
    const t = (delta[0] * delta[0] + delta[1] * delta[1]) / (2 * along);
    if (t > 0 && t < nearest) {
      nearest = t;
    }
  }
  return nearest;
}

/** Angles are sampled this finely, in degrees. */
const ANGLE_STEP = 2;

function direction(degrees: number): Position {
  const radians = (degrees * Math.PI) / 180;
  return [Math.cos(radians), Math.sin(radians)];
}

function normaliseAngle(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

/** The angles in [0, 360) that no rift-zone sector claims, as intervals. */
function bandIntervals(sectors: readonly SectorUnit[]): Array<[number, number]> {
  if (sectors.length === 0) {
    return [[0, 360]];
  }
  const taken = sectors
    .map((sector): [number, number] => [
      normaliseAngle(sector.fromAngle),
      normaliseAngle(sector.toAngle),
    ])
    .flatMap(([from, to]): Array<[number, number]> =>
      // A wedge that straddles 0° becomes two intervals.
      from <= to ? [[from, to]] : [
        [from, 360],
        [0, to],
      ],
    )
    .sort((a, b) => a[0] - b[0]);

  const free: Array<[number, number]> = [];
  let cursor = 0;
  for (const [from, to] of taken) {
    if (from > cursor) {
      free.push([cursor, from]);
    }
    cursor = Math.max(cursor, to);
  }
  if (cursor < 360) {
    free.push([cursor, 360]);
  }
  return free.filter(([from, to]) => to - from > ANGLE_STEP / 2);
}

/** Sample an angular interval, always hitting both ends. */
function sampleAngles(from: number, to: number): number[] {
  const angles: number[] = [];
  for (let angle = from; angle < to; angle += ANGLE_STEP) {
    angles.push(angle);
  }
  angles.push(to);
  return angles;
}

/** Signed area, used to get RFC 7946 ring winding right. */
function signedArea(ring: readonly Position[]): number {
  let total = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const a = ring[index];
    const b = ring[(index + 1) % ring.length];
    if (a === undefined || b === undefined) {
      continue;
    }
    total += a[0] * b[1] - b[0] * a[1];
  }
  return total / 2;
}

function close(ring: Position[]): LinearRing {
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first !== undefined && last !== undefined && (first[0] !== last[0] || first[1] !== last[1])) {
    ring.push([first[0], first[1]]);
  }
  return ring;
}

/**
 * Build one unit polygon: the patch of a volcano's territory between two
 * radius fractions, over one angular interval.
 *
 * A full-circle band with a hollow middle becomes a polygon with an interior
 * ring; everything else is a single ring.
 */
function buildPatch(
  summit: Position,
  reach: (angle: number) => number,
  unit: BandUnit,
  fromAngle: number,
  toAngle: number,
): UnitFeature | undefined {
  const angles = sampleAngles(fromAngle, toAngle);
  const fullCircle = toAngle - fromAngle >= 360 - 1e-9;

  const at = (angle: number, fraction: number): Position => {
    const d = direction(angle);
    const r = reach(angle) * fraction;
    return [summit[0] + d[0] * r, summit[1] + d[1] * r];
  };

  if (fullCircle && unit.from > 0) {
    const outer = close(angles.map((angle) => at(angle, unit.to)));
    const inner = close(angles.map((angle) => at(angle, unit.from)).reverse());
    const exterior = signedArea(outer) < 0 ? outer.reverse() : outer;
    const hole = signedArea(inner) > 0 ? inner.reverse() : inner;
    return feature(unit, [exterior.map(toGeo), hole.map(toGeo)]);
  }

  const ring: Position[] = angles.map((angle) => at(angle, unit.to));
  if (unit.from > 0) {
    for (const angle of [...angles].reverse()) {
      ring.push(at(angle, unit.from));
    }
  } else if (!fullCircle) {
    ring.push([summit[0], summit[1]]);
  }
  const closed = close(ring);
  const exterior = signedArea(closed) < 0 ? closed.reverse() : closed;
  return feature(unit, [exterior.map(toGeo)]);
}

function feature(unit: BandUnit, coordinates: LinearRing[]): UnitFeature {
  return {
    type: 'Feature',
    properties: {
      unit: unit.code,
      name: unit.name,
      age: unit.age,
      volcano: unit.volcano ?? 'Hawaiʻi',
      ageRank: unit.ageRank,
    },
    geometry: { type: 'Polygon', coordinates },
  };
}

/** Build the whole island. */
function buildSynthetic(): UnitFeature[] {
  const coast = COASTLINE.map(toPlane);
  const summits = VOLCANOES.map((volcano) => toPlane(volcano.summit));
  const features: UnitFeature[] = [];

  for (const [index, volcano] of VOLCANOES.entries()) {
    const summit = summits[index];
    if (summit === undefined) {
      continue;
    }
    const others = summits.filter((_, other) => other !== index);

    // The territory edge, memoised: the nearer of the coast and the handover
    // to the next volcano.
    const cache = new Map<number, number>();
    const reach = (angle: number): number => {
      const key = Math.round(angle * 1000);
      const cached = cache.get(key);
      if (cached !== undefined) {
        return cached;
      }
      const d = direction(angle);
      const value = Math.min(distanceToCoast(summit, d, coast), distanceToNeighbour(summit, d, others));
      cache.set(key, Number.isFinite(value) ? value : 0);
      return cache.get(key) ?? 0;
    };

    for (const sector of volcano.sectors) {
      const patch = buildPatch(
        summit,
        reach,
        { ...sector, volcano: volcano.name },
        sector.fromAngle,
        sector.toAngle,
      );
      if (patch !== undefined) {
        features.push(patch);
      }
    }

    for (const [from, to] of bandIntervals(volcano.sectors)) {
      for (const band of volcano.bands) {
        const patch = buildPatch(summit, reach, { ...band, volcano: volcano.name }, from, to);
        if (patch !== undefined) {
          features.push(patch);
        }
      }
    }

    // The coastal fringe buries everything, so it is drawn over the full circle.
    const fringe = buildPatch(summit, reach, { ...ALLUVIUM, volcano: volcano.name }, 0, 360);
    if (fringe !== undefined) {
      features.push(fringe);
    }
  }

  return features;
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

async function main(): Promise<void> {
  const attempts: string[] = [];

  let features = await tryNgmdb();
  let provenance = 'USGS NGMDB MapView (ArcGIS REST)';
  if (features === undefined) {
    attempts.push('USGS NGMDB MapView ArcGIS REST: service directory unavailable');
    features = await trySciencebase();
    provenance = 'USGS ScienceBase, SIM 3143';
  }
  if (features === undefined) {
    attempts.push('USGS ScienceBase SIM 3143: blocked to non-browser clients');
    console.error('Both remote sources were unreachable; synthesising instead.');
    features = buildSynthetic();
    provenance = 'synthetic';
  }

  const collection: UnitCollection = {
    type: 'FeatureCollection',
    metadata: {
      title: "Geological units, Hawai'i Island",
      provenance,
      synthetic: provenance === 'synthetic',
      generatedBy: 'scripts/fetch-hawaii.ts',
      generatedAt: new Date().toISOString(),
      note:
        provenance === 'synthetic'
          ? 'Representative data, NOT a real geological map. Unit labels, names and ages ' +
            'follow USGS usage for Hawaiʻi Island and the units are partitioned by volcano ' +
            'and flow age, but the polygons are generated. Swap in USGS SIM 3143 polygons ' +
            'when a machine-readable source is available.'
          : 'Derived from a USGS source; see provenance.',
      attempted: attempts,
      intendedSource:
        'USGS Scientific Investigations Map 3143, Geologic Map of the State of Hawaiʻi',
    },
    features,
  };

  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, `${JSON.stringify(collection)}\n`, 'utf8');

  const units = new Set(features.map((entry) => entry.properties.unit));
  console.error(
    `Wrote ${String(features.length)} features in ${String(units.size)} units to ${OUTPUT}`,
  );
  console.error(`Units: ${[...units].sort().join(', ')}`);
}

await main();
