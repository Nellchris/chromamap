/**
 * The audit engine: given the colours a style paints, find the pairs a reader
 * cannot tell apart.
 *
 * Every class colour is first composited over the page background, then run
 * through each requested vision mode, and finally compared pairwise with
 * CIEDE2000 (perceptual distance) and the WCAG contrast ratio.
 */

import { simulateCVD } from '../color/cvd.js';
import { ciede2000, rgbToLab, type Lab } from '../color/lab.js';
import type { RGB } from '../color/parse.js';
import { contrastRatio, relativeLuminance } from '../color/wcag.js';
import type { MapClass } from '../style/extract.js';
import { compositeOver } from './composite.js';

/** Normal trichromatic vision, plus the three dichromacies. */
export type VisionMode = 'normal' | 'protan' | 'deutan' | 'tritan';

/** Every vision mode, in the order a report reads best. */
export const VISION_MODES: readonly VisionMode[] = [
  'normal',
  'protan',
  'deutan',
  'tritan',
];

/**
 * Default CIEDE2000 distance below which two classes are called confusable.
 *
 * Well above the ~1.0 just-noticeable threshold: map classes are read at a
 * glance, in small patches, against varying surroundings, so they need far
 * more separation than a side-by-side colour-matching task would demand.
 */
export const DEFAULT_THRESHOLD = 10;

/** One class pair, judged under one vision mode. */
export interface AuditPair {
  classA: MapClass;
  classB: MapClass;
  mode: VisionMode;
  /** CIEDE2000 distance between the two composited, simulated colours. */
  dE: number;
  /** WCAG 2.1 contrast ratio between the same two colours, 1..21. */
  contrast: number;
  /** True when `dE` reaches the threshold, i.e. the pair is distinguishable. */
  pass: boolean;
}

/** The full result of an audit. */
export interface AuditResult {
  /** Every class pair under every requested mode. */
  pairs: AuditPair[];
  /** The subset of `pairs` that did not reach the threshold. */
  failing: AuditPair[];
  summary: {
    /** Number of judgements made: class pairs times modes. */
    total: number;
    /** How many of those judgements failed. */
    failing: number;
    /** Failures per mode; modes that were not audited stay at 0. */
    byMode: Record<VisionMode, number>;
  };
}

/** Knobs for {@link runAudit}; every field has a sensible default. */
export interface AuditOptions {
  /** What the map is drawn on. Defaults to white. */
  background?: RGB;
  /** CIEDE2000 distance a pair must reach. Defaults to {@link DEFAULT_THRESHOLD}. */
  threshold?: number;
  /** Which vision modes to audit. Defaults to {@link VISION_MODES}. */
  modes?: VisionMode[];
}

/** A class's colour as it appears under one mode, with values worth caching. */
interface ClassView {
  readonly cls: MapClass;
  readonly lab: Lab;
  readonly luminance: number;
}

/**
 * Audit a set of map classes for pairwise confusability.
 *
 * A pair is reported once per mode. The pair-level `pass` flag answers "are
 * these two distinguishable under *this* mode"; a pair that a reader may
 * confuse is therefore one that appears anywhere in `failing`, which is the
 * "fails in any mode" view of the same data.
 *
 * @param classes - The classes to compare, e.g. from `extractClasses`.
 * @param options - See {@link AuditOptions}.
 * @returns Every judgement, the failures, and the counts.
 */
export function runAudit(classes: MapClass[], options: AuditOptions = {}): AuditResult {
  const background = options.background ?? [1, 1, 1];
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  // Deduplicated so a repeated mode cannot double-count a failure.
  const modes = [...new Set(options.modes ?? VISION_MODES)];

  const composited = classes.map((cls) => compositeOver(cls.color, cls.opacity, background));

  const pairs: AuditPair[] = [];
  const byMode: Record<VisionMode, number> = {
    normal: 0,
    protan: 0,
    deutan: 0,
    tritan: 0,
  };

  for (const mode of modes) {
    const views: readonly ClassView[] = classes.map((cls, index) => {
      const base = composited[index] ?? cls.color;
      const seen = mode === 'normal' ? base : simulateCVD(base, mode);
      return {
        cls,
        lab: rgbToLab(seen),
        luminance: relativeLuminance(seen[0], seen[1], seen[2]),
      };
    });

    for (const [index, a] of views.entries()) {
      for (const b of views.slice(index + 1)) {
        const dE = ciede2000(a.lab, b.lab);
        const pass = dE >= threshold;
        pairs.push({
          classA: a.cls,
          classB: b.cls,
          mode,
          dE,
          contrast: contrastRatio(a.luminance, b.luminance),
          pass,
        });
        if (!pass) {
          byMode[mode] += 1;
        }
      }
    }
  }

  const failing = pairs.filter((pair) => !pair.pass);

  return {
    pairs,
    failing,
    summary: {
      total: pairs.length,
      failing: failing.length,
      byMode,
    },
  };
}
