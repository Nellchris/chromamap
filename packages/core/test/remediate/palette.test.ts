import { describe, expect, it } from 'vitest';

import { runAudit } from '../../src/audit/engine.js';
import { rgbToLab } from '../../src/color/lab.js';
import { parseColor, type RGB } from '../../src/color/parse.js';
import {
  REMEDIATION_LIGHTNESS,
  closestPair,
  generateAccessiblePalette,
} from '../../src/remediate/palette.js';
import type { MapClass } from '../../src/style/extract.js';

function fills(...hexes: string[]): MapClass[] {
  return hexes.map((hex, index) => ({
    id: `c${String(index)}`,
    color: parseColor(hex),
    type: 'fill',
    opacity: 1,
  }));
}

/** The classes as remediated, ready to audit. */
function remediated(classes: MapClass[], background?: RGB): MapClass[] {
  const palette =
    background === undefined
      ? generateAccessiblePalette(classes)
      : generateAccessiblePalette(classes, { background });
  return classes.map((cls, index) => ({
    ...cls,
    color: palette[index]?.remediated ?? cls.color,
  }));
}

function failures(classes: MapClass[]): number {
  return runAudit(classes).summary.failing;
}

/** Hue angle in degrees, 0..360. */
function hue(color: RGB): number {
  const lab = rgbToLab(color);
  const degrees = (Math.atan2(lab.b, lab.a) * 180) / Math.PI;
  return degrees < 0 ? degrees + 360 : degrees;
}

/** Shortest angular distance between two hues. */
function hueShift(before: RGB, after: RGB): number {
  const delta = Math.abs(hue(before) - hue(after)) % 360;
  return delta > 180 ? 360 - delta : delta;
}

/** Four colours far enough apart that redistribution alone settles them. */
const EASY = ['#e8232a', '#2a7fe8', '#2ae86a', '#e8d02a'];

/** A palette that genuinely clashes: reds and oranges of similar lightness. */
const CLASHING = ['#e8232a', '#ef5a4b', '#d62f2a', '#e8552e', '#f08a3c', '#f2a154'];

