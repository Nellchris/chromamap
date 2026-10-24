/**
 * Alpha compositing for partially transparent map layers.
 */

import type { RGB } from '../color/parse.js';

/** What a map is drawn on when the caller says nothing: paper white. */
const WHITE: RGB = [1, 1, 1];

/**
 * Porter-Duff source-over, carried out on gamma-encoded sRGB values.
 *
 * Blending in sRGB rather than linear light is physically wrong but is exactly
 * what browsers do for `opacity` and for `rgba()` fills, so it is what a
 * viewer of the map will actually see - which is the thing being audited.
 *
 * @param fg - The foreground colour, sRGB channels in 0..1.
 * @param alpha - Foreground opacity; values outside 0..1 are clamped.
 * @param bg - The backdrop, defaulting to white.
 * @returns The composited opaque colour, sRGB channels in 0..1.
 */
export function compositeOver(fg: RGB, alpha: number, bg: RGB = WHITE): RGB {
  const a = Math.min(1, Math.max(0, alpha));
  const inverse = 1 - a;
  return [
    fg[0] * a + bg[0] * inverse,
    fg[1] * a + bg[1] * inverse,
    fg[2] * a + bg[2] * inverse,
  ];
}
