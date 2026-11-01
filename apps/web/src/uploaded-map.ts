/**
 * Drawing a style a reader brought, when it brought its data too.
 *
 * Most styles name their sources by URL, and this tool does not go fetching a
 * stranger's tiles: those get the swatch grid. But a style can carry its
 * GeoJSON inline, and then there is a real map in the file already - so it is
 * drawn, and the audit sits beside the thing it is talking about rather than
 * beside an abstraction of it.
 *
 * What this module does to a style before handing it to MapLibre:
 *
 * - drops the sources it will not draw (vector tiles, GeoJSON named by URL)
 *   and every layer that referenced them, so nothing is fetched behind the
 *   reader's back and the console stays quiet;
 * - puts the app's grey basemap underneath, unless the style brought a raster
 *   basemap of its own;
 * - gives it a glyph server if it has labels and named none, which otherwise
 *   fails the whole style.
 *
 * The reader's own file is never modified: what is audited and what is
 * downloaded is the style exactly as it arrived.
 */

import { Popup } from 'maplibre-gl';

import { el } from './dom.js';
import {
  BASEMAP_LAYER_ID,
  BASEMAP_SOURCE,
  BASEMAP_SOURCE_ID,
  createMap,
  fitBox,
  geoJsonBounds,
  hasExtent,
  merge,
  padBox,
  type Bbox,
  type MapLibreMap,
  type StyleSpecification,
} from './map.js';

/** A glyph server for a style that has labels but named none. */
const FALLBACK_GLYPHS = 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf';

/** Properties longer than this are a blob of something, not a label. */
const MAX_VALUE_LENGTH = 120;

/** How many properties one popup will show. */
const MAX_POPUP_ROWS = 12;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Every source whose GeoJSON is in the file rather than at the end of a URL. */
export function inlineGeoJsonSources(style: unknown): string[] {
  if (!isRecord(style) || !isRecord(style['sources'])) {
    return [];
  }
  return Object.entries(style['sources'])
    .filter(
      ([, source]) =>
        isRecord(source) && source['type'] === 'geojson' && isRecord(source['data']),
    )
    .map(([id]) => id);
}

/** True when there is a map in this file, not just a palette. */
export function hasInlineData(style: unknown): boolean {
  return inlineGeoJsonSources(style).length > 0;
}

/** The extent of everything the style carries, for the opening view. */
export function inlineBounds(style: unknown): Bbox | undefined {
  if (!isRecord(style) || !isRecord(style['sources'])) {
    return undefined;
  }
  let box: Bbox | undefined;
  for (const id of inlineGeoJsonSources(style)) {
    const source = style['sources'][id];
    if (!isRecord(source)) {
      continue;
    }
    const found = geoJsonBounds(source['data']);
    if (hasExtent(found)) {
      box = box === undefined ? found : merge(box, found);
    }
  }
  // A box fitted exactly to the data puts the outermost feature hard against
  // the edge of the window.
  return box === undefined ? undefined : padBox(box, 0.05);
}

/** True when the style already paints a raster backdrop of its own. */
function hasRasterBasemap(sources: Record<string, unknown>): boolean {
  return Object.values(sources).some(
    (source) => isRecord(source) && source['type'] === 'raster',
  );
}

/**
 * The style as MapLibre should receive it.
 *
 * A copy: the original is what gets audited and downloaded, and it keeps its
 * URL sources and its own ordering whatever happens here.
 */
