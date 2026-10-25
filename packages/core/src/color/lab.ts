/**
 * CIE colour space conversions and the CIEDE2000 perceptual distance.
 *
 * sRGB is taken to be IEC 61966-2-1 with a D65 white point; CIELAB uses the
 * D65 illuminant and the 2-degree standard observer throughout, so an sRGB
 * white of (1, 1, 1) lands on L* = 100, a* = b* = 0.
 *
 * @see Sharma, Wu and Dalal (2005), "The CIEDE2000 Color-Difference Formula:
 *   Implementation Notes, Supplementary Test Data, and Mathematical
 *   Observations", Color Research and Application 30(1), 21-30.
 */

import type { RGB } from './parse.js';
import { linearToSrgb, srgbToLinear } from './wcag.js';

/** A colour in CIELAB: lightness plus the two opponent axes. */
export type Lab = { L: number; a: number; b: number };

/**
 * D65 reference white in XYZ, normalised to Y = 1.
 *
 * These are the row sums of the sRGB-to-XYZ matrix below, which is what makes
 * white convert to L* = 100 with no residual chroma.
 */
export const D65_WHITE = {
  x: 0.95047,
  y: 1.0,
  z: 1.08883,
} as const;

/** CIE standard: the linear/cube-root crossover of the Lab transfer function. */
const EPSILON = 216 / 24389;

/** CIE standard: the slope of the linear segment, 24389/27. */
const KAPPA = 24389 / 27;

/** Radians per degree; CIEDE2000 is specified in degrees. */
const DEG = Math.PI / 180;

/** 25^7, the chroma-weighting constant that appears twice in CIEDE2000. */
const POW25_7 = 25 ** 7;

/**
 * Convert sRGB to CIE XYZ under D65.
 *
 * @param r - Red channel, gamma-encoded sRGB in 0..1.
 * @param g - Green channel, gamma-encoded sRGB in 0..1.
 * @param b - Blue channel, gamma-encoded sRGB in 0..1.
 * @returns `[X, Y, Z]`, with Y in 0..1 for in-gamut input.
 */
export function srgbToXyz(r: number, g: number, b: number): [number, number, number] {
  const rl = srgbToLinear(r);
  const gl = srgbToLinear(g);
  const bl = srgbToLinear(b);
  return [
    0.4124564 * rl + 0.3575761 * gl + 0.1804375 * bl,
    0.2126729 * rl + 0.7151522 * gl + 0.072175 * bl,
    0.0193339 * rl + 0.119192 * gl + 0.9503041 * bl,
  ];
}

/** The Lab transfer function: cube root above the crossover, linear below. */
function labTransfer(t: number): number {
  return t > EPSILON ? Math.cbrt(t) : (KAPPA * t + 16) / 116;
}

/**
 * Convert CIE XYZ to CIELAB under the D65 illuminant and 2-degree observer.
 *
 * @param x - X tristimulus value, normalised so white is {@link D65_WHITE}.
 * @param y - Y tristimulus value (luminance), 0..1 for in-gamut colours.
 * @param z - Z tristimulus value.
 * @returns The colour as {@link Lab}.
 */
export function xyzToLab(x: number, y: number, z: number): Lab {
  const fx = labTransfer(x / D65_WHITE.x);
  const fy = labTransfer(y / D65_WHITE.y);
  const fz = labTransfer(z / D65_WHITE.z);
  return {
    L: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  };
}

/**
 * Convert sRGB straight to CIELAB.
 *
 * @param rgb - sRGB channels in 0..1.
 * @returns The colour as {@link Lab}.
 */
export function rgbToLab(rgb: RGB): Lab {
  const [x, y, z] = srgbToXyz(rgb[0], rgb[1], rgb[2]);
  return xyzToLab(x, y, z);
}

/**
 * Convert CIELAB back to CIE XYZ under D65. Inverse of {@link xyzToLab}.
 *
 * @param lab - The colour.
 * @returns `[X, Y, Z]` on the same scale {@link srgbToXyz} produces.
 */
export function labToXyz(lab: Lab): [number, number, number] {
  const fy = (lab.L + 16) / 116;
  const fx = fy + lab.a / 500;
  const fz = fy - lab.b / 200;

  const inverse = (f: number): number => {
    const cubed = f ** 3;
    return cubed > EPSILON ? cubed : (116 * f - 16) / KAPPA;
  };

  // Y has its own branch, taken on L* rather than on f(y), because that is
  // where the CIE definition puts the crossover.
  const yr = lab.L > KAPPA * EPSILON ? fy ** 3 : lab.L / KAPPA;

  return [inverse(fx) * D65_WHITE.x, yr * D65_WHITE.y, inverse(fz) * D65_WHITE.z];
}

/**
 * Convert CIE XYZ to gamma-encoded sRGB under D65. Inverse of
 * {@link srgbToXyz}.
 *
 * Channels are returned as the maths gives them, so a colour outside the sRGB
 * gamut comes back outside 0..1. {@link labToRgb} is the version that lands in
 * gamut.
 *
 * @param x - X tristimulus value.
 * @param y - Y tristimulus value.
 * @param z - Z tristimulus value.
 * @returns sRGB channels, not necessarily within 0..1.
 */
export function xyzToSrgb(x: number, y: number, z: number): RGB {
  const rl = 3.2404542 * x - 1.5371385 * y - 0.4985314 * z;
  const gl = -0.969266 * x + 1.8760108 * y + 0.041556 * z;
  const bl = 0.0556434 * x - 0.2040259 * y + 1.0572252 * z;
  return [linearToSrgb(rl), linearToSrgb(gl), linearToSrgb(bl)];
}

