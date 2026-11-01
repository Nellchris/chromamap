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

export {
  BASEMAP_LAYER,
  BASEMAP_LAYER_ID,
  BASEMAP_SOURCE,
  BASEMAP_SOURCE_ID,
} from './basemap.js';

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

/** Grow a box, counting every longitude as if it were east of the antimeridian. */
function growShifted(box: Bbox, coordinates: readonly unknown[]): void {
  const [first, second] = coordinates;
  if (typeof first === 'number' && typeof second === 'number') {
    const lon = first < 0 ? first + 360 : first;
    box.west = Math.min(box.west, lon);
    box.east = Math.max(box.east, lon);
    box.south = Math.min(box.south, second);
    box.north = Math.max(box.north, second);
    return;
  }
  for (const child of coordinates) {
    if (Array.isArray(child)) {
      growShifted(box, child as readonly unknown[]);
    }
  }
}

/**
 * The extent of a GeoJSON object, whatever shape its features are.
 *
 * Walks anything the format allows - a FeatureCollection, a lone Feature, a
 * bare geometry, a GeometryCollection, and every `Multi*` nesting - by
 * recursing to the first pair of numbers rather than branching on type.
 *
 * Data either side of the antimeridian looks, to a naive box, like data
 * spanning the whole planet: a line from Fiji to Samoa would be framed as the
 * entire Pacific the wrong way round. So the extent is measured twice, once
 * with longitudes as given and once with the negative ones moved past +180,
 * and the narrower answer wins.
 */
export function geoJsonBounds(data: unknown): Bbox {
  const plain = emptyBox();
  const shifted = emptyBox();
  const walk = (node: unknown): void => {
    if (typeof node !== 'object' || node === null) {
      return;
    }
    const record = node as Record<string, unknown>;
    const geometry = record['geometry'];
    if (typeof geometry === 'object' && geometry !== null) {
      walk(geometry);
    }
    if (Array.isArray(record['coordinates'])) {
      growBox(plain, record['coordinates']);
      growShifted(shifted, record['coordinates']);
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

  if (!hasExtent(plain)) {
    return plain;
  }
  const spans = plain.east - plain.west;
  return spans > 180 && shifted.east - shifted.west < spans ? shifted : plain;
}

/**
 * Open a box out by a fraction of its own size.
 *
 * A box fitted exactly to the data puts the outermost feature against the edge
 * of the window. A zero-sized box - one point, or one vertical line - gets a
 * small fixed margin instead, since a fraction of nothing is nothing.
 */
export function padBox(box: Bbox, fraction: number, minimum = 0.001): Bbox {
  if (!hasExtent(box)) {
    return box;
  }
  const padX = Math.max((box.east - box.west) * fraction, minimum);
  const padY = Math.max((box.north - box.south) * fraction, minimum);
  return {
    west: box.west - padX,
    east: box.east + padX,
    south: Math.max(-90, box.south - padY),
    north: Math.min(90, box.north + padY),
  };
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
