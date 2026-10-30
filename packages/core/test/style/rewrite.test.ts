import { describe, expect, it } from 'vitest';

import { parseColor, rgbToHex, type RGB } from '../../src/color/parse.js';
import { extractClasses } from '../../src/style/extract.js';
import { applyPalette } from '../../src/style/rewrite.js';

/** Wrap layers in the minimum a style needs to be recognised. */
function style(...layers: readonly unknown[]): Record<string, unknown> {
  return { version: 8, name: 'test', sources: {}, layers };
}

/** A palette as `applyPalette` wants it, written in hex. */
function palette(entries: Record<string, string>): Map<string, RGB> {
  return new Map(
    Object.entries(entries).map(([id, hex]) => [id, parseColor(hex)] as const),
  );
}

/** The colours the rewritten style now extracts to, as `id -> hex`. */
function coloursOf(rewritten: unknown): Record<string, string> {
  return Object.fromEntries(
    extractClasses(rewritten).map((cls) => [cls.id, rgbToHex(cls.color)]),
  );
}

describe('applyPalette: plain colours', () => {
  it('replaces a layer colour', () => {
    const result = applyPalette(
      style({ id: 'water', type: 'fill', paint: { 'fill-color': '#aad3df' } }),
      palette({ water: '#112233' }),
    );
    expect(coloursOf(result.style)).toEqual({ water: '#112233' });
    expect(result.changed).toEqual(['water']);
    expect(result.missing).toEqual([]);
  });

  it('leaves the input untouched', () => {
    const input = style({ id: 'water', type: 'fill', paint: { 'fill-color': '#aad3df' } });
    const before = JSON.stringify(input);
    applyPalette(input, palette({ water: '#112233' }));
    expect(JSON.stringify(input)).toBe(before);
  });

  it('keeps everything it was not asked to change', () => {
    const result = applyPalette(
      style({
        id: 'water',
        type: 'fill',
        source: 'src',
        filter: ['==', ['get', 'kind'], 'lake'],
        paint: { 'fill-color': '#aad3df', 'fill-opacity': 0.5 },
      }),
      palette({ water: '#112233' }),
    );
    expect(result.style).toEqual(
      style({
        id: 'water',
        type: 'fill',
        source: 'src',
        filter: ['==', ['get', 'kind'], 'lake'],
        paint: { 'fill-color': '#112233', 'fill-opacity': 0.5 },
      }),
    );
  });

  it('recolours only the classes named', () => {
    const result = applyPalette(
      style(
        { id: 'a', type: 'fill', paint: { 'fill-color': '#ff0000' } },
        { id: 'b', type: 'fill', paint: { 'fill-color': '#00ff00' } },
      ),
      palette({ b: '#0000ff' }),
    );
    expect(coloursOf(result.style)).toEqual({ a: '#ff0000', b: '#0000ff' });
    expect(result.changed).toEqual(['b']);
  });

  it('writes each paint property of a multi-property layer by its own id', () => {
    const result = applyPalette(
      style({
        id: 'roads',
        type: 'line',
        paint: { 'line-color': '#888888', 'text-color': '#333333' },
      }),
      palette({ 'roads:line': '#aaaaaa', 'roads:text': '#000000' }),
    );
    expect(coloursOf(result.style)).toEqual({
      'roads:line': '#aaaaaa',
      'roads:text': '#000000',
    });
  });

  it('names an id-less layer the way extraction does', () => {
    const result = applyPalette(
      style({ type: 'fill', paint: { 'fill-color': '#ff0000' } }),
      palette({ 'layer-0': '#00ff00' }),
    );
    expect(coloursOf(result.style)).toEqual({ 'layer-0': '#00ff00' });
  });
});

describe('applyPalette: match expressions', () => {
  const geology = style({
    id: 'units',
    type: 'fill',
    paint: {
      'fill-color': [
        'match',
        ['get', 'MapUnit'],
        'Qk',
        '#ff0000',
        ['Qm', 'Qmu'],
        '#00ff00',
        '#cccccc',
      ],
    },
  });

  it('replaces one branch and leaves its siblings alone', () => {
    const result = applyPalette(geology, palette({ 'units/Qk': '#123456' }));
    expect(coloursOf(result.style)).toEqual({
      'units/Qk': '#123456',
      'units/Qm|Qmu': '#00ff00',
      'units/default': '#cccccc',
    });
    expect(result.changed).toEqual(['units/Qk']);
  });

  it('replaces a multi-label branch under its joined id', () => {
    const result = applyPalette(geology, palette({ 'units/Qm|Qmu': '#123456' }));
    expect(coloursOf(result.style)['units/Qm|Qmu']).toBe('#123456');
  });

  it('replaces the trailing fallback under `default`', () => {
    const result = applyPalette(geology, palette({ 'units/default': '#123456' }));
    expect(coloursOf(result.style)['units/default']).toBe('#123456');
  });

  it('keeps the expression shape, labels and input', () => {
    const result = applyPalette(geology, palette({ 'units/Qk': '#123456' }));
    const layers = (result.style as { layers: Array<{ paint: Record<string, unknown> }> })
      .layers;
    expect(layers[0]?.paint['fill-color']).toEqual([
      'match',
      ['get', 'MapUnit'],
      'Qk',
      '#123456',
      ['Qm', 'Qmu'],
      '#00ff00',
      '#cccccc',
    ]);
  });

  it('round-trips every branch of a whole palette', () => {
    const wanted = palette({
      'units/Qk': '#111111',
      'units/Qm|Qmu': '#222222',
      'units/default': '#333333',
    });
    const result = applyPalette(geology, wanted);
    expect(result.changed).toHaveLength(3);
    expect(result.missing).toEqual([]);
    expect(coloursOf(result.style)).toEqual({
      'units/Qk': '#111111',
      'units/Qm|Qmu': '#222222',
      'units/default': '#333333',
    });
  });
});

