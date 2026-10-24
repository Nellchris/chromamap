import { describe, expect, it } from 'vitest';

import { CVD_MATRICES, simulateCVD, type CVDType } from '../../src/color/cvd.js';
import { ciede2000, rgbToLab } from '../../src/color/lab.js';
import { rgbToHex, type RGB } from '../../src/color/parse.js';

const TYPES: readonly CVDType[] = ['protan', 'deutan', 'tritan'];

const RED: RGB = [1, 0, 0];
const GREEN: RGB = [0, 1, 0];
const BLUE: RGB = [0, 0, 1];

describe('CVD_MATRICES', () => {
  it('has a 3x3 matrix for each dichromacy', () => {
    for (const type of TYPES) {
      const matrix = CVD_MATRICES[type];
      expect(matrix, type).toHaveLength(3);
      for (const row of matrix) {
        expect(row, type).toHaveLength(3);
        for (const value of row) {
          expect(Number.isFinite(value), type).toBe(true);
        }
      }
    }
  });

  it('has rows summing to 1, which is what preserves neutrals', () => {
    for (const type of TYPES) {
      for (const row of CVD_MATRICES[type]) {
        const sum = row[0] + row[1] + row[2];
        // The published coefficients carry six decimals, so the sums land
        // within one rounding unit of 1 rather than exactly on it.
        expect(Math.abs(sum - 1), `${type} row sum ${String(sum)}`).toBeLessThan(2e-6);
      }
    }
  });
});

describe('simulateCVD: neutrals', () => {
  it('leaves every 8-bit grey unchanged', () => {
    for (const type of TYPES) {
      for (let i = 0; i <= 255; i += 1) {
        const g = i / 255;
        const out = simulateCVD([g, g, g], type);
        expect(out[0], `${type} @ ${String(i)}`).toBeCloseTo(g, 5);
        expect(out[1], `${type} @ ${String(i)}`).toBeCloseTo(g, 5);
        expect(out[2], `${type} @ ${String(i)}`).toBeCloseTo(g, 5);
      }
    }
  });

  it('keeps the whole grey ramp within a rounding unit of 8-bit', () => {
    for (const type of TYPES) {
      let worst = 0;
      for (let i = 0; i <= 255; i += 1) {
        const g = i / 255;
        for (const channel of simulateCVD([g, g, g], type)) {
          worst = Math.max(worst, Math.abs(channel - g));
        }
      }
      // Well under half an 8-bit step (1/510), so greys round-trip to the
      // same hex they went in as.
      expect(worst, type).toBeLessThan(1e-6);
    }
  });

  it('maps black and white to themselves exactly', () => {
    for (const type of TYPES) {
      expect(rgbToHex(simulateCVD([0, 0, 0], type)), type).toBe('#000000');
      expect(rgbToHex(simulateCVD([1, 1, 1], type)), type).toBe('#ffffff');
    }
  });
});

describe('simulateCVD: known transforms', () => {
  it('transforms pure red through protan as the matrix dictates', () => {
    // Linear red is (1, 0, 0), so the output is the matrix's first column:
    // (0.152286, 0.114503, -0.003882), clamped then re-encoded to sRGB.
    const out = simulateCVD(RED, 'protan');
    expect(out[0]).toBeCloseTo(0.426608471711, 9);
    expect(out[1]).toBeCloseTo(0.372654277423, 9);
    expect(out[2]).toBe(0);
    expect(rgbToHex(out)).toBe('#6d5f00');
  });

  it('clamps the negative blue coefficient rather than emitting NaN', () => {
    // protan's blue row starts at -0.003882, which drives linear blue below 0.
    const out = simulateCVD(RED, 'protan');
    expect(Number.isNaN(out[2])).toBe(false);
    expect(out[2]).toBe(0);
  });

  it('transforms pure red through deutan and tritan as the matrix dictates', () => {
    expect(rgbToHex(simulateCVD(RED, 'deutan'))).toBe('#a39000');
    expect(rgbToHex(simulateCVD(RED, 'tritan'))).toBe('#ff000f');
  });

  it('leaves the channel each dichromacy barely touches at full strength', () => {
    // protan's blue row is almost the identity, so pure blue keeps full blue.
    // The clamp lands on linear 1.0, which re-encodes to 1 within float
    // epsilon rather than exactly 1.
    expect(simulateCVD(BLUE, 'protan')[2]).toBeCloseTo(1, 12);
    // tritan's red row is likewise near-identity for pure red.
    expect(simulateCVD(RED, 'tritan')[0]).toBeCloseTo(1, 12);
  });

  it('keeps every output channel in 0..1', () => {
    for (const type of TYPES) {
      for (let r = 0; r <= 8; r += 1) {
        for (let g = 0; g <= 8; g += 1) {
          for (let b = 0; b <= 8; b += 1) {
            const out = simulateCVD([r / 8, g / 8, b / 8], type);
            for (const channel of out) {
              expect(channel, type).toBeGreaterThanOrEqual(0);
              expect(channel, type).toBeLessThanOrEqual(1);
            }
          }
        }
      }
    }
  });

  it('does not mutate its input', () => {
    const input: RGB = [0.2, 0.4, 0.6];
    simulateCVD(input, 'deutan');
    expect(input).toEqual([0.2, 0.4, 0.6]);
  });
});

describe('simulateCVD: red/green confusion', () => {
  const originalRedGreen = ciede2000(rgbToLab(RED), rgbToLab(GREEN));

  it('pulls red and green together for protan and deutan', () => {
    for (const type of ['protan', 'deutan'] as const) {
      const simulated = ciede2000(
        rgbToLab(simulateCVD(RED, type)),
        rgbToLab(simulateCVD(GREEN, type)),
      );
      expect(simulated, type).toBeLessThan(originalRedGreen / 2);
    }
  });

  it('confuses red and green more for deutan than for protan', () => {
    const protan = ciede2000(
      rgbToLab(simulateCVD(RED, 'protan')),
      rgbToLab(simulateCVD(GREEN, 'protan')),
    );
    const deutan = ciede2000(
      rgbToLab(simulateCVD(RED, 'deutan')),
      rgbToLab(simulateCVD(GREEN, 'deutan')),
    );
    expect(deutan).toBeLessThan(protan);
  });

  it('leaves red and green mostly distinct for tritan', () => {
    const simulated = ciede2000(
      rgbToLab(simulateCVD(RED, 'tritan')),
      rgbToLab(simulateCVD(GREEN, 'tritan')),
    );
    expect(simulated).toBeGreaterThan(originalRedGreen / 2);
  });
});
