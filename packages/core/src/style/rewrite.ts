/**
 * Writing a palette back into the style it came out of.
 *
 * `extractClasses` reads a style's colours and names each one; the auditor and
 * the remediator then work in terms of those names. This closes the loop: give
 * it the same style and a colour per class id, and it hands back a style that
 * paints the new palette and is otherwise byte-for-byte the author's own file.
 *
 * Both directions share the walk in `./slots.js`, so a class id produced by
 * extraction is always one the rewriter can find.
 */

import { rgbToHex, type RGB } from '../color/parse.js';

import {
  isMatchExpression,
  isRecord,
  lastStopEntry,
  matchBranches,
  paintSlots,
} from './slots.js';

/** What a rewrite did. */
export interface AppliedPalette {
  /** A deep copy of the input, with the new colours in it. */
  style: unknown;
  /** The class ids that were found and recoloured, in style order. */
  changed: string[];
  /**
   * Class ids that were asked for but not written: either this style has no
   * such class, or its colour is a data expression nothing static can replace.
   */
  missing: string[];
}

/**
 * The stop entry whose output is the colour a style actually resolves to.
 *
 * Descends through nested stop functions the same way `resolveColor` does, and
 * returns the live array so the caller can replace output in place. Rewriting
 * only that one output is deliberate: it is the stop the audit judged, and the
 * rest of the author's ramp is left exactly as written rather than being
 * flattened to a single colour.
 */
function colourStopEntry(value: unknown): unknown[] | undefined {
  const entry = lastStopEntry(value);
  if (entry === undefined) {
    return undefined;
  }
  const output = entry[1];
  if (isRecord(output)) {
    return colourStopEntry(output);
  }
  return typeof output === 'string' ? entry : undefined;
}

/** Put `hex` where a paint property's resolvable colour sits. */
function assignColour(
  paint: Record<string, unknown>,
  key: string,
  hex: string,
): boolean {
  const value = paint[key];
  if (typeof value === 'string') {
    paint[key] = hex;
    return true;
  }
  const entry = colourStopEntry(value);
  if (entry === undefined) {
    return false;
  }
  entry[1] = hex;
  return true;
}

/**
 * Recolour a style from a palette keyed by class id.
 *
 * The input is never touched: a style is JSON, so it is deep-copied through
 * `JSON.parse(JSON.stringify(...))` and the copy is what gets written.
 *
 * @param style - Parsed style JSON, as handed to `extractClasses`.
 * @param colours - The replacement colour per class id, e.g. built from the
 *   `classId`/`remediated` fields of `generateAccessiblePalette`'s result.
 * @returns The recoloured copy, plus which ids were and were not found.
 * @throws If `style` cannot be deep-copied as JSON.
 */
export function applyPalette(
  style: unknown,
  colours: ReadonlyMap<string, RGB>,
): AppliedPalette {
  const copy: unknown = JSON.parse(JSON.stringify(style));
  const changed: string[] = [];

  for (const slot of paintSlots(copy)) {
    const value = slot.paint[slot.colorKey];

    if (isMatchExpression(value)) {
      for (const { label, outputIndex } of matchBranches(value)) {
        const id = `${slot.baseId}/${label}`;
        const colour = colours.get(id);
        if (colour === undefined) {
          continue;
        }
        const branch = value[outputIndex];
        if (typeof branch === 'string') {
          value[outputIndex] = rgbToHex(colour);
          changed.push(id);
        } else if (isRecord(branch)) {
          const entry = colourStopEntry(branch);
          if (entry !== undefined) {
            entry[1] = rgbToHex(colour);
            changed.push(id);
          }
        }
      }
      continue;
    }

    const colour = colours.get(slot.baseId);
    if (colour === undefined) {
      continue;
    }
    if (assignColour(slot.paint, slot.colorKey, rgbToHex(colour))) {
      changed.push(slot.baseId);
    }
  }

  const written = new Set(changed);
  return {
    style: copy,
    changed,
    missing: [...colours.keys()].filter((id) => !written.has(id)),
  };
}
