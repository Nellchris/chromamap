import { describe, expect, it } from 'vitest';

import {
  LUMINANCE_WEIGHTS,
  contrastRatio,
  linearToSrgb,
  relativeLuminance,
  srgbToLinear,
} from '../../src/color/wcag.js';

/** The sRGB transfer function switches from linear to a power curve here. */
const CUTOFF = 0.04045;

describe('srgbToLinear', () => {
  it('maps the endpoints onto themselves', () => {
    expect(srgbToLinear(0)).toBe(0);
    expect(srgbToLinear(1)).toBeCloseTo(1, 12);
  });

  it('divides by 12.92 below the cutoff', () => {
    expect(srgbToLinear(0.02)).toBeCloseTo(0.02 / 12.92, 12);
    expect(srgbToLinear(CUTOFF)).toBeCloseTo(CUTOFF / 12.92, 12);
  });

  it('uses the 2.4 power curve above the cutoff', () => {
    expect(srgbToLinear(0.5)).toBeCloseTo(Math.pow((0.5 + 0.055) / 1.055, 2.4), 12);
    expect(srgbToLinear(0.5)).toBeCloseTo(0.21404114048223255, 12);
  });

  it('is continuous across the cutoff', () => {
    const below = srgbToLinear(CUTOFF - 1e-9);
    const above = srgbToLinear(CUTOFF + 1e-9);
    expect(Math.abs(above - below)).toBeLessThan(1e-6);
  });

  it('is monotonically increasing', () => {
    let previous = -Infinity;
    for (let i = 0; i <= 255; i += 1) {
      const value = srgbToLinear(i / 255);
      expect(value).toBeGreaterThan(previous);
      previous = value;
    }
  });
});

describe('linearToSrgb', () => {
  it('maps the endpoints onto themselves', () => {
    expect(linearToSrgb(0)).toBe(0);
    expect(linearToSrgb(1)).toBeCloseTo(1, 12);
  });

  it('round-trips srgbToLinear for every 8-bit channel value', () => {
    for (let i = 0; i <= 255; i += 1) {
      const channel = i / 255;
      expect(linearToSrgb(srgbToLinear(channel))).toBeCloseTo(channel, 12);
    }
  });
});

describe('relativeLuminance', () => {
  it('is 0 for black', () => {
    expect(relativeLuminance(0, 0, 0)).toBe(0);
  });

  it('is 1 for white', () => {
    expect(relativeLuminance(1, 1, 1)).toBeCloseTo(1, 12);
  });

  it('returns the channel weight for each pure primary', () => {
    expect(relativeLuminance(1, 0, 0)).toBeCloseTo(LUMINANCE_WEIGHTS.r, 12);
    expect(relativeLuminance(0, 1, 0)).toBeCloseTo(LUMINANCE_WEIGHTS.g, 12);
    expect(relativeLuminance(0, 0, 1)).toBeCloseTo(LUMINANCE_WEIGHTS.b, 12);
  });

  it('weights green above red above blue', () => {
    const red = relativeLuminance(1, 0, 0);
    const green = relativeLuminance(0, 1, 0);
    const blue = relativeLuminance(0, 0, 1);
    expect(green).toBeGreaterThan(red);
    expect(red).toBeGreaterThan(blue);
  });

  it('sums the primaries to white', () => {
    const summed =
      relativeLuminance(1, 0, 0) +
      relativeLuminance(0, 1, 0) +
      relativeLuminance(0, 0, 1);
    expect(summed).toBeCloseTo(relativeLuminance(1, 1, 1), 12);
  });
});

describe('contrastRatio', () => {
  const black = relativeLuminance(0, 0, 0);
  const white = relativeLuminance(1, 1, 1);

  it('is 21:1 for black on white', () => {
    expect(contrastRatio(black, white)).toBeCloseTo(21, 10);
  });

  it('is 1:1 for a colour against itself', () => {
    expect(contrastRatio(white, white)).toBeCloseTo(1, 12);
    expect(contrastRatio(black, black)).toBeCloseTo(1, 12);
    expect(contrastRatio(0.3, 0.3)).toBeCloseTo(1, 12);
  });

  it('is commutative', () => {
    expect(contrastRatio(black, white)).toBeCloseTo(contrastRatio(white, black), 12);
    expect(contrastRatio(0.1, 0.7)).toBeCloseTo(contrastRatio(0.7, 0.1), 12);
  });

  it('is never below 1', () => {
    const luminances = [0, 0.02, 0.05, 0.18, 0.5, 0.7152, 0.95, 1];
    for (const a of luminances) {
      for (const b of luminances) {
        expect(contrastRatio(a, b)).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('never exceeds 21', () => {
    const luminances = [0, 0.02, 0.05, 0.18, 0.5, 0.7152, 0.95, 1];
    for (const a of luminances) {
      for (const b of luminances) {
        expect(contrastRatio(a, b)).toBeLessThanOrEqual(21 + 1e-9);
      }
    }
  });

  it('matches the published ratio for mid grey on white', () => {
    // #767676 is the lightest grey that still clears 4.5:1 against white.
    const grey = relativeLuminance(0x76 / 255, 0x76 / 255, 0x76 / 255);
    expect(contrastRatio(grey, white)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(grey, white)).toBeLessThan(4.6);
  });
});
