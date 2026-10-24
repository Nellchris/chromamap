import { describe, expect, it } from 'vitest';

import {
  DEFAULT_THRESHOLD,
  VISION_MODES,
  runAudit,
  type AuditPair,
  type VisionMode,
} from '../../src/audit/engine.js';
import { parseColor, type RGB } from '../../src/color/parse.js';
import { extractClasses, type MapClass } from '../../src/style/extract.js';

/** A fill class with the given colour, opaque unless told otherwise. */
function fill(id: string, color: string, opacity = 1): MapClass {
  return { id, color: parseColor(color), type: 'fill', opacity };
}

/** The pair for one mode, found by class ids. */
function pairFor(pairs: readonly AuditPair[], mode: VisionMode, a: string, b: string): AuditPair {
  const found = pairs.find(
    (pair) => pair.mode === mode && pair.classA.id === a && pair.classB.id === b,
  );
  if (found === undefined) {
    throw new Error(`no ${mode} pair for ${a}/${b}`);
  }
  return found;
}

describe('runAudit: identical colours', () => {
  const result = runAudit([fill('a', '#ff0000'), fill('b', '#ff0000')]);

  it('reports zero distance in every mode', () => {
    expect(result.pairs).toHaveLength(VISION_MODES.length);
    for (const pair of result.pairs) {
      expect(pair.dE, pair.mode).toBe(0);
    }
  });

  it('reports 1:1 contrast', () => {
    for (const pair of result.pairs) {
      expect(pair.contrast, pair.mode).toBeCloseTo(1, 12);
    }
  });

  it('fails in every mode', () => {
    expect(result.pairs.every((pair) => !pair.pass)).toBe(true);
    expect(result.failing).toHaveLength(VISION_MODES.length);
    expect(result.summary).toEqual({
      total: 4,
      failing: 4,
      byMode: { normal: 1, protan: 1, deutan: 1, tritan: 1 },
    });
  });

  it('fails for two classes that differ only in paint type', () => {
    const classes: MapClass[] = [
      { id: 'outline', color: [1, 0, 0], type: 'line', opacity: 1 },
      { id: 'body', color: [1, 0, 0], type: 'fill', opacity: 1 },
    ];
    expect(runAudit(classes).summary.failing).toBe(4);
  });
});

describe('runAudit: colours nobody can confuse', () => {
  const result = runAudit([fill('k', 'black'), fill('w', 'white')]);

  it('passes in every mode', () => {
    expect(result.failing).toEqual([]);
    expect(result.summary.failing).toBe(0);
    expect(result.summary.byMode).toEqual({ normal: 0, protan: 0, deutan: 0, tritan: 0 });
  });

  it('reports the full distance and contrast in every mode', () => {
    // Dichromacy leaves neutrals alone, so all four modes agree.
    for (const pair of result.pairs) {
      expect(pair.dE, pair.mode).toBeCloseTo(100, 4);
      expect(pair.contrast, pair.mode).toBeCloseTo(21, 4);
      expect(pair.pass, pair.mode).toBe(true);
    }
  });
});

describe('runAudit: the sRGB primaries', () => {
  const classes = [fill('r', 'red'), fill('g', 'lime'), fill('b', 'blue')];
  const result = runAudit(classes);

  it('judges every unordered pair once per mode', () => {
    expect(result.pairs).toHaveLength(3 * VISION_MODES.length);
    expect(result.summary.total).toBe(12);
    const normal = result.pairs.filter((pair) => pair.mode === 'normal');
    expect(normal.map((pair) => `${pair.classA.id}/${pair.classB.id}`)).toEqual([
      'r/g',
      'r/b',
      'g/b',
    ]);
  });

  it('keeps saturated primaries clear of the default threshold', () => {
    // Fully saturated red and green stay 19+ apart even for deuteranopia, so
    // nothing here trips a threshold of 10.
    expect(result.summary.failing).toBe(0);
    expect(pairFor(result.pairs, 'normal', 'r', 'g').dE).toBeCloseTo(86.6082, 3);
    expect(pairFor(result.pairs, 'protan', 'r', 'g').dE).toBeCloseTo(42.4233, 3);
    expect(pairFor(result.pairs, 'deutan', 'r', 'g').dE).toBeCloseTo(19.4086, 3);
    expect(pairFor(result.pairs, 'tritan', 'r', 'g').dE).toBeCloseTo(75.6774, 3);
  });

  it('still shrinks the red/green distance under protan and deutan', () => {
    const normal = pairFor(result.pairs, 'normal', 'r', 'g').dE;
    expect(pairFor(result.pairs, 'protan', 'r', 'g').dE).toBeLessThan(normal / 2);
    expect(pairFor(result.pairs, 'deutan', 'r', 'g').dE).toBeLessThan(normal / 4);
  });

  it('flags the red/green pair for protan and deutan once the threshold rises', () => {
    const strict = runAudit(classes, { threshold: 50 });
    const flagged = strict.failing.map((pair) => `${pair.mode}:${pair.classA.id}/${pair.classB.id}`);
    expect(flagged).toContain('protan:r/g');
    expect(flagged).toContain('deutan:r/g');
    expect(flagged).not.toContain('normal:r/g');
    expect(strict.summary.byMode.normal).toBe(0);
  });
});

