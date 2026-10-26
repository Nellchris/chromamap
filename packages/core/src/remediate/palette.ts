/**
 * Turning a palette that fails into one that does better.
 *
 * The strategy is deliberately simple, and rests on one fact: dichromacy takes
 * away hue discrimination but leaves lightness almost untouched. So the single
 * most effective repair for a categorical map palette is to stop relying on
 * hue for separation and spread the classes evenly through lightness instead.
 *
 * What this does *not* promise is zero clashes. Even spacing over a lightness
 * range of 60 L* gives adjacent classes 60/(n-1) L* of separation, and since
 * CIEDE2000 between two colours of the same hue is close to their lightness
 * difference, a palette of more than about seven classes cannot put every pair
 * 10 ΔE apart however the hues are arranged. Past that point a map needs
 * texture, labels or fewer classes - not better colours. The audit after
 * remediation says exactly how far the palette got.
 */

import { runAudit, type AuditOptions } from '../audit/engine.js';
import { ciede2000, labToRgb, rgbToLab, type Lab } from '../color/lab.js';
import type { RGB } from '../color/parse.js';
import type { MapClass } from '../style/extract.js';

/** What happened to one class. */
export interface RemediationResult {
  /** The colour as authored. */
  original: RGB;
  /** The colour to use instead. */
  remediated: RGB;
  /** Which class this is, by id. */
  classId: string;
}

/**
 * The lightness band the ramp is spread across.
 *
 * Stops short of both ends: at L* below about 25 a map class reads as black
 * and above about 85 it disappears into white paper.
 */
export const REMEDIATION_LIGHTNESS = { min: 25, max: 85 } as const;

/** Degrees of hue to rotate a colour by when a pair still clashes. */
const HUE_NUDGE_DEGREES = 30;

/**
 * Rounds of the exploring sweep.
 *
 * Not a full turn's worth: which classes get rotated changes from round to
 * round, so the sequence does not repeat after twelve 30° steps the way a
 * fixed set would.
 */
const SWEEP_ROUNDS = 48;

/**
 * How many trial audits a single call may spend.
 *
 * Generous for the palettes this is meant for - a dozen classes never comes
 * close - and a hard stop for a ninety-class geological map, where an
 * unbounded search would run for minutes.
 */
const AUDIT_BUDGET = 600;

/** Rounds of single-colour polishing after the sweep. */
const POLISH_ROUNDS = 24;

const DEG = Math.PI / 180;

/** Rotate a colour's hue, keeping its lightness and chroma. */
function rotateHue(lab: Lab, degrees: number): Lab {
  const radians = degrees * DEG;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    L: lab.L,
    a: lab.a * cos - lab.b * sin,
    b: lab.a * sin + lab.b * cos,
  };
}

/** The classes as they would be with these colours. */
function applied(classes: readonly MapClass[], labs: readonly Lab[]): MapClass[] {
  return classes.map((cls, index) => {
    const lab = labs[index];
    const next: MapClass = {
      ...cls,
      color: lab === undefined ? cls.color : labToRgb(lab),
    };
    return next;
  });
}

/** Pairs that still clash, deduplicated across modes, worst first. */
function clashingPairs(
  classes: readonly MapClass[],
  options: AuditOptions,
): Array<{ a: number; b: number; dE: number }> {
  const indexOf = new Map<MapClass, number>();
  classes.forEach((cls, index) => indexOf.set(cls, index));

  const worst = new Map<string, { a: number; b: number; dE: number }>();
  for (const pair of runAudit([...classes], options).failing) {
    const a = indexOf.get(pair.classA);
    const b = indexOf.get(pair.classB);
    if (a === undefined || b === undefined) {
      continue;
    }
    const key = `${String(a)}:${String(b)}`;
    const current = worst.get(key);
    if (current === undefined || pair.dE < current.dE) {
      worst.set(key, { a, b, dE: pair.dE });
    }
  }
  return [...worst.values()].sort((first, second) => first.dE - second.dE);
}

/**
 * Rebuild a palette so its classes separate by lightness rather than by hue.
 *
 * Each class keeps the hue it was authored with; only its lightness moves, to
 * an evenly spaced slot in {@link REMEDIATION_LIGHTNESS}. The result is then
 * audited, and any pair that still clashes has the lighter of the two nudged
 * round the hue circle, repeatedly, keeping whichever attempt came out best.
 *
 * Colours that fall outside the sRGB gamut at their new lightness lose chroma
 * until they fit, so hue and lightness survive the trip.
 *
 * @param classes - The classes to repalette, in style order.
 * @param options - `background` is what the classes are composited over when
 *   the result is checked; it defaults to white, as the audit does.
 * @returns One entry per input class, in the same order.
 */
