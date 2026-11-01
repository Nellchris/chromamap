import { describe, expect, it } from 'vitest';

import {
  geoJsonProblem,
  isGeoJson,
  isMapLibreStyle,
  normaliseGeoJson,
  planColours,
  shapesIn,
  styleFromGeoJson,
} from '../src/geojson-style.js';

type Props = Record<string, unknown>;

function polygon(properties: Props = {}): unknown {
  return {
    type: 'Feature',
    properties,
    geometry: {
      type: 'Polygon',
      coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
    },
  };
}

function point(properties: Props = {}): unknown {
  return {
    type: 'Feature',
    properties,
    geometry: { type: 'Point', coordinates: [2, 3] },
  };
}

function line(properties: Props = {}): unknown {
  return {
    type: 'Feature',
    properties,
    geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
  };
}

function collection(...features: unknown[]): unknown {
  return { type: 'FeatureCollection', features };
}

/** The paint value of one generated layer. */
function paint(style: Record<string, unknown>, layerId: string, key: string): unknown {
  const layers = style['layers'] as Array<Record<string, unknown>>;
  const layer = layers.find((entry) => entry['id'] === layerId);
  return (layer?.['paint'] as Record<string, unknown> | undefined)?.[key];
}

function layerIds(style: Record<string, unknown>): string[] {
  return (style['layers'] as Array<Record<string, unknown>>).map(
    (layer) => layer['id'] as string,
  );
}

describe('telling the two kinds of file apart', () => {
  it('knows a MapLibre style by its two halves', () => {
    expect(isMapLibreStyle({ version: 8, sources: {}, layers: [] })).toBe(true);
    expect(isMapLibreStyle({ version: 8, layers: [] })).toBe(false);
    expect(isMapLibreStyle({ version: 8, sources: {} })).toBe(false);
  });

  it('does not mistake GeoJSON for a style', () => {
    expect(isMapLibreStyle(collection(polygon()))).toBe(false);
    expect(isGeoJson(collection(polygon()))).toBe(true);
  });

  it('accepts a lone Feature and a bare geometry', () => {
    expect(isGeoJson(polygon())).toBe(true);
    expect(isGeoJson({ type: 'Point', coordinates: [0, 0] })).toBe(true);
    expect(isGeoJson({ type: 'GeometryCollection', geometries: [] })).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isGeoJson({ hello: 'world' })).toBe(false);
    expect(isGeoJson({ type: 'Banana' })).toBe(false);
    expect(isGeoJson(null)).toBe(false);
    expect(isGeoJson([1, 2, 3])).toBe(false);
  });
});

describe('normalising to a FeatureCollection', () => {
  it('leaves a collection alone', () => {
    const normalised = normaliseGeoJson(collection(polygon(), point()));
    expect(normalised.features).toHaveLength(2);
  });

  it('wraps a lone Feature', () => {
    const normalised = normaliseGeoJson(polygon({ a: 1 }));
    expect(normalised.type).toBe('FeatureCollection');
    expect(normalised.features).toHaveLength(1);
    expect((normalised.features[0] as { properties: Props }).properties).toEqual({ a: 1 });
  });

  it('wraps a bare geometry in a Feature first', () => {
    const normalised = normaliseGeoJson({ type: 'Point', coordinates: [5, 6] });
    const feature = normalised.features[0] as { type: string; geometry: unknown };
    expect(feature.type).toBe('Feature');
    expect(feature.geometry).toEqual({ type: 'Point', coordinates: [5, 6] });
  });
});

describe('files that cannot be drawn', () => {
  it('reports an empty collection', () => {
    expect(geoJsonProblem(normaliseGeoJson(collection()))).toBe('no-features');
    expect(geoJsonProblem(normaliseGeoJson({ type: 'FeatureCollection' }))).toBe(
      'no-features',
    );
  });

  it('reports features that all lack geometry', () => {
    const empty = { type: 'Feature', properties: { a: 1 }, geometry: null };
    expect(geoJsonProblem(normaliseGeoJson(collection(empty, empty)))).toBe('no-geometry');
  });

  it('is content when one feature has geometry', () => {
    const empty = { type: 'Feature', properties: {}, geometry: null };
    expect(geoJsonProblem(normaliseGeoJson(collection(empty, polygon())))).toBeUndefined();
  });
});

describe('which layers get generated', () => {
  it('draws areas as a fill plus an outline', () => {
    const { style } = styleFromGeoJson(collection(polygon()), 'a.geojson');
    expect(layerIds(style)).toEqual([
      'carto-a11y-basemap-layer',
      'uploaded-fill',
      'uploaded-fill-outline',
    ]);
  });

  it('draws lines and points as their own layers', () => {
    const { style } = styleFromGeoJson(collection(line(), point()), 'a.geojson');
    expect(layerIds(style)).toEqual([
      'carto-a11y-basemap-layer',
      'uploaded-line',
      'uploaded-point',
    ]);
  });

  it('adds nothing for a geometry the file does not contain', () => {
    const { style } = styleFromGeoJson(collection(point()), 'a.geojson');
    expect(layerIds(style)).not.toContain('uploaded-fill');
    expect(layerIds(style)).not.toContain('uploaded-line');
  });

  it('sees through a GeometryCollection', () => {
    const nested = {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'GeometryCollection',
        geometries: [
          { type: 'Point', coordinates: [0, 0] },
          { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
        ],
      },
    };
    expect(shapesIn(normaliseGeoJson(collection(nested)))).toEqual({
      area: true,
      line: false,
      point: true,
    });
  });

  it('puts the basemap under the data and carries its attribution', () => {
    const { style } = styleFromGeoJson(collection(polygon()), 'a.geojson');
    const sources = style['sources'] as Record<string, Record<string, unknown>>;
    expect(layerIds(style)[0]).toBe('carto-a11y-basemap-layer');
    expect(sources['carto-a11y-basemap']?.['attribution']).toContain('Esri');
    expect(sources['uploaded']?.['type']).toBe('geojson');
  });
});

