/**
 * The structural walk that a style's colours are both read and written through.
 *
 * Reading a style (`extractClasses`) and writing one back (`applyPalette`) have
 * to agree exactly on which paint values count as colours and what each one is
 * called, or a remediated palette would be keyed by ids the rewriter cannot
 * find. Both therefore share this one walk rather than each implementing its
 * own, so the id scheme can only ever be defined in a single place.
 *
 * Nothing here evaluates a data expression: a value that cannot be resolved to
 * a colour on its own is skipped rather than guessed at.
 *
 * @see https://maplibre.org/maplibre-style-spec/
 */

import { parseColor, type RGB } from '../color/parse.js';

/** Which paint property a colour came from. */
export type PaintType = 'fill' | 'line' | 'text' | 'circle';

/** The paint properties that carry a colour, and what they map to. */
export const PAINT_PROPERTIES: ReadonlyArray<{
  readonly colorKey: string;
  readonly opacityKey: string;
  readonly type: PaintType;
}> = [
  { colorKey: 'fill-color', opacityKey: 'fill-opacity', type: 'fill' },
  { colorKey: 'line-color', opacityKey: 'line-opacity', type: 'line' },
  { colorKey: 'text-color', opacityKey: 'text-opacity', type: 'text' },
  { colorKey: 'circle-color', opacityKey: 'circle-opacity', type: 'circle' },
];

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The last entry of a legacy `{ stops: [...] }` function, as a live array.
 *
 * Returned rather than copied so a rewriter can assign to its output slot in
 * place, which is what keeps the rest of a zoom ramp as its author wrote it.
 */
export function lastStopEntry(value: unknown): unknown[] | undefined {
  if (!isRecord(value) || !Array.isArray(value['stops'])) {
    return undefined;
  }
  const stops: unknown[] = value['stops'];
  const last = stops.at(-1);
  if (!Array.isArray(last) || last.length < 2) {
    return undefined;
  }
  return last as unknown[];
}

/** The output of the last entry of a legacy `{ stops: [...] }` function. */
export function lastStopOutput(value: unknown): unknown {
  return lastStopEntry(value)?.[1];
}

/** True for `["match", ...]`, the one expression form handled here. */
export function isMatchExpression(value: unknown): value is unknown[] {
  return Array.isArray(value) && value[0] === 'match';
}

/** Render a match label (or label list) as an id fragment. */
export function labelToIdFragment(label: unknown): string {
  if (Array.isArray(label)) {
    const labels: readonly unknown[] = label;
    return labels.map((entry) => String(entry)).join('|');
  }
  return String(label);
}

/** One labelled branch of a match expression. */
export interface MatchBranch {
  /** The branch's id fragment, or `default` for the trailing fallback. */
  readonly label: string;
  /** The label as authored, for looking a readable name up by. */
  readonly raw: unknown;
  /** The branch's output value. */
  readonly output: unknown;
  /** Where that output sits in the expression, so it can be written back. */
  readonly outputIndex: number;
}

/**
 * Split a match expression into its labelled branches.
 *
 * `["match", input, l1, o1, l2, o2, fallback]` yields the two labelled pairs
 * plus the trailing fallback, which is reported under the label `default`.
 */
export function matchBranches(expression: readonly unknown[]): MatchBranch[] {
  const branches: MatchBranch[] = [];
  let index = 2;
  while (index + 1 < expression.length) {
    branches.push({
      label: labelToIdFragment(expression[index]),
      raw: expression[index],
      output: expression[index + 1],
      outputIndex: index + 1,
    });
    index += 2;
  }
  if (index === expression.length - 1) {
    branches.push({
      label: 'default',
      raw: undefined,
      output: expression[index],
      outputIndex: index,
    });
  }
  return branches;
}

/** The feature property a match expression switches on, if it is a plain get. */
export function matchInputProperty(expression: readonly unknown[]): string | undefined {
  const input = expression[1];
  if (Array.isArray(input) && input[0] === 'get' && typeof input[1] === 'string') {
    return input[1];
  }
  // The legacy form names the property directly.
  return typeof input === 'string' ? input : undefined;
}

/** Resolve a paint value to a colour, or undefined when it is not static. */
export function resolveColor(value: unknown): RGB | undefined {
  if (typeof value === 'string') {
    try {
      return parseColor(value);
    } catch {
      return undefined;
    }
  }
  if (isRecord(value)) {
    const stopped = lastStopOutput(value);
    return stopped === undefined ? undefined : resolveColor(stopped);
  }
  return undefined;
}

/** Resolve a paint value to an opacity, defaulting to fully opaque. */
export function resolveOpacity(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.min(1, Math.max(0, value));
  }
  if (isRecord(value)) {
    const stopped = lastStopOutput(value);
    if (stopped !== undefined) {
      return resolveOpacity(stopped);
    }
  }
  return 1;
}

/** Layers hidden by `layout.visibility` paint nothing, so they are skipped. */
export function isHidden(layer: Record<string, unknown>): boolean {
  const layout = layer['layout'];
  return isRecord(layout) && layout['visibility'] === 'none';
}

/** One colour-bearing paint property of one visible layer. */
export interface PaintSlot {
  /** The layer this came from, as a live record. */
  readonly layer: Record<string, unknown>;
  /** That layer's `paint` object, as a live record. */
  readonly paint: Record<string, unknown>;
  /**
   * The id every class from this slot is named under: the layer id, suffixed
   * `:<type>` where one layer paints more than one colour property. A match
   * expression appends `/<label>` per branch on top of this.
   */
  readonly baseId: string;
  readonly colorKey: string;
  readonly opacityKey: string;
  readonly type: PaintType;
}

/**
 * Every colour-bearing paint property in a style, in layer order.
 *
 * @param style - Parsed style JSON. Anything without a `layers` array yields
 *   an empty list rather than an error.
 * @returns One slot per colour property of each visible layer. The `paint`
 *   records are the style's own, so a caller may write through them.
 */
export function paintSlots(style: unknown): PaintSlot[] {
  if (!isRecord(style) || !Array.isArray(style['layers'])) {
    return [];
  }

  const layers: readonly unknown[] = style['layers'];
  const slots: PaintSlot[] = [];

  for (const [index, rawLayer] of layers.entries()) {
    if (!isRecord(rawLayer) || isHidden(rawLayer)) {
      continue;
    }

    const layerId =
      typeof rawLayer['id'] === 'string' && rawLayer['id'] !== ''
        ? rawLayer['id']
        : `layer-${String(index)}`;
    const paint = isRecord(rawLayer['paint']) ? rawLayer['paint'] : {};

    const present = PAINT_PROPERTIES.filter(
      (property) => paint[property.colorKey] !== undefined,
    );

    for (const { colorKey, opacityKey, type } of present) {
      // Only disambiguate by paint type when one layer really does paint more
      // than one of them, so the common case keeps the bare layer id.
      slots.push({
        layer: rawLayer,
        paint,
        baseId: present.length > 1 ? `${layerId}:${type}` : layerId,
        colorKey,
        opacityKey,
        type,
      });
    }
  }

  return slots;
}