/** True when every channel is within the sRGB cube, give or take rounding. */
function inGamut(rgb: RGB): boolean {
  return rgb.every((channel) => channel >= -1e-6 && channel <= 1 + 1e-6);
}

function clampChannels(rgb: RGB): RGB {
  return [
    Math.min(1, Math.max(0, rgb[0])),
    Math.min(1, Math.max(0, rgb[1])),
    Math.min(1, Math.max(0, rgb[2])),
  ];
}

/**
 * Convert CIELAB to sRGB, bringing the colour into gamut if it is outside.
 *
 * Out-of-gamut colours have their chroma reduced towards the neutral axis
 * until they fit, which keeps lightness and hue - the two things a caller
 * asking for a specific L* and hue actually cares about. Clipping each channel
 * instead would hold chroma and throw away the hue, which is the opposite of
 * what a palette needs.
 *
 * @param lab - The colour. L* outside 0..100 is clamped first.
 * @returns sRGB channels in 0..1.
 */
export function labToRgb(lab: Lab): RGB {
  const target: Lab = { L: Math.min(100, Math.max(0, lab.L)), a: lab.a, b: lab.b };
  const direct = xyzToSrgb(...labToXyz(target));
  if (inGamut(direct)) {
    return clampChannels(direct);
  }

  // Binary search the largest chroma scale that still fits.
  let fits = 0;
  let over = 1;
  for (let step = 0; step < 24; step += 1) {
    const mid = (fits + over) / 2;
    const candidate = xyzToSrgb(
      ...labToXyz({ L: target.L, a: target.a * mid, b: target.b * mid }),
    );
    if (inGamut(candidate)) {
      fits = mid;
    } else {
      over = mid;
    }
  }
  return clampChannels(
    xyzToSrgb(...labToXyz({ L: target.L, a: target.a * fits, b: target.b * fits })),
  );
}

/** atan2 in degrees over 0..360, with the CIE convention of 0 at the origin. */
function hueDegrees(b: number, aPrime: number): number {
  if (aPrime === 0 && b === 0) {
    return 0;
  }
  const degrees = Math.atan2(b, aPrime) / DEG;
  return degrees >= 0 ? degrees : degrees + 360;
}

/**
 * CIEDE2000 colour difference with the standard weights kL = kC = kH = 1.
 *
 * Follows Sharma et al. (2005) step by step, including the discontinuity
 * handling for the mean hue and for the hue difference when either chroma is
 * zero.
 *
 * @param lab1 - The first colour.
 * @param lab2 - The second colour.
 * @returns dE00: zero for identical colours, growing with perceived
 *   difference, and roughly 1 at the just-noticeable threshold.
 */
export function ciede2000(lab1: Lab, lab2: Lab): number {
  const c1 = Math.hypot(lab1.a, lab1.b);
  const c2 = Math.hypot(lab2.a, lab2.b);
  const cBar = (c1 + c2) / 2;

  // G lifts a* in the low-chroma blue region, where CIELAB is least uniform.
  const cBar7 = cBar ** 7;
  const g = 0.5 * (1 - Math.sqrt(cBar7 / (cBar7 + POW25_7)));

  const a1p = (1 + g) * lab1.a;
  const a2p = (1 + g) * lab2.a;

  const c1p = Math.hypot(a1p, lab1.b);
  const c2p = Math.hypot(a2p, lab2.b);

  const h1p = hueDegrees(lab1.b, a1p);
  const h2p = hueDegrees(lab2.b, a2p);

  const dLp = lab2.L - lab1.L;
  const dCp = c2p - c1p;

  const chromaProduct = c1p * c2p;
  let dhp: number;
  if (chromaProduct === 0) {
    dhp = 0;
  } else if (Math.abs(h2p - h1p) <= 180) {
    dhp = h2p - h1p;
  } else if (h2p - h1p > 180) {
    dhp = h2p - h1p - 360;
  } else {
    dhp = h2p - h1p + 360;
  }
  const dHp = 2 * Math.sqrt(chromaProduct) * Math.sin((dhp / 2) * DEG);

  const lBarp = (lab1.L + lab2.L) / 2;
  const cBarp = (c1p + c2p) / 2;

  let hBarp: number;
  if (chromaProduct === 0) {
    hBarp = h1p + h2p;
  } else if (Math.abs(h1p - h2p) <= 180) {
    hBarp = (h1p + h2p) / 2;
  } else if (h1p + h2p < 360) {
    hBarp = (h1p + h2p + 360) / 2;
  } else {
    hBarp = (h1p + h2p - 360) / 2;
  }

  const t =
    1 -
    0.17 * Math.cos((hBarp - 30) * DEG) +
    0.24 * Math.cos(2 * hBarp * DEG) +
    0.32 * Math.cos((3 * hBarp + 6) * DEG) -
    0.2 * Math.cos((4 * hBarp - 63) * DEG);

  const dTheta = 30 * Math.exp(-(((hBarp - 275) / 25) ** 2));
  const cBarp7 = cBarp ** 7;
  const rC = 2 * Math.sqrt(cBarp7 / (cBarp7 + POW25_7));
  const rT = -Math.sin(2 * dTheta * DEG) * rC;

  const sL = 1 + (0.015 * (lBarp - 50) ** 2) / Math.sqrt(20 + (lBarp - 50) ** 2);
  const sC = 1 + 0.045 * cBarp;
  const sH = 1 + 0.015 * cBarp * t;

  const termL = dLp / sL;
  const termC = dCp / sC;
  const termH = dHp / sH;

  return Math.sqrt(termL ** 2 + termC ** 2 + termH ** 2 + rT * termC * termH);
}