export function generateAccessiblePalette(
  classes: MapClass[],
  options: { background?: RGB } = {},
): RemediationResult[] {
  if (classes.length === 0) {
    return [];
  }

  const auditOptions: AuditOptions = {};
  if (options.background !== undefined) {
    auditOptions.background = options.background;
  }

  const originals = classes.map((cls) => rgbToLab(cls.color));

  // Rank by lightness, then hand out evenly spaced slots in that order, so the
  // palette keeps the light-to-dark ordering its author chose.
  const order = originals
    .map((lab, index) => ({ index, L: lab.L }))
    .sort((first, second) => first.L - second.L);

  const span = REMEDIATION_LIGHTNESS.max - REMEDIATION_LIGHTNESS.min;
  let labs: Lab[] = originals.map((lab) => ({ ...lab }));
  order.forEach((entry, rank) => {
    const target = labs[entry.index];
    if (target === undefined) {
      return;
    }
    // A single class has nothing to be separated from, so it keeps its own
    // lightness rather than being dragged to the middle of the ramp.
    target.L =
      order.length === 1
        ? target.L
        : REMEDIATION_LIGHTNESS.min + (span * rank) / (order.length - 1);
  });

  // Every trial costs a full audit, which is quadratic in the class count: a
  // hundred classes is 19,800 comparisons a go. The budget stops a large
  // palette from searching for minutes on end, and is far larger than a small
  // one ever uses.
  let auditsLeft = AUDIT_BUDGET;
  const countClashes = (candidate: readonly Lab[]): number => {
    auditsLeft -= 1;
    return clashingPairs(applied(classes, candidate), auditOptions).length;
  };

  let best = labs.map((lab) => ({ ...lab }));
  let bestClashes = countClashes(best);

  // Phase one, exploration: rotate the lighter member of every clashing pair
  // together, a turn at a time, and keep whichever arrangement came out best.
  // Rotating one class at a time from the start gets stuck almost immediately,
  // because no single nudge improves the count even when a combination would.
  for (let round = 0; round < SWEEP_ROUNDS && bestClashes > 0 && auditsLeft > 0; round += 1) {
    const clashes = clashingPairs(applied(classes, labs), auditOptions);
    if (clashes.length === 0) {
      break;
    }
    const nudging = new Set<number>();
    for (const clash of clashes) {
      const a = labs[clash.a];
      const b = labs[clash.b];
      if (a !== undefined && b !== undefined) {
        nudging.add(a.L >= b.L ? clash.a : clash.b);
      }
    }
    if (nudging.size === 0) {
      break;
    }
    labs = labs.map((lab, index) =>
      nudging.has(index) ? rotateHue(lab, HUE_NUDGE_DEGREES) : lab,
    );
    const count = countClashes(labs);
    if (count < bestClashes) {
      best = labs.map((lab) => ({ ...lab }));
      bestClashes = count;
    }
  }

  // Phase two, polish: from the best arrangement found, take the worst clash
  // and rotate one of its two colours, keeping the change only if the whole
  // palette improved.
  for (let round = 0; round < POLISH_ROUNDS && bestClashes > 0 && auditsLeft > 0; round += 1) {
    let improved = false;
    for (const clash of clashingPairs(applied(classes, best), auditOptions)) {
      const a = best[clash.a];
      const b = best[clash.b];
      if (a === undefined || b === undefined) {
        continue;
      }
      // The lighter of the two first, as the brief asks; the darker one is
      // worth a try when that does not help.
      const lighter = a.L >= b.L ? clash.a : clash.b;
      for (const candidate of [lighter, lighter === clash.a ? clash.b : clash.a]) {
        // One nudge is often not enough to clear a pair, and stopping at one
        // leaves the search stranded somewhere arbitrary - which showed up as
        // the same palette coming out markedly better or worse depending on
        // the background it was tuned against. Trying whole nudges all the way
        // round makes the outcome depend on the palette instead of the path.
        for (let turn = 1; turn <= 360 / HUE_NUDGE_DEGREES && auditsLeft > 0; turn += 1) {
          const trial = best.map((lab) => ({ ...lab }));
          const subject = trial[candidate];
          if (subject === undefined) {
            break;
          }
          trial[candidate] = rotateHue(subject, HUE_NUDGE_DEGREES * turn);
          const count = countClashes(trial);
          if (count < bestClashes) {
            best = trial;
            bestClashes = count;
            improved = true;
            break;
          }
        }
        if (improved) {
          break;
        }
      }
      if (improved) {
        break;
      }
    }
    if (!improved) {
      break;
    }
  }

  return classes.map((cls, index) => {
    const lab = best[index];
    return {
      classId: cls.id,
      original: [cls.color[0], cls.color[1], cls.color[2]],
      remediated: lab === undefined ? [cls.color[0], cls.color[1], cls.color[2]] : labToRgb(lab),
    };
  });
}

/**
 * How far apart the closest pair of a palette sits, perceptually.
 *
 * Useful for saying what a repalette achieved, and for showing when a class
 * count is simply too high for the threshold being asked for.
 *
 * @param classes - The classes to measure.
 * @returns The smallest CIEDE2000 distance between any two, or Infinity when
 *   there are fewer than two classes.
 */
export function closestPair(classes: readonly MapClass[]): number {
  const labs = classes.map((cls) => rgbToLab(cls.color));
  let closest = Number.POSITIVE_INFINITY;
  for (const [index, lab] of labs.entries()) {
    for (const other of labs.slice(index + 1)) {
      closest = Math.min(closest, ciede2000(lab, other));
    }
  }
  return closest;
}