describe('runAudit: a pair protanopia actually collapses', () => {
  // Both of these simulate to #6d5f00 under protan: a bright red line over a
  // dark green fill is the textbook red/green failure.
  const classes = [fill('roads', '#ff0000'), fill('parks', '#006a00')];
  const result = runAudit(classes);

  it('flags only the protan pair at the default threshold', () => {
    expect(result.summary.failing).toBe(1);
    expect(result.summary.byMode).toEqual({ normal: 0, protan: 1, deutan: 0, tritan: 0 });
    expect(result.failing[0]?.mode).toBe('protan');
    expect(result.failing[0]?.classA.id).toBe('roads');
    expect(result.failing[0]?.classB.id).toBe('parks');
  });

  it('puts the two colours essentially on top of each other for protan', () => {
    expect(pairFor(result.pairs, 'protan', 'roads', 'parks').dE).toBeLessThan(1);
    expect(pairFor(result.pairs, 'normal', 'roads', 'parks').dE).toBeGreaterThan(70);
  });

  it('also loses the contrast difference for protan', () => {
    expect(pairFor(result.pairs, 'protan', 'roads', 'parks').contrast).toBeCloseTo(1, 1);
  });

  it('comes through a style extraction unchanged', () => {
    const extracted = extractClasses({
      version: 8,
      layers: [
        { id: 'roads', type: 'line', paint: { 'line-color': '#ff0000' } },
        { id: 'parks', type: 'fill', paint: { 'fill-color': '#006a00' } },
      ],
    });
    const fromStyle = runAudit(extracted);
    expect(fromStyle.summary.failing).toBe(1);
    expect(fromStyle.failing[0]?.mode).toBe('protan');
  });
});

describe('runAudit: options', () => {
  const classes = [fill('r', 'red'), fill('g', 'lime'), fill('b', 'blue')];

  it('honours a custom threshold', () => {
    expect(runAudit(classes, { threshold: 0 }).summary.failing).toBe(0);
    expect(runAudit(classes, { threshold: 10 }).summary.failing).toBe(0);
    expect(runAudit(classes, { threshold: 20 }).summary.failing).toBe(1);
    expect(runAudit(classes, { threshold: 1000 }).summary.failing).toBe(12);
  });

  it('defaults the threshold to DEFAULT_THRESHOLD', () => {
    expect(DEFAULT_THRESHOLD).toBe(10);
    expect(runAudit(classes).summary).toEqual(
      runAudit(classes, { threshold: DEFAULT_THRESHOLD }).summary,
    );
  });

  it('audits only the requested modes', () => {
    const result = runAudit(classes, { modes: ['protan'] });
    expect(result.summary.total).toBe(3);
    expect(new Set(result.pairs.map((pair) => pair.mode))).toEqual(new Set(['protan']));
    expect(result.summary.byMode).toEqual({ normal: 0, protan: 0, deutan: 0, tritan: 0 });
  });

  it('keeps the requested mode order', () => {
    const result = runAudit([fill('a', 'red'), fill('b', 'blue')], {
      modes: ['tritan', 'normal'],
    });
    expect(result.pairs.map((pair) => pair.mode)).toEqual(['tritan', 'normal']);
  });

  it('ignores a repeated mode rather than double-counting it', () => {
    const result = runAudit([fill('a', '#ff0000'), fill('b', '#ff0000')], {
      modes: ['protan', 'protan'],
    });
    expect(result.summary.total).toBe(1);
    expect(result.summary.failing).toBe(1);
    expect(result.summary.byMode.protan).toBe(1);
  });

  it('composites over the given background before comparing', () => {
    const translucent = [fill('a', 'red', 0.5), fill('b', 'white', 1)];
    const overWhite = runAudit(translucent, { modes: ['normal'] });
    const overBlack = runAudit(translucent, {
      modes: ['normal'],
      background: [0, 0, 0],
    });
    // Over white the half-opaque red washes out towards the white class; over
    // black it darkens away from it.
    expect(overBlack.summary.total).toBe(1);
    expect(overBlack.pairs[0]?.dE).toBeGreaterThan(overWhite.pairs[0]?.dE ?? 0);
  });

  it('makes fully transparent classes indistinguishable', () => {
    const invisible = [fill('a', 'red', 0), fill('b', 'blue', 0)];
    const result = runAudit(invisible, { modes: ['normal'] });
    expect(result.pairs[0]?.dE).toBe(0);
    expect(result.pairs[0]?.pass).toBe(false);
  });

  it('leaves opaque classes untouched by the background', () => {
    const opaque = [fill('a', 'red'), fill('b', 'blue')];
    const overWhite = runAudit(opaque, { modes: ['normal'] });
    const overBlack = runAudit(opaque, { modes: ['normal'], background: [0, 0, 0] });
    expect(overBlack.pairs[0]?.dE).toBeCloseTo(overWhite.pairs[0]?.dE ?? 0, 12);
  });
});