describe('generateAccessiblePalette: shape of the result', () => {
  it('returns one entry per class, in order', () => {
    const classes = fills(...EASY);
    const palette = generateAccessiblePalette(classes);
    expect(palette).toHaveLength(classes.length);
    expect(palette.map((entry) => entry.classId)).toEqual(['c0', 'c1', 'c2', 'c3']);
  });

  it('carries the original colour alongside the new one', () => {
    const classes = fills(...EASY);
    const palette = generateAccessiblePalette(classes);
    for (const [index, entry] of palette.entries()) {
      expect(entry.original, entry.classId).toEqual(classes[index]?.color);
    }
  });

  it('returns colours inside the sRGB cube', () => {
    for (const hexes of [EASY, CLASHING, ['#000000', '#ffffff', '#7f7f7f']]) {
      for (const entry of generateAccessiblePalette(fills(...hexes))) {
        for (const channel of entry.remediated) {
          expect(channel, entry.classId).toBeGreaterThanOrEqual(0);
          expect(channel, entry.classId).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('does not mutate the classes it was given', () => {
    const classes = fills(...CLASHING);
    const before = classes.map((cls) => [...cls.color]);
    generateAccessiblePalette(classes);
    expect(classes.map((cls) => [...cls.color])).toEqual(before);
  });
});

describe('generateAccessiblePalette: it actually helps', () => {
  it('never leaves a palette worse than it found it', () => {
    for (const hexes of [EASY, CLASHING, ['#aa3333', '#aa3838', '#aa3d3d', '#aa4242']]) {
      const classes = fills(...hexes);
      expect(failures(remediated(classes)), hexes.join(',')).toBeLessThanOrEqual(
        failures(classes),
      );
    }
  });

  it('clears a palette that clashes badly', () => {
    const classes = fills(...CLASHING);
    expect(failures(classes)).toBeGreaterThan(0);
    expect(failures(remediated(classes))).toBe(0);
  });

  it('clears a ten-class palette', () => {
    const classes = fills(
      '#e8232a',
      '#2a7fe8',
      '#2ae86a',
      '#e8d02a',
      '#8a2ae8',
      '#2ae8d0',
      '#e8762a',
      '#762ae8',
      '#b0e82a',
      '#e82a9a',
    );
    expect(failures(remediated(classes))).toBe(0);
  });

  it('gets close, but cannot clear a palette with too many classes', () => {
    // Eighteen classes over a 60 L* band leaves 3.5 L* between neighbours, and
    // dichromacy takes away the hue that would otherwise separate them. The
    // honest result is a large improvement, not a clean sheet.
    const classes = Array.from({ length: 18 }, (_, index) =>
      fills(`#${((index * 0x0f1e2d + 0x884422) & 0xffffff).toString(16).padStart(6, '0')}`)[0],
    ).filter((cls): cls is MapClass => cls !== undefined);
    const after = failures(remediated(classes));
    expect(after).toBeLessThan(failures(classes));
  });
});

describe('generateAccessiblePalette: lightness', () => {
  it('spreads the classes evenly across the ramp', () => {
    const palette = generateAccessiblePalette(fills(...CLASHING));
    const lightness = palette.map((entry) => rgbToLab(entry.remediated).L).sort((a, b) => a - b);

    expect(lightness[0]).toBeCloseTo(REMEDIATION_LIGHTNESS.min, 1);
    expect(lightness.at(-1)).toBeCloseTo(REMEDIATION_LIGHTNESS.max, 1);

    const gaps = lightness.slice(1).map((value, index) => value - (lightness[index] ?? 0));
    const expected =
      (REMEDIATION_LIGHTNESS.max - REMEDIATION_LIGHTNESS.min) / (lightness.length - 1);
    for (const gap of gaps) {
      expect(gap).toBeCloseTo(expected, 1);
    }
  });

  it('is more evenly spread than it was', () => {
    const classes = fills(...CLASHING);
    const spread = (colours: readonly RGB[]): number => {
      const lightness = colours.map((colour) => rgbToLab(colour).L).sort((a, b) => a - b);
      const gaps = lightness.slice(1).map((value, index) => value - (lightness[index] ?? 0));
      const mean = gaps.reduce((total, gap) => total + gap, 0) / gaps.length;
      return Math.sqrt(
        gaps.reduce((total, gap) => total + (gap - mean) ** 2, 0) / gaps.length,
      );
    };
    const before = spread(classes.map((cls) => cls.color));
    const after = spread(remediated(classes).map((cls) => cls.color));
    expect(after).toBeLessThan(before);
    expect(after).toBeLessThan(0.5);
  });

  it('keeps the light-to-dark ordering the author chose', () => {
    const classes = fills('#111111', '#888888', '#eeeeee');
    const palette = generateAccessiblePalette(classes);
    const lightness = palette.map((entry) => rgbToLab(entry.remediated).L);
    expect(lightness[0]).toBeLessThan(lightness[1] ?? 0);
    expect(lightness[1]).toBeLessThan(lightness[2] ?? 0);
  });
});

describe('generateAccessiblePalette: hue', () => {
  it('leaves hue untouched when lightness alone is enough', () => {
    const classes = fills(...EASY);
    const palette = generateAccessiblePalette(classes);
    // Nothing clashes after redistribution, so nothing gets nudged, and the
    // gamut mapping preserves hue exactly.
    expect(failures(remediated(classes))).toBe(0);
    for (const [index, entry] of palette.entries()) {
      const original = classes[index]?.color;
      if (original !== undefined) {
        expect(hueShift(original, entry.remediated), entry.classId).toBeLessThan(1);
      }
    }
  });

  it('moves hue only in whole nudges, never by accident', () => {
    // Every shift should be a multiple of the 30° nudge: gamut mapping must
    // not quietly rotate a colour on its own.
    for (const hexes of [EASY, CLASHING]) {
      const classes = fills(...hexes);
      const palette = generateAccessiblePalette(classes);
      for (const [index, entry] of palette.entries()) {
        const original = classes[index]?.color;
        if (original === undefined) {
          continue;
        }
        const shift = hueShift(original, entry.remediated);
        expect(Math.abs(shift - 30 * Math.round(shift / 30)), entry.classId).toBeLessThan(1);
      }
    }
  });

  it('will trade hue away when it has to', () => {
    // A palette of near-identical reds cannot be separated by lightness alone
    // at six classes, so some hues move a long way. That is the point.
    const palette = generateAccessiblePalette(fills(...CLASHING));
    const shifts = palette.map((entry, index) => {
      const original = fills(...CLASHING)[index]?.color;
      return original === undefined ? 0 : hueShift(original, entry.remediated);
    });
    expect(Math.max(...shifts)).toBeGreaterThan(0);
  });
});

describe('generateAccessiblePalette: options', () => {
  it('checks against the background it is given', () => {
    const classes = fills('#ff0000', '#00ff00', '#0000ff').map((cls) => ({
      ...cls,
      opacity: 0.5,
    }));
    const overWhite = generateAccessiblePalette(classes);
    const overBlack = generateAccessiblePalette(classes, { background: [0, 0, 0] });
    expect(overWhite).toHaveLength(3);
    expect(overBlack).toHaveLength(3);
    // Both must leave the palette no worse off against their own background.
    expect(
      runAudit(
        classes.map((cls, index) => ({ ...cls, color: overBlack[index]?.remediated ?? cls.color })),
        { background: [0, 0, 0] },
      ).summary.failing,
    ).toBeLessThanOrEqual(runAudit(classes, { background: [0, 0, 0] }).summary.failing);
  });
});

describe('generateAccessiblePalette: edge cases', () => {
  it('returns nothing for no classes', () => {
    expect(generateAccessiblePalette([])).toEqual([]);
  });

  it('leaves a single class where it is', () => {
    const classes = fills('#e8232a');
    const palette = generateAccessiblePalette(classes);
    expect(palette).toHaveLength(1);
    const before = rgbToLab(classes[0]?.color ?? [0, 0, 0]);
    const after = rgbToLab(palette[0]?.remediated ?? [0, 0, 0]);
    // The colour still makes a round trip through XYZ, which costs a few
    // millionths of an L* unit.
    expect(after.L).toBeCloseTo(before.L, 4);
    expect(hueShift(classes[0]?.color ?? [0, 0, 0], palette[0]?.remediated ?? [0, 0, 0])).toBeLessThan(1);
  });

  it('puts two classes at the ends of the ramp', () => {
    const palette = generateAccessiblePalette(fills('#888888', '#999999'));
    const lightness = palette.map((entry) => rgbToLab(entry.remediated).L).sort((a, b) => a - b);
    expect(lightness[0]).toBeCloseTo(REMEDIATION_LIGHTNESS.min, 1);
    expect(lightness[1]).toBeCloseTo(REMEDIATION_LIGHTNESS.max, 1);
  });

  it('separates classes that start at the same lightness', () => {
    // Three hues, one lightness: nothing to sort by, everything to fix.
    const classes = fills('#ff0000', '#00a0ff', '#00b100');
    const before = failures(classes);
    const after = remediated(classes);
    expect(failures(after)).toBeLessThanOrEqual(before);
    const lightness = after.map((cls) => rgbToLab(cls.color).L).sort((a, b) => a - b);
    expect((lightness[2] ?? 0) - (lightness[0] ?? 0)).toBeCloseTo(
      REMEDIATION_LIGHTNESS.max - REMEDIATION_LIGHTNESS.min,
      1,
    );
  });

  it('copes with pure black and pure white', () => {
    const palette = generateAccessiblePalette(fills('#000000', '#ffffff'));
    for (const entry of palette) {
      for (const channel of entry.remediated) {
        expect(Number.isFinite(channel)).toBe(true);
      }
    }
  });
});

describe('closestPair', () => {
  it('is Infinity when there is nothing to compare', () => {
    expect(closestPair([])).toBe(Number.POSITIVE_INFINITY);
    expect(closestPair(fills('#ff0000'))).toBe(Number.POSITIVE_INFINITY);
  });

  it('is 0 for a repeated colour', () => {
    expect(closestPair(fills('#ff0000', '#ff0000'))).toBe(0);
  });

  it('finds the closest pair, not the first', () => {
    const classes = fills('#000000', '#ffffff', '#fefefe');
    expect(closestPair(classes)).toBeLessThan(1);
  });
});