describe('where the colours come from', () => {
  it('prefers the colours the data itself carries', () => {
    const data = collection(
      polygon({ fill: '#ff0000' }),
      polygon({ fill: '#00ff00' }),
      polygon({ fill: '#ff0000' }),
    );
    const { style, plan } = styleFromGeoJson(data, 'a.geojson');
    expect(plan.source).toBe('simplestyle');
    // A match of each value onto itself: the renderer paints what the data
    // says, and every one of those colours is visible to the auditor.
    expect(paint(style, 'uploaded-fill', 'fill-color')).toEqual([
      'match',
      ['get', 'fill'],
      '#ff0000',
      '#ff0000',
      '#00ff00',
      '#00ff00',
      '#3388ff',
    ]);
  });

  it('reads stroke and marker-color too', () => {
    const data = collection(line({ stroke: '#112233' }), point({ 'marker-color': '#445566' }));
    const { style } = styleFromGeoJson(data, 'a.geojson');
    expect(JSON.stringify(paint(style, 'uploaded-line', 'line-color'))).toContain('#112233');
    expect(JSON.stringify(paint(style, 'uploaded-point', 'circle-color'))).toContain(
      '#445566',
    );
  });

  it('falls back to a category when the data names no colours', () => {
    const data = collection(
      polygon({ category: 'park' }),
      polygon({ category: 'water' }),
      polygon({ category: 'park' }),
    );
    const { style, plan } = styleFromGeoJson(data, 'a.geojson');
    expect(plan.source).toBe('categorical');
    expect(plan.property).toBe('category');
    expect(paint(style, 'uploaded-fill', 'fill-color')).toEqual([
      'match',
      ['get', 'category'],
      'park',
      '#66c2a5',
      'water',
      '#fc8d62',
      '#3388ff',
    ]);
  });

  it('prefers `type` over the other candidate properties', () => {
    const data = collection(
      polygon({ type: 'a', kind: 'x' }),
      polygon({ type: 'b', kind: 'y' }),
    );
    expect(planColours(normaliseGeoJson(data)).property).toBe('type');
  });

  it('will not treat a property with too many values as a category', () => {
    const data = collection(
      ...Array.from({ length: 9 }, (_, index) => polygon({ name: `name-${String(index)}` })),
    );
    const plan = planColours(normaliseGeoJson(data));
    expect(plan.source).toBe('default');
  });

  it('will not treat a property with one value as a category', () => {
    const data = collection(polygon({ type: 'same' }), polygon({ type: 'same' }));
    expect(planColours(normaliseGeoJson(data)).source).toBe('default');
  });

  it('uses one default colour when there is nothing to go on', () => {
    const { style, plan } = styleFromGeoJson(collection(polygon(), line(), point()), 'a');
    expect(plan.source).toBe('default');
    expect(paint(style, 'uploaded-fill', 'fill-color')).toBe('#3388ff');
    expect(paint(style, 'uploaded-line', 'line-color')).toBe('#333333');
    expect(paint(style, 'uploaded-point', 'circle-color')).toBe('#3388ff');
  });

  it('says which of the three it did, in words a reader can use', () => {
    for (const data of [
      collection(polygon({ fill: '#ff0000' })),
      collection(polygon({ type: 'a' }), polygon({ type: 'b' })),
      collection(polygon()),
    ]) {
      const { plan } = styleFromGeoJson(data, 'a');
      expect(plan.note).toContain('auto-generated from GeoJSON');
      expect(plan.note.length).toBeGreaterThan(40);
    }
  });
});

describe('the generated style is a style', () => {
  it('is version 8 and names itself after the file', () => {
    const { style } = styleFromGeoJson(collection(polygon()), 'parcels.geojson');
    expect(style['version']).toBe(8);
    expect(style['name']).toBe('parcels.geojson');
  });

  it('carries the data inline, normalised', () => {
    const { style } = styleFromGeoJson(polygon(), 'one.geojson');
    const sources = style['sources'] as Record<string, Record<string, unknown>>;
    const data = sources['uploaded']?.['data'] as { type: string; features: unknown[] };
    expect(data.type).toBe('FeatureCollection');
    expect(data.features).toHaveLength(1);
  });

  it('keeps polygons out of the line layer and vice versa', () => {
    const { style } = styleFromGeoJson(collection(polygon(), line()), 'a');
    const layers = style['layers'] as Array<Record<string, unknown>>;
    const outline = layers.find((layer) => layer['id'] === 'uploaded-fill-outline');
    const lineLayer = layers.find((layer) => layer['id'] === 'uploaded-line');
    expect(JSON.stringify(outline?.['filter'])).toContain('MultiPolygon');
    expect(JSON.stringify(lineLayer?.['filter'])).toContain('MultiLineString');
  });
});