describe('applyPalette: stop functions', () => {
  it('rewrites the stop the audit read, keeping the rest of the ramp', () => {
    const result = applyPalette(
      style({
        id: 'ramp',
        type: 'fill',
        paint: { 'fill-color': { stops: [[0, '#aaaaaa'], [10, '#bbbbbb']] } },
      }),
      palette({ ramp: '#123456' }),
    );
    const layers = (result.style as { layers: Array<{ paint: Record<string, unknown> }> })
      .layers;
    expect(layers[0]?.paint['fill-color']).toEqual({
      stops: [
        [0, '#aaaaaa'],
        [10, '#123456'],
      ],
    });
    expect(result.changed).toEqual(['ramp']);
  });
});

describe('applyPalette: nothing to write', () => {
  it('reports ids the style does not have', () => {
    const result = applyPalette(
      style({ id: 'water', type: 'fill', paint: { 'fill-color': '#aad3df' } }),
      palette({ water: '#112233', 'land/forest': '#004400' }),
    );
    expect(result.changed).toEqual(['water']);
    expect(result.missing).toEqual(['land/forest']);
  });

  it('skips a hidden layer, as extraction does', () => {
    const result = applyPalette(
      style({
        id: 'water',
        type: 'fill',
        layout: { visibility: 'none' },
        paint: { 'fill-color': '#aad3df' },
      }),
      palette({ water: '#112233' }),
    );
    expect(result.changed).toEqual([]);
    expect(result.missing).toEqual(['water']);
  });

  it('will not write a colour where none could be read', () => {
    const result = applyPalette(
      style({
        id: 'data',
        type: 'fill',
        paint: { 'fill-color': ['interpolate', ['linear'], ['get', 'n'], 0, '#000'] },
      }),
      palette({ data: '#112233' }),
    );
    expect(result.changed).toEqual([]);
    expect(result.missing).toEqual(['data']);
  });

  it('accepts a style with no layers at all', () => {
    const result = applyPalette({ version: 8 }, palette({ water: '#112233' }));
    expect(result.style).toEqual({ version: 8 });
    expect(result.changed).toEqual([]);
    expect(result.missing).toEqual(['water']);
  });

  it('accepts an empty palette', () => {
    const input = style({ id: 'water', type: 'fill', paint: { 'fill-color': '#aad3df' } });
    const result = applyPalette(input, new Map());
    expect(result.style).toEqual(input);
    expect(result.changed).toEqual([]);
    expect(result.missing).toEqual([]);
  });
});

describe('applyPalette: round trip with extraction', () => {
  it('every extracted class can be written back and read again', () => {
    const original = style(
      { id: 'bg', type: 'background', paint: { 'background-color': '#ffffff' } },
      { id: 'water', type: 'fill', paint: { 'fill-color': '#aad3df' } },
      {
        id: 'units',
        type: 'fill',
        paint: { 'fill-color': ['match', ['get', 'u'], 'a', '#ff0000', '#cccccc'] },
      },
      { id: 'roads', type: 'line', paint: { 'line-color': '#777777', 'line-opacity': 0.8 } },
      { id: 'labels', type: 'symbol', paint: { 'text-color': '#222222' } },
    );
    const classes = extractClasses(original);
    // A distinct, recognisable colour per class, by index.
    const wanted = new Map(
      classes.map((cls, index) => {
        const hex = `#${(index * 17 + 1).toString(16).padStart(2, '0').repeat(3)}`;
        return [cls.id, parseColor(hex)] as const;
      }),
    );

    const result = applyPalette(original, wanted);
    expect(result.changed).toEqual(classes.map((cls) => cls.id));
    expect(result.missing).toEqual([]);

    const after = extractClasses(result.style);
    expect(after.map((cls) => cls.id)).toEqual(classes.map((cls) => cls.id));
    for (const cls of after) {
      expect(rgbToHex(cls.color)).toBe(rgbToHex(wanted.get(cls.id) as RGB));
    }
  });
});
