/**
 * Colour vision deficiency simulation.
 *
 * Uses the Machado, Oliveira and Fernandes (2009) physiologically based model
 * at severity 1.0 - full dichromacy. The matrices operate on *linear* RGB, so
 * a simulation is: linearise, transform, clamp back into gamut, re-encode.
 *
 * @see Machado, Oliveira and Fernandes (2009), "A Physiologically-based Model
 *   for Simulation of Color Vision Deficiency", IEEE Transactions on
 *   Visualization and Computer Graphics 15(6), 1291-1298.
 */

import type { RGB } from './parse.js';
import { linearToSrgb, srgbToLinear } from './wcag.js';

/** The three dichromacies: missing L-, M- or S-cone response. */
export type CVDType = 'protan' | 'deutan' | 'tritan';

/** A row-major 3x3 matrix. */
export type Matrix3x3 = [
  [number, number, number],
  [number, number, number],
  [number, number, number],
];

/**
 * Machado et al. severity-1.0 transforms, applied to linear RGB.
 *
 * Every row sums to 1 to within a rounding unit of the published six-decimal
 * coefficients, which is why neutral greys survive a simulation unchanged.
 */
export const CVD_MATRICES: Record<CVDType, Matrix3x3> = {
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritan: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

/**
 * Simulate how a colour appears to a dichromatic viewer.
 *
 * @param rgb - sRGB channels in 0..1.
 * @param type - Which dichromacy to simulate.
 * @returns The simulated colour as sRGB channels in 0..1. The transform can
 *   push linear RGB outside the unit cube, so each channel is clamped before
 *   being re-encoded; the result is always in gamut.
 */
export function simulateCVD(rgb: RGB, type: CVDType): RGB {
  const matrix = CVD_MATRICES[type];
  const rl = srgbToLinear(rgb[0]);
  const gl = srgbToLinear(rgb[1]);
  const bl = srgbToLinear(rgb[2]);

  const channel = (row: [number, number, number]): number =>
    linearToSrgb(Math.min(1, Math.max(0, row[0] * rl + row[1] * gl + row[2] * bl)));

  return [channel(matrix[0]), channel(matrix[1]), channel(matrix[2])];
}
