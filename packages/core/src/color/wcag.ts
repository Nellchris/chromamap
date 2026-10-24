/**
 * WCAG 2.1 relative luminance and contrast primitives.
 *
 * All channel values are sRGB in the 0..1 range (divide 8-bit values by 255
 * before calling). Nothing here touches the DOM, so the module runs in Node,
 * in a worker and in the browser alike.
 *
 * @see https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
 * @see https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio
 */

/** Channel value at and below which the sRGB transfer function is linear. */
const SRGB_LINEAR_CUTOFF = 0.04045;

/** The same cutoff expressed in linear-light space. */
const LINEAR_CUTOFF = 0.0031308;

/** Slope of the linear segment of the sRGB transfer function. */
const LINEAR_SLOPE = 12.92;

/** Offset applied to both luminances when forming a contrast ratio. */
const CONTRAST_OFFSET = 0.05;

/** Per-channel weights for WCAG relative luminance. */
export const LUMINANCE_WEIGHTS = {
  r: 0.2126,
  g: 0.7152,
  b: 0.0722,
} as const;

/**
 * Convert one gamma-encoded sRGB channel to linear light.
 *
 * @param c - sRGB channel value in 0..1.
 * @returns Linear-light value in 0..1.
 */
export function srgbToLinear(c: number): number {
  return c <= SRGB_LINEAR_CUTOFF
    ? c / LINEAR_SLOPE
    : Math.pow((c + 0.055) / 1.055, 2.4);
}

/**
 * Convert one linear-light channel back to gamma-encoded sRGB.
 * Inverse of {@link srgbToLinear}.
 *
 * @param c - Linear-light channel value in 0..1.
 * @returns sRGB channel value in 0..1.
 */
export function linearToSrgb(c: number): number {
  return c <= LINEAR_CUTOFF
    ? c * LINEAR_SLOPE
    : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

/**
 * WCAG 2.1 relative luminance of an sRGB colour: linearise each channel, then
 * weight by 0.2126 / 0.7152 / 0.0722.
 *
 * @param r - Red channel in 0..1.
 * @param g - Green channel in 0..1.
 * @param b - Blue channel in 0..1.
 * @returns Relative luminance in 0..1 (0 = black, 1 = white).
 */
export function relativeLuminance(r: number, g: number, b: number): number {
  return (
    LUMINANCE_WEIGHTS.r * srgbToLinear(r) +
    LUMINANCE_WEIGHTS.g * srgbToLinear(g) +
    LUMINANCE_WEIGHTS.b * srgbToLinear(b)
  );
}

/**
 * WCAG 2.1 contrast ratio between two relative luminances:
 * `(lighter + 0.05) / (darker + 0.05)`.
 *
 * The result is order-independent and always >= 1, ranging up to 21 for black
 * against white.
 *
 * @param l1 - A relative luminance, as returned by {@link relativeLuminance}.
 * @param l2 - The other relative luminance.
 * @returns Contrast ratio in 1..21.
 */
export function contrastRatio(l1: number, l2: number): number {
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + CONTRAST_OFFSET) / (darker + CONTRAST_OFFSET);
}
