import { describe, expect, it } from 'vitest';

import { rgbToHex } from '../../src/color/parse.js';
import { extractClasses, type MapClass } from '../../src/style/extract.js';

/** Wrap layers in the minimum a style needs to be recognised. */
function style(...layers: readonly unknown[]): unknown {
  return { version: 8, name: 'test', sources: {}, layers };
}

/** Compact view of a class, for readable assertions. */
function describeClass(cls: MapClass): string {
  return `${cls.id} ${cls.type} ${rgbToHex(cls.color)} @${String(cls.opacity)}`;
}

describe('extractClasses: single layers', () => {
  it('extracts one fill layer', () => {
    const classes = extractClasses(
      style({ id: 'water', type: 'fill', paint: { 'fill-color': '#aad3df' } }),
    );
    expect(classes).toHaveLength(1);
    expect(describeClass(classes[0] as MapClass)).toBe('water fill #aad3df @1');
  });

  it('extracts each of the four paint properties', () => {
    const classes = extractClasses(
      style(
        { id: 'a', type: 'fill', paint: { 'fill-color': '#ff0000' } },
        { id: 'b', type: 'line', paint: { 'line-color': '#00ff00' } },
        { id: 'c', type: 'symbol', paint: { 'text-color': '#0000ff' } },
        { id: 'd', type: 'circle', paint: { 'circle-color': '#ffff00' } },
      ),
    );
    expect(classes.map((cls) => cls.type)).toEqual(['fill', 'line', 'text', 'circle']);
    expect(classes.map((cls) => cls.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('ignores paint properties that carry no colour', () => {
    const classes = extractClasses(
      style(
        { id: 'bg', type: 'background', paint: { 'background-color': '#ffffff' } },
        { id: 'w', type: 'fill', paint: { 'fill-outline-color': '#000000' } },
      ),
    );
    expect(classes).toEqual([]);
  });

  it('keeps layers in document order', () => {
    const classes = extractClasses(
      style(
        { id: 'first', type: 'fill', paint: { 'fill-color': '#111111' } },
        { id: 'second', type: 'fill', paint: { 'fill-color': '#222222' } },
        { id: 'third', type: 'fill', paint: { 'fill-color': '#333333' } },
      ),
    );
    expect(classes.map((cls) => cls.id)).toEqual(['first', 'second', 'third']);
  });
});

describe('extractClasses: colour formats', () => {
  it('accepts hex, rgb() and named colours', () => {
    const classes = extractClasses(
      style(
        { id: 'hex6', type: 'fill', paint: { 'fill-color': '#ff0000' } },
        { id: 'hex3', type: 'fill', paint: { 'fill-color': '#f00' } },
        { id: 'rgb', type: 'fill', paint: { 'fill-color': 'rgb(255, 0, 0)' } },
        { id: 'rgba', type: 'fill', paint: { 'fill-color': 'rgba(255, 0, 0, 0.5)' } },
        { id: 'named', type: 'fill', paint: { 'fill-color': 'red' } },
      ),
    );
    expect(classes).toHaveLength(5);
    for (const cls of classes) {
      expect(rgbToHex(cls.color), cls.id).toBe('#ff0000');
    }
  });

  it('skips colours it cannot parse rather than throwing', () => {
    const classes = extractClasses(
      style(
        { id: 'broken', type: 'fill', paint: { 'fill-color': 'not-a-colour' } },
        { id: 'fine', type: 'fill', paint: { 'fill-color': '#abcdef' } },
      ),
    );
    expect(classes.map((cls) => cls.id)).toEqual(['fine']);
  });

  it('skips expressions it cannot resolve statically', () => {
    const classes = extractClasses(
      style(
        {
          id: 'data-driven',
          type: 'fill',
          paint: { 'fill-color': ['case', ['>', ['get', 'x'], 1], '#111111', '#222222'] },
        },
        {
          id: 'interpolated',
          type: 'line',
          paint: { 'line-color': ['interpolate', ['linear'], ['zoom'], 0, '#111111', 10, '#222222'] },
        },
        { id: 'fine', type: 'fill', paint: { 'fill-color': '#abcdef' } },
      ),
    );
    expect(classes.map((cls) => cls.id)).toEqual(['fine']);
  });
});

describe('extractClasses: match expressions', () => {
  it('turns each branch into its own class', () => {
    const classes = extractClasses(
      style({
        id: 'landuse',
        type: 'fill',
        paint: {
          'fill-color': [
            'match',
            ['get', 'class'],
            'park',
            '#c8facc',
            'school',
            '#ffeeaa',
            '#eeeeee',
          ],
        },
      }),
    );
    expect(classes.map(describeClass)).toEqual([
      'landuse/park fill #c8facc @1',
      'landuse/school fill #ffeeaa @1',
      'landuse/default fill #eeeeee @1',
    ]);
  });

  it('joins a multi-label branch into one id', () => {
    const classes = extractClasses(
      style({
        id: 'landuse',
        type: 'fill',
        paint: {
          'fill-color': ['match', ['get', 'class'], ['wood', 'forest'], '#8fbc8f', '#eeeeee'],
        },
      }),
    );
    expect(classes.map((cls) => cls.id)).toEqual([
      'landuse/wood|forest',
      'landuse/default',
    ]);
  });

  it('handles a match with no fallback', () => {
    const classes = extractClasses(
      style({
        id: 'roads',
        type: 'line',
        paint: {
          'line-color': ['match', ['get', 'kind'], 'motorway', '#ff0000', 'primary', '#ff8800'],
        },
      }),
    );
    expect(classes.map((cls) => cls.id)).toEqual(['roads/motorway', 'roads/primary']);
  });

  it('applies the layer opacity to every branch', () => {
    const classes = extractClasses(
      style({
        id: 'landuse',
        type: 'fill',
        paint: {
          'fill-opacity': 0.4,
          'fill-color': ['match', ['get', 'class'], 'park', '#c8facc', '#eeeeee'],
        },
      }),
    );
    expect(classes.map((cls) => cls.opacity)).toEqual([0.4, 0.4]);
  });

  it('skips branches whose output is not a colour', () => {
    const classes = extractClasses(
      style({
        id: 'landuse',
        type: 'fill',
        paint: {
          'fill-color': ['match', ['get', 'class'], 'park', ['get', 'colour'], '#eeeeee'],
        },
      }),
    );
    expect(classes.map((cls) => cls.id)).toEqual(['landuse/default']);
  });
});

describe('extractClasses: visibility', () => {
  it('skips layers hidden by layout.visibility', () => {
    const classes = extractClasses(
      style(
        { id: 'shown', type: 'fill', paint: { 'fill-color': '#111111' } },
        {
          id: 'hidden',
          type: 'fill',
          layout: { visibility: 'none' },
          paint: { 'fill-color': '#222222' },
        },
      ),
    );
    expect(classes.map((cls) => cls.id)).toEqual(['shown']);
  });

  it('keeps layers explicitly set visible', () => {
    const classes = extractClasses(
      style({
        id: 'shown',
        type: 'fill',
        layout: { visibility: 'visible' },
        paint: { 'fill-color': '#111111' },
      }),
    );
    expect(classes.map((cls) => cls.id)).toEqual(['shown']);
  });
});

describe('extractClasses: opacity', () => {
  it('defaults to 1 when absent', () => {
    const classes = extractClasses(
      style({ id: 'a', type: 'fill', paint: { 'fill-color': '#111111' } }),
    );
    expect(classes[0]?.opacity).toBe(1);
  });

  it('reads the matching opacity property', () => {
    const classes = extractClasses(
      style(
        { id: 'f', type: 'fill', paint: { 'fill-color': '#111111', 'fill-opacity': 0.25 } },
        { id: 'l', type: 'line', paint: { 'line-color': '#111111', 'line-opacity': 0.5 } },
        { id: 't', type: 'symbol', paint: { 'text-color': '#111111', 'text-opacity': 0.75 } },
        { id: 'c', type: 'circle', paint: { 'circle-color': '#111111', 'circle-opacity': 0 } },
      ),
    );
    expect(classes.map((cls) => cls.opacity)).toEqual([0.25, 0.5, 0.75, 0]);
  });

  it('ignores an opacity belonging to another paint type', () => {
    const classes = extractClasses(
      style({ id: 'a', type: 'fill', paint: { 'fill-color': '#111111', 'line-opacity': 0.2 } }),
    );
    expect(classes[0]?.opacity).toBe(1);
  });

  it('clamps out-of-range opacity', () => {
    const classes = extractClasses(
      style(
        { id: 'high', type: 'fill', paint: { 'fill-color': '#111111', 'fill-opacity': 3 } },
        { id: 'low', type: 'fill', paint: { 'fill-color': '#111111', 'fill-opacity': -2 } },
      ),
    );
    expect(classes.map((cls) => cls.opacity)).toEqual([1, 0]);
  });

  it('falls back to 1 for an opacity it cannot resolve', () => {
    const classes = extractClasses(
      style({
        id: 'a',
        type: 'fill',
        paint: { 'fill-color': '#111111', 'fill-opacity': ['get', 'alpha'] },
      }),
    );
    expect(classes[0]?.opacity).toBe(1);
  });
});

describe('extractClasses: stop functions', () => {
  it('takes the last stop of a colour function', () => {
    const classes = extractClasses(
      style({
        id: 'zoomed',
        type: 'line',
        paint: { 'line-color': { stops: [[0, '#aaaaaa'], [10, '#bbbbbb']] } },
      }),
    );
    expect(describeClass(classes[0] as MapClass)).toBe('zoomed line #bbbbbb @1');
  });

  it('takes the last stop of an opacity function', () => {
    const classes = extractClasses(
      style({
        id: 'zoomed',
        type: 'line',
        paint: {
          'line-color': '#111111',
          'line-opacity': { stops: [[0, 0.2], [10, 0.6]] },
        },
      }),
    );
    expect(classes[0]?.opacity).toBeCloseTo(0.6, 12);
  });

  it('handles the property-and-zoom stop shape', () => {
    const classes = extractClasses(
      style({
        id: 'zoomed',
        type: 'fill',
        paint: {
          'fill-color': {
            property: 'density',
            stops: [[{ zoom: 0, value: 0 }, '#aaaaaa'], [{ zoom: 10, value: 5 }, '#cccccc']],
          },
        },
      }),
    );
    expect(rgbToHex(classes[0]?.color ?? [0, 0, 0])).toBe('#cccccc');
  });

  it('skips a stop function with no usable stops', () => {
    const classes = extractClasses(
      style(
        { id: 'empty', type: 'fill', paint: { 'fill-color': { stops: [] } } },
        { id: 'short', type: 'fill', paint: { 'fill-color': { stops: [[0]] } } },
        { id: 'fine', type: 'fill', paint: { 'fill-color': '#abcdef' } },
      ),
    );
    expect(classes.map((cls) => cls.id)).toEqual(['fine']);
  });
});

describe('extractClasses: ids', () => {
  it('disambiguates a layer that paints more than one property', () => {
    const classes = extractClasses(
      style({
        id: 'labels',
        type: 'symbol',
        paint: { 'text-color': '#333333', 'circle-color': '#444444' },
      }),
    );
    expect(classes.map((cls) => cls.id)).toEqual(['labels:text', 'labels:circle']);
  });

  it('combines the paint suffix with match branches', () => {
    const classes = extractClasses(
      style({
        id: 'labels',
        type: 'symbol',
        paint: {
          'text-color': ['match', ['get', 'kind'], 'city', '#333333', '#777777'],
          'circle-color': '#444444',
        },
      }),
    );
    expect(classes.map((cls) => cls.id)).toEqual([
      'labels:text/city',
      'labels:text/default',
      'labels:circle',
    ]);
  });

  it('falls back to the layer index when the id is missing', () => {
    const classes = extractClasses(
      style(
        { id: 'named', type: 'fill', paint: { 'fill-color': '#111111' } },
        { type: 'fill', paint: { 'fill-color': '#222222' } },
      ),
    );
    expect(classes.map((cls) => cls.id)).toEqual(['named', 'layer-1']);
  });
});

describe('extractClasses: malformed input', () => {
  it('returns an empty list rather than throwing', () => {
    expect(extractClasses(undefined)).toEqual([]);
    expect(extractClasses(null)).toEqual([]);
    expect(extractClasses({})).toEqual([]);
    expect(extractClasses({ layers: 'nope' })).toEqual([]);
    expect(extractClasses([])).toEqual([]);
    expect(extractClasses('{"layers":[]}')).toEqual([]);
    expect(extractClasses(style())).toEqual([]);
  });

  it('skips layers that are not objects', () => {
    const classes = extractClasses(
      style(null, 'layer', 42, { id: 'fine', type: 'fill', paint: { 'fill-color': '#abcdef' } }),
    );
    expect(classes.map((cls) => cls.id)).toEqual(['fine']);
  });

  it('skips layers with no paint block', () => {
    const classes = extractClasses(
      style(
        { id: 'nopaint', type: 'fill' },
        { id: 'badpaint', type: 'fill', paint: 'nope' },
        { id: 'fine', type: 'fill', paint: { 'fill-color': '#abcdef' } },
      ),
    );
    expect(classes.map((cls) => cls.id)).toEqual(['fine']);
  });
});

describe('extractClasses: a representative style', () => {
  it('extracts everything resolvable from a mixed style', () => {
    const classes = extractClasses(
      style(
        { id: 'bg', type: 'background', paint: { 'background-color': '#ffffff' } },
        { id: 'water', type: 'fill', paint: { 'fill-color': '#aad3df', 'fill-opacity': 0.8 } },
        { id: 'roads', type: 'line', paint: { 'line-color': 'rgb(255, 0, 0)' } },
        {
          id: 'hidden',
          type: 'fill',
          layout: { visibility: 'none' },
          paint: { 'fill-color': '#000000' },
        },
        {
          id: 'landuse',
          type: 'fill',
          paint: {
            'fill-color': [
              'match',
              ['get', 'class'],
              'park',
              '#c8facc',
              ['wood', 'forest'],
              '#8fbc8f',
              '#eeeeee',
            ],
          },
        },
        {
          id: 'zoomed',
          type: 'line',
          paint: {
            'line-color': { stops: [[0, '#aaaaaa'], [10, '#bbbbbb']] },
            'line-opacity': { stops: [[0, 0.2], [10, 0.6]] },
          },
        },
        { id: 'labels', type: 'symbol', paint: { 'text-color': '#333333' } },
      ),
    );

    expect(classes.map(describeClass)).toEqual([
      'water fill #aad3df @0.8',
      'roads line #ff0000 @1',
      'landuse/park fill #c8facc @1',
      'landuse/wood|forest fill #8fbc8f @1',
      'landuse/default fill #eeeeee @1',
      'zoomed line #bbbbbb @0.6',
      'labels text #333333 @1',
    ]);
  });
});
