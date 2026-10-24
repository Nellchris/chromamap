import { describe, expect, it } from 'vitest';

import {
  D65_WHITE,
  ciede2000,
  rgbToLab,
  srgbToXyz,
  xyzToLab,
  type Lab,
} from '../../src/color/lab.js';

describe('srgbToXyz', () => {
  it('maps black to the origin', () => {
    expect(srgbToXyz(0, 0, 0)).toEqual([0, 0, 0]);
  });

  it('maps white onto the D65 reference white', () => {
    const [x, y, z] = srgbToXyz(1, 1, 1);
    expect(x).toBeCloseTo(D65_WHITE.x, 6);
    expect(y).toBeCloseTo(D65_WHITE.y, 6);
    expect(z).toBeCloseTo(D65_WHITE.z, 6);
  });

  it('returns the matrix columns for the pure primaries', () => {
    const [xr, yr, zr] = srgbToXyz(1, 0, 0);
    expect(xr).toBeCloseTo(0.4124564, 7);
    expect(yr).toBeCloseTo(0.2126729, 7);
    expect(zr).toBeCloseTo(0.0193339, 7);

    const [xg, yg, zg] = srgbToXyz(0, 1, 0);
    expect(xg).toBeCloseTo(0.3575761, 7);
    expect(yg).toBeCloseTo(0.7151522, 7);
    expect(zg).toBeCloseTo(0.119192, 7);

    const [xb, yb, zb] = srgbToXyz(0, 0, 1);
    expect(xb).toBeCloseTo(0.1804375, 7);
    expect(yb).toBeCloseTo(0.072175, 7);
    expect(zb).toBeCloseTo(0.9503041, 7);
  });

  it('gives mid grey the luminance of the sRGB transfer function', () => {
    const [, y] = srgbToXyz(0.5, 0.5, 0.5);
    // The same 0.5 -> 0.2140411 linearisation the WCAG module uses.
    expect(y).toBeCloseTo(0.21404114, 7);
  });

  it('is additive across the primaries', () => {
    const [xr, yr, zr] = srgbToXyz(1, 0, 0);
    const [xg, yg, zg] = srgbToXyz(0, 1, 0);
    const [xb, yb, zb] = srgbToXyz(0, 0, 1);
    const [xw, yw, zw] = srgbToXyz(1, 1, 1);
    expect(xr + xg + xb).toBeCloseTo(xw, 12);
    expect(yr + yg + yb).toBeCloseTo(yw, 12);
    expect(zr + zg + zb).toBeCloseTo(zw, 12);
  });
});

describe('xyzToLab', () => {
  it('maps the reference white to L*=100 with no chroma', () => {
    const lab = xyzToLab(D65_WHITE.x, D65_WHITE.y, D65_WHITE.z);
    expect(lab.L).toBeCloseTo(100, 12);
    expect(lab.a).toBeCloseTo(0, 12);
    expect(lab.b).toBeCloseTo(0, 12);
  });

  it('maps the origin to L*=0 with no chroma', () => {
    const lab = xyzToLab(0, 0, 0);
    expect(lab.L).toBe(0);
    expect(lab.a).toBe(0);
    expect(lab.b).toBe(0);
  });

  it('uses the linear segment below the CIE crossover', () => {
    // epsilon = 216/24389; just below it the transfer function is (kappa*t+16)/116.
    const epsilon = 216 / 24389;
    const kappa = 24389 / 27;
    const t = epsilon * 0.5;
    const lab = xyzToLab(D65_WHITE.x * t, D65_WHITE.y * t, D65_WHITE.z * t);
    expect(lab.L).toBeCloseTo(116 * ((kappa * t + 16) / 116) - 16, 12);
    expect(lab.a).toBeCloseTo(0, 12);
    expect(lab.b).toBeCloseTo(0, 12);
  });

  it('is continuous across the crossover', () => {
    const epsilon = 216 / 24389;
    const below = xyzToLab(0, D65_WHITE.y * (epsilon - 1e-12), 0).L;
    const above = xyzToLab(0, D65_WHITE.y * (epsilon + 1e-12), 0).L;
    expect(Math.abs(above - below)).toBeLessThan(1e-6);
  });
});

describe('rgbToLab', () => {
  it('maps black to the Lab origin', () => {
    expect(rgbToLab([0, 0, 0])).toEqual({ L: 0, a: 0, b: 0 });
  });

  it('maps white to L*=100 with no chroma', () => {
    const lab = rgbToLab([1, 1, 1]);
    expect(lab.L).toBeCloseTo(100, 4);
    expect(lab.a).toBeCloseTo(0, 4);
    expect(lab.b).toBeCloseTo(0, 4);
  });

  it('matches the published Lab values for the sRGB primaries', () => {
    const red = rgbToLab([1, 0, 0]);
    expect(red.L).toBeCloseTo(53.2408, 4);
    expect(red.a).toBeCloseTo(80.0925, 4);
    expect(red.b).toBeCloseTo(67.2032, 4);

    const green = rgbToLab([0, 1, 0]);
    expect(green.L).toBeCloseTo(87.7347, 4);
    expect(green.a).toBeCloseTo(-86.1827, 4);
    expect(green.b).toBeCloseTo(83.1793, 4);

    const blue = rgbToLab([0, 0, 1]);
    expect(blue.L).toBeCloseTo(32.297, 4);
    expect(blue.a).toBeCloseTo(79.1875, 4);
    expect(blue.b).toBeCloseTo(-107.8602, 4);
  });

  it('keeps neutral greys achromatic', () => {
    for (const g of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      const lab = rgbToLab([g, g, g]);
      expect(lab.a).toBeCloseTo(0, 3);
      expect(lab.b).toBeCloseTo(0, 3);
    }
  });

  it('increases L* with lightness', () => {
    let previous = -Infinity;
    for (let i = 0; i <= 255; i += 1) {
      const g = i / 255;
      const { L } = rgbToLab([g, g, g]);
      expect(L).toBeGreaterThan(previous);
      previous = L;
    }
  });
});