export function renderableStyle(style: unknown): unknown {
  if (!isRecord(style)) {
    return style;
  }
  const sources = isRecord(style['sources']) ? style['sources'] : {};

  // Keep what can be drawn from the file itself, plus any raster backdrop the
  // style already names. Everything else would mean a fetch we did not ask for.
  const kept: Record<string, unknown> = {};
  for (const [id, source] of Object.entries(sources)) {
    if (!isRecord(source)) {
      continue;
    }
    const type = source['type'];
    if ((type === 'geojson' && isRecord(source['data'])) || type === 'raster') {
      kept[id] = source;
    }
  }

  const layers = Array.isArray(style['layers']) ? style['layers'] : [];
  const drawable = layers.filter((layer) => {
    if (!isRecord(layer)) {
      return false;
    }
    const source = layer['source'];
    // A background layer has no source and is always drawable.
    return source === undefined || (typeof source === 'string' && source in kept);
  });

  const next: Record<string, unknown> = {
    ...style,
    version: 8,
    sources: kept,
    layers: drawable,
  };

  if (!hasRasterBasemap(kept)) {
    next['sources'] = { [BASEMAP_SOURCE_ID]: BASEMAP_SOURCE, ...kept };
    // Above any background the style paints - an opaque background layer over
    // the tiles would hide them - and below everything that carries data.
    const firstData = drawable.findIndex(
      (layer) => isRecord(layer) && layer['type'] !== 'background',
    );
    const at = firstData === -1 ? drawable.length : firstData;
    next['layers'] = [
      ...drawable.slice(0, at),
      {
        id: BASEMAP_LAYER_ID,
        type: 'raster',
        source: BASEMAP_SOURCE_ID,
        paint: { 'raster-opacity': 0.9 },
      },
      ...drawable.slice(at),
    ];
  }

  const needsGlyphs = (next['layers'] as unknown[]).some(
    (layer) => isRecord(layer) && layer['type'] === 'symbol',
  );
  if (needsGlyphs && typeof next['glyphs'] !== 'string') {
    next['glyphs'] = FALLBACK_GLYPHS;
  }

  return next;
}

/* ------------------------------------------------------------------ *
 * The map
 * ------------------------------------------------------------------ */

/** A readable rendering of whatever a feature happens to carry. */
function propertyRows(properties: Record<string, unknown>): Array<[string, string]> {
  const rows: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(properties)) {
    if (rows.length >= MAX_POPUP_ROWS) {
      break;
    }
    if (value === null || value === undefined || value === '') {
      continue;
    }
    const text =
      typeof value === 'object' ? JSON.stringify(value) : String(value as string | number);
    // Geometry blobs and encoded payloads say nothing to a reader.
    if (text.length > MAX_VALUE_LENGTH) {
      continue;
    }
    rows.push([key, text]);
  }
  return rows;
}

export interface UploadedMap {
  /** Swap in another palette, keeping the camera where the reader left it. */
  setStyle(style: unknown): void;
  destroy(): void;
}

export interface UploadedMapOptions {
  container: HTMLElement;
  sidebar: HTMLElement;
  /** The reader's style, as it arrived. */
  style: unknown;
  /** Where its data is, so the first view frames it. */
  bounds: Bbox | undefined;
}

/**
 * Put an uploaded style on the page.
 *
 * The popup is deliberately generic: this is a stranger's data and there is no
 * metadata table saying which of its properties is the name, so it shows what
 * the feature actually carries and lets the reader decide what matters.
 */
export function createUploadedMap(options: UploadedMapOptions): UploadedMap {
  const map = createMap(options.container, renderableStyle(options.style));
  let popup: Popup | undefined;

  const frame = (): void => {
    if (options.bounds !== undefined) {
      fitBox(map, options.bounds, options.sidebar, { maxZoom: 15 });
    }
  };
  map.once('load', frame);

  map.on('click', (event) => {
    const hits = map
      .queryRenderedFeatures(event.point)
      .filter((feature) => feature.layer.id !== BASEMAP_LAYER_ID);
    const feature = hits[0];
    if (feature === undefined) {
      return;
    }

    const node = el('div', 'popup');
    node.append(el('p', 'popup-code', feature.layer.id));
    const rows = propertyRows(feature.properties ?? {});
    if (rows.length === 0) {
      node.append(el('p', 'popup-name', 'This feature carries no properties.'));
    } else {
      const list = el('dl', 'popup-rows');
      for (const [term, value] of rows) {
        list.append(el('dt', undefined, term), el('dd', undefined, value));
      }
      node.append(list);
    }

    popup?.remove();
    popup = new Popup({ closeButton: true, maxWidth: '280px', className: 'unit-popup' })
      .setLngLat(event.lngLat)
      .setDOMContent(node)
      .addTo(map);
  });

  map.on('mousemove', (event) => {
    const over = map
      .queryRenderedFeatures(event.point)
      .some((feature) => feature.layer.id !== BASEMAP_LAYER_ID);
    map.getCanvas().style.cursor = over ? 'pointer' : '';
  });

  return {
    setStyle(style) {
      // `diff: true` keeps the camera and only repaints what changed, which
      // for a repalette is exactly the colours.
      map.setStyle(renderableStyle(style) as StyleSpecification, { diff: true });
    },
    destroy() {
      popup?.remove();
      map.remove();
    },
  };
}

export type { MapLibreMap };
