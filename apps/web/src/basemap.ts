/**
 * The neutral canvas every map here is drawn over.
 *
 * Its own module, free of MapLibre, so that the parts of the app which only
 * *describe* a map - the GeoJSON style generator, and its tests - can name the
 * basemap without pulling a renderer in behind it.
 *
 * Deliberately grey: this is a tool for judging colour, and a basemap with
 * colours of its own would shift how everything above it reads.
 */

/** The id the app's own basemap source and layer go in under. */
export const BASEMAP_SOURCE_ID = 'carto-a11y-basemap';
export const BASEMAP_LAYER_ID = 'carto-a11y-basemap-layer';

export const BASEMAP_SOURCE = {
  type: 'raster',
  tiles: [
    'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
  ],
  tileSize: 256,
  maxzoom: 16,
  attribution: 'Esri, HERE, Garmin, © OpenStreetMap contributors',
} as const;

export const BASEMAP_LAYER = {
  id: BASEMAP_LAYER_ID,
  type: 'raster',
  source: BASEMAP_SOURCE_ID,
  paint: { 'raster-opacity': 0.9 },
} as const;
