/**
 * The map plumbing both halves of the app share.
 *
 * A demo and an uploaded style that carries its own data are the same thing to
 * MapLibre: a style, a container, and a box to frame. What differs is where
 * the style came from and what a popup should say about a feature, and that
 * stays with whoever owns the map. Everything below is the part neither of
 * them should be writing twice.
 */

// maplibre-gl 6 has no default export, and its `Map` would shadow the built-in
// one, so it comes in under its own alias.
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

setWorkerUrl(maplibreWorkerUrl);

/** The id the app's own basemap source and layer go in under. */
export const BASEMAP_SOURCE_ID = 'carto-a11y-basemap';
export const BASEMAP_LAYER_ID = 'carto-a11y-basemap-layer';

/**
 * The neutral canvas every map here is drawn over.
 *
 * The same tiles the two demos' styles name, kept here as well so a style a
 * reader brings can be given a backdrop without one. Deliberately grey: this
 * is a tool for judging colour, and a basemap with colours of its own would
 * shift how everything above it reads.
 */
export const BASEMAP_SOURCE = {
  type: 'raster',
  tiles: [
    'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
  ],
  tileSize: 256,
  maxzoom: 16,
  attribution: 'Esri, HERE, Garmin, © OpenStreetMap contributors',
} as const;

export interface Bbox {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** A box that any real coordinate will widen. */
export function emptyBox(): Bbox {
  return { west: 180, south: 90, east: -180, north: -90 };
}

/** True once a box has been grown by at least one coordinate. */
export function hasExtent(box: Bbox): boolean {
  return (
    box.west <= box.east &&
    box.south <= box.north &&
    Number.isFinite(box.west) &&
    Number.isFinite(box.north)
  );
}

export function merge(a: Bbox, b: Bbox): Bbox {
  return {
    west: Math.min(a.west, b.west),
    south: Math.min(a.south, b.south),
    east: Math.max(a.east, b.east),
    north: Math.max(a.north, b.north),
  };
}

/**
 * Grow a box to hold every position in a coordinate tree.
 *
 * A Point nests its numbers one deep, a Polygon two and a MultiPolygon three,
 * and real data has all of them. Recursing to the first pair of numbers covers
 * every geometry without branching on its type - and, more to the point,
 * without mistaking a ring for a position, which would feed arrays to
 * `Math.min` and turn the whole box into NaN.
 */
export function growBox(box: Bbox, coordinates: readonly unknown[]): void {
  const [first, second] = coordinates;
  if (typeof first === 'number' && typeof second === 'number') {
    box.west = Math.min(box.west, first);
    box.east = Math.max(box.east, first);
    box.south = Math.min(box.south, second);
    box.north = Math.max(box.north, second);
    return;
  }
  for (const child of coordinates) {
    if (Array.isArray(child)) {
      growBox(box, child as readonly unknown[]);
    }
  }
}

/** The extent of a GeoJSON object, whatever shape its features are. */
export function geoJsonBounds(data: unknown): Bbox {
  const box = emptyBox();
  const walk = (node: unknown): void => {
    if (typeof node !== 'object' || node === null) {
      return;
    }
    const record = node as Record<string, unknown>;
    const coordinates = (record['geometry'] as { coordinates?: unknown } | undefined)
      ?.coordinates;
    if (Array.isArray(coordinates)) {
      growBox(box, coordinates);
    }
    if (Array.isArray(record['coordinates'])) {
      growBox(box, record['coordinates']);
    }
    for (const key of ['features', 'geometries'] as const) {
      const children = record[key];
      if (Array.isArray(children)) {
        for (const child of children) {
          walk(child);
        }
      }
    }
  };
  walk(data);
  return box;
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
 * the data against the full viewport would hide most of it behind the sheet.
 */
export function framePadding(sidebar: HTMLElement): {
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

/** Frame a box, leaving room for the panel. */
export function fitBox(
  map: MapLibreMap,
  box: Bbox,
  sidebar: HTMLElement,
  options: { duration?: number; maxZoom?: number; extraPadding?: number } = {},
): void {
  if (!hasExtent(box)) {
    return;
  }
  const padding = framePadding(sidebar);
  const extra = options.extraPadding ?? 0;
  const bounds: LngLatBoundsLike = [
    [box.west, box.south],
    [box.east, box.north],
  ];
  map.fitBounds(bounds, {
    padding: {
      top: padding.top + extra,
      right: padding.right + extra,
      bottom: padding.bottom,
      left: padding.left + extra,
    },
    duration: options.duration ?? 0,
    ...(options.maxZoom === undefined ? {} : { maxZoom: options.maxZoom }),
  });
}

/**
 * A map in the app's one container, with the controls and wiring every caller
 * wants and none of the content any particular caller wants.
 */
export function createMap(container: HTMLElement, style: unknown): MapLibreMap {
  const map = new MapLibreMap({
    container,
    style: style as StyleSpecification,
    attributionControl: { compact: true },
  });
  map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
  map.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-right');

  // Collapsing the sidebar changes the map's box without changing the window,
  // so MapLibre has to be told; this covers window resizes too.
  const observer = new ResizeObserver(() => {
    map.resize();
  });
  observer.observe(container);
  map.once('remove', () => {
    observer.disconnect();
  });

  if (import.meta.env.DEV) {
    // Handy when poking at a map from the console; never shipped.
    (globalThis as unknown as { cartoMap?: MapLibreMap }).cartoMap = map;
  }
  map.on('error', (event) => {
    // A missing glyph server or a malformed source would otherwise fail
    // silently and leave an empty rectangle.
    console.error('[map]', event.error?.message ?? event);
  });

  return map;
}

export { MapLibreMap };
export type { StyleSpecification };