describe('ciede2000', () => {
  /**
   * Sharma, Wu and Dalal (2005), Table 1. The paper quotes dE00 to four
   * decimals, so agreement is asserted to within that rounding; the second
   * number locks our own value against future refactors.
   */
  const sharma: ReadonlyArray<{
    readonly lab1: Lab;
    readonly lab2: Lab;
    readonly published: number;
    readonly computed: number;
  }> = [
    {
      lab1: { L: 50.0, a: 2.6772, b: -79.7751 },
      lab2: { L: 50.0, a: 0.0, b: -82.7485 },
      published: 2.0425,
      computed: 2.0424596802,
    },
    {
      lab1: { L: 50.0, a: 3.1571, b: -77.2803 },
      lab2: { L: 50.0, a: 0.0, b: -82.7485 },
      published: 2.8615,
      computed: 2.8615101747,
    },
    {
      lab1: { L: 50.0, a: 2.8361, b: -74.02 },
      lab2: { L: 50.0, a: 0.0, b: -82.7485 },
      published: 3.4412,
      computed: 3.4411905987,
    },
    {
      lab1: { L: 50.0, a: -1.3802, b: -84.2814 },
      lab2: { L: 50.0, a: 0.0, b: -82.7485 },
      published: 1.0,
      computed: 0.9999988648,
    },
    {
      lab1: { L: 2.0776, a: 0.0795, b: -1.135 },
      lab2: { L: 0.9033, a: -0.0636, b: -0.5514 },
      published: 0.9082,
      computed: 0.9082328396,
    },
  ];

  for (const { lab1, lab2, published, computed } of sharma) {
    it(`matches the published dE00 of ${published.toFixed(4)}`, () => {
      const actual = ciede2000(lab1, lab2);
      expect(Math.abs(actual - published)).toBeLessThan(1e-4);
      expect(actual).toBeCloseTo(computed, 9);
    });
  }

  it('is 0 for a colour against itself', () => {
    const white = rgbToLab([1, 1, 1]);
    expect(ciede2000(white, white)).toBe(0);
    expect(ciede2000({ L: 0, a: 0, b: 0 }, { L: 0, a: 0, b: 0 })).toBe(0);
    expect(ciede2000({ L: 50, a: 20, b: -30 }, { L: 50, a: 20, b: -30 })).toBe(0);
  });

  it('is large for black against white', () => {
    const black = rgbToLab([0, 0, 0]);
    const white = rgbToLab([1, 1, 1]);
    expect(ciede2000(black, white)).toBeGreaterThan(99);
    expect(ciede2000(black, white)).toBeCloseTo(100, 4);
  });

  it('is symmetric', () => {
    for (const { lab1, lab2 } of sharma) {
      expect(ciede2000(lab1, lab2)).toBeCloseTo(ciede2000(lab2, lab1), 12);
    }
    const red = rgbToLab([1, 0, 0]);
    const green = rgbToLab([0, 1, 0]);
    expect(ciede2000(red, green)).toBeCloseTo(ciede2000(green, red), 12);
  });

  it('is never negative', () => {
    const samples: readonly Lab[] = [
      { L: 0, a: 0, b: 0 },
      { L: 50, a: 0, b: 0 },
      { L: 100, a: 0, b: 0 },
      { L: 50, a: 60, b: -60 },
      { L: 20, a: -40, b: 30 },
      { L: 80, a: 10, b: 90 },
    ];
    for (const a of samples) {
      for (const b of samples) {
        expect(ciede2000(a, b)).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('handles a zero-chroma colour on either side', () => {
    const grey: Lab = { L: 50, a: 0, b: 0 };
    const colour: Lab = { L: 50, a: 30, b: 40 };
    expect(Number.isFinite(ciede2000(grey, colour))).toBe(true);
    expect(Number.isFinite(ciede2000(colour, grey))).toBe(true);
    expect(ciede2000(grey, grey)).toBe(0);
  });

  it('separates the sRGB primaries by far more than the 1.0 threshold', () => {
    const red = rgbToLab([1, 0, 0]);
    const green = rgbToLab([0, 1, 0]);
    const blue = rgbToLab([0, 0, 1]);
    expect(ciede2000(red, green)).toBeGreaterThan(20);
    expect(ciede2000(red, blue)).toBeGreaterThan(20);
    expect(ciede2000(green, blue)).toBeGreaterThan(20);
  });
});
