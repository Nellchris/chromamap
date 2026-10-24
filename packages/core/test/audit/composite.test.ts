import { describe, expect, it } from 'vitest';

import { compositeOver } from '../../src/audit/composite.js';
import { rgbToHex, type RGB } from '../../src/color/parse.js';

const RED: RGB = [1, 0, 0];
const WHITE: RGB = [1, 1, 1];
const BLACK: RGB = [0, 0, 0];

function expectRgb(actual: RGB, expected: RGB): void {
  expect(actual[0]).toBeCloseTo(expected[0], 12);
  expect(actual[1]).toBeCloseTo(expected[1], 12);
  expect(actual[2]).toBeCloseTo(expected[2], 12);
}

describe('compositeOver', () => {
  it('returns the foreground unchanged when fully opaque', () => {
    expectRgb(compositeOver(RED, 1), RED);
    expectRgb(compositeOver([0.2, 0.4, 0.6], 1), [0.2, 0.4, 0.6]);
    expectRgb(compositeOver(RED, 1, BLACK), RED);
  });

  it('returns the background when fully transparent', () => {
    expectRgb(compositeOver(RED, 0), WHITE);
    expectRgb(compositeOver(RED, 0, BLACK), BLACK);
    expectRgb(compositeOver(RED, 0, [0.2, 0.4, 0.6]), [0.2, 0.4, 0.6]);
  });

  it('blends halfway at 50% opacity', () => {
    expectRgb(compositeOver(RED, 0.5), [1, 0.5, 0.5]);
    expect(rgbToHex(compositeOver(RED, 0.5))).toBe('#ff8080');
    expectRgb(compositeOver(RED, 0.5, BLACK), [0.5, 0, 0]);
    expectRgb(compositeOver(BLACK, 0.5, WHITE), [0.5, 0.5, 0.5]);
  });

  it('defaults the background to white', () => {
    expectRgb(compositeOver(RED, 0.25), compositeOver(RED, 0.25, WHITE));
    expectRgb(compositeOver([0, 0, 0], 0.5), [0.5, 0.5, 0.5]);
  });

  it('is linear in alpha', () => {
    for (let i = 0; i <= 10; i += 1) {
      const alpha = i / 10;
      const out = compositeOver(RED, alpha, BLACK);
      expectRgb(out, [alpha, 0, 0]);
    }
  });

  it('clamps alpha outside 0..1', () => {
    expectRgb(compositeOver(RED, 1.5), RED);
    expectRgb(compositeOver(RED, -1), WHITE);
    expectRgb(compositeOver(RED, Number.POSITIVE_INFINITY), RED);
  });

  it('keeps every channel in 0..1 for in-gamut input', () => {
    for (const alpha of [0, 0.3, 0.7, 1]) {
      for (const bg of [WHITE, BLACK, [0.5, 0.2, 0.8] as RGB]) {
        for (const channel of compositeOver([0.9, 0.1, 0.4], alpha, bg)) {
          expect(channel).toBeGreaterThanOrEqual(0);
          expect(channel).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('does not mutate its arguments', () => {
    const fg: RGB = [1, 0, 0];
    const bg: RGB = [0, 0, 1];
    compositeOver(fg, 0.5, bg);
    expect(fg).toEqual([1, 0, 0]);
    expect(bg).toEqual([0, 0, 1]);
  });

  it('returns a fresh tuple each call', () => {
    const first = compositeOver(RED, 0.5);
    const second = compositeOver(RED, 0.5);
    expect(first).not.toBe(second);
    first[0] = 0;
    expect(second[0]).toBe(1);
  });
});