describe('runAudit: summary bookkeeping', () => {
  const classes = [
    fill('a', '#ff0000'),
    fill('b', '#006a00'),
    fill('c', '#ffffff'),
    fill('d', '#000000'),
  ];

  it('counts total as pairs times modes', () => {
    const result = runAudit(classes);
    expect(result.summary.total).toBe(6 * 4);
    expect(result.summary.total).toBe(result.pairs.length);
  });

  it('keeps failing consistent with the pair flags', () => {
    const result = runAudit(classes, { threshold: 40 });
    expect(result.summary.failing).toBe(result.failing.length);
    expect(result.failing).toEqual(result.pairs.filter((pair) => !pair.pass));
    expect(result.failing.every((pair) => pair.dE < 40)).toBe(true);
    expect(
      result.pairs.filter((pair) => pair.pass).every((pair) => pair.dE >= 40),
    ).toBe(true);
  });

  it('makes byMode sum to the failing count', () => {
    for (const threshold of [0, 5, 10, 25, 60, 120]) {
      const result = runAudit(classes, { threshold });
      const summed = VISION_MODES.reduce(
        (total, mode) => total + result.summary.byMode[mode],
        0,
      );
      expect(summed, `threshold ${String(threshold)}`).toBe(result.summary.failing);
    }
  });

  it('attributes each failure to its own mode', () => {
    const result = runAudit(classes, { threshold: 40 });
    for (const mode of VISION_MODES) {
      const counted = result.failing.filter((pair) => pair.mode === mode).length;
      expect(counted, mode).toBe(result.summary.byMode[mode]);
    }
  });

  it('reports a contrast ratio in 1..21 for every pair', () => {
    for (const pair of runAudit(classes).pairs) {
      expect(pair.contrast).toBeGreaterThanOrEqual(1);
      expect(pair.contrast).toBeLessThanOrEqual(21);
    }
  });

  it('references the class objects the caller passed in', () => {
    const result = runAudit(classes, { modes: ['normal'] });
    expect(result.pairs[0]?.classA).toBe(classes[0]);
    expect(result.pairs[0]?.classB).toBe(classes[1]);
  });
});

describe('runAudit: degenerate input', () => {
  it('has nothing to compare for fewer than two classes', () => {
    const empty = runAudit([]);
    expect(empty.pairs).toEqual([]);
    expect(empty.failing).toEqual([]);
    expect(empty.summary).toEqual({
      total: 0,
      failing: 0,
      byMode: { normal: 0, protan: 0, deutan: 0, tritan: 0 },
    });
    expect(runAudit([fill('only', 'red')]).summary.total).toBe(0);
  });

  it('accepts an empty mode list', () => {
    const result = runAudit([fill('a', 'red'), fill('b', 'blue')], { modes: [] });
    expect(result.pairs).toEqual([]);
    expect(result.summary.total).toBe(0);
  });

  it('scales to a larger class set', () => {
    const many: MapClass[] = Array.from({ length: 12 }, (_, index) => {
      const channel = index / 11;
      const color: RGB = [channel, 1 - channel, 0.5];
      return { id: `c${String(index)}`, color, type: 'fill', opacity: 1 };
    });
    const result = runAudit(many);
    expect(result.summary.total).toBe(((12 * 11) / 2) * 4);
    expect(result.pairs.every((pair) => Number.isFinite(pair.dE))).toBe(true);
  });
});
