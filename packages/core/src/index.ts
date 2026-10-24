/**
 * @carto-a11y/core — the CartoAccessibility-Studio engine.
 *
 * Pure, DOM-free building blocks for auditing web-map styles.
 */

export {
  LUMINANCE_WEIGHTS,
  contrastRatio,
  linearToSrgb,
  relativeLuminance,
  srgbToLinear,
} from './color/wcag.js';

export type { RGB } from './color/parse.js';
export { CSS_NAMED_COLORS, parseColor, rgbToHex } from './color/parse.js';

export type { Lab } from './color/lab.js';
export { D65_WHITE, ciede2000, rgbToLab, srgbToXyz, xyzToLab } from './color/lab.js';

export type { CVDType, Matrix3x3 } from './color/cvd.js';
export { CVD_MATRICES, simulateCVD } from './color/cvd.js';
