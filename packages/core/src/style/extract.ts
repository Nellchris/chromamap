/**
 * Pull the colours a MapLibre GL style actually paints out of its JSON.
 *
 * Extraction is deliberately *static* and best-effort: a style may colour a
 * layer with a data expression that only has a value once real features are
 * loaded, and nothing here evaluates such an expression. Values that cannot be
 * resolved to a colour on their own are skipped rather than guessed at, so the
 * returned list is what the auditor can speak about with confidence.
 *
 * Supported colour forms per paint property:
 * - a plain string, in any format {@link parseColor} accepts
 * - a legacy stop function, `{ stops: [[0, '#aaa'], [10, '#bbb']] }`, from
 *   which the last stop is taken as the representative colour
 * - a `["match", input, label, colour, ..., fallback]` expression, whose
 *   branches each become a class of their own
 *
 * @see https://maplibre.org/maplibre-style-spec/
 */

import { parseColor, type RGB } from '../color/parse.js';

/** One paintable thing in a style: a layer, or one branch of a match. */
export interface MapClass {
  /**
   * Layer id, suffixed where one layer yields several classes: `:<type>` when
   * a layer paints more than one of the properties below, and `/<label>` for
   * each branch of a match expression.
   */
  id: string;
  /** The colour as authored, before any compositing. */
  color: RGB;
  /** Which paint property this came from. */
  type: 'fill' | 'line' | 'text' | 'circle';
  /** The matching `*-opacity`, or 1 when absent or not statically resolvable. */
  opacity: number;
}

/** The paint properties that carry a colour, and what they map to. */
const PAINT_PROPERTIES: ReadonlyArray<{
  readonly colorKey: string;
  readonly opacityKey: string;
  readonly type: MapClass['type'];
}> = [
  { colorKey: 'fill-color', opacityKey: 'fill-opacity', type: 'fill' },
  { colorKey: 'line-color', opacityKey: 'line-opacity', type: 'line' },
  { colorKey: 'text-color', opacityKey: 'text-opacity', type: 'text' },
  { colorKey: 'circle-color', opacityKey: 'circle-opacity', type: 'circle' },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The output of the last entry of a legacy `{ stops: [...] }` function. */
function lastStopOutput(value: unknown): unknown {
  if (!isRecord(value) || !Array.isArray(value['stops'])) {
    return undefined;
  }
  const stops: readonly unknown[] = value['stops'];
  const last = stops.at(-1);
  if (!Array.isArray(last) || last.length < 2) {
    return undefined;
  }
  const output: readonly unknown[] = last;
  return output[1];
}

/** True for `["match", ...]`, the one expression form handled here. */
function isMatchExpression(value: unknown): value is readonly unknown[] {
  return Array.isArray(value) && value[0] === 'match';
}

/** Render a match label (or label list) as an id fragment. */
function labelToIdFragment(label: unknown): string {
  if (Array.isArray(label)) {
    const labels: readonly unknown[] = label;
    return labels.map((entry) => String(entry)).join('|');
  }
  return String(label);
}

/**
 * Split a match expression into its labelled branches.
 *
 * `["match", input, l1, o1, l2, o2, fallback]` yields the two labelled pairs
 * plus the trailing fallback, which is reported under the label `default`.
 */
function matchBranches(
  expression: readonly unknown[],
): ReadonlyArray<{ readonly label: string; readonly output: unknown }> {
  const branches: Array<{ label: string; output: unknown }> = [];
  let index = 2;
  while (index + 1 < expression.length) {
    branches.push({
      label: labelToIdFragment(expression[index]),
      output: expression[index + 1],
    });
    index += 2;
  }
  if (index === expression.length - 1) {
    branches.push({ label: 'default', output: expression[index] });
  }
  return branches;
}

/** Resolve a paint value to a colour, or undefined when it is not static. */
function resolveColor(value: unknown): RGB | undefined {
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
function resolveOpacity(value: unknown): number {
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
function isHidden(layer: Record<string, unknown>): boolean {
  const layout = layer['layout'];
  return isRecord(layout) && layout['visibility'] === 'none';
}

/**
 * Extract every statically known colour from a MapLibre GL style.
 *
 * @param style - Parsed style JSON. Anything without a `layers` array yields
 *   an empty list rather than an error, so a malformed style degrades to "no
 *   classes found".
 * @returns One {@link MapClass} per resolvable colour, in layer order.
 */
export function extractClasses(style: unknown): MapClass[] {
  if (!isRecord(style) || !Array.isArray(style['layers'])) {
    return [];
  }

  const layers: readonly unknown[] = style['layers'];
  const classes: MapClass[] = [];

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
      const baseId = present.length > 1 ? `${layerId}:${type}` : layerId;
      const opacity = resolveOpacity(paint[opacityKey]);
      const value = paint[colorKey];

      if (isMatchExpression(value)) {
        for (const { label, output } of matchBranches(value)) {
          const color = resolveColor(output);
          if (color !== undefined) {
            classes.push({ id: `${baseId}/${label}`, color, type, opacity });
          }
        }
        continue;
      }

      const color = resolveColor(value);
      if (color !== undefined) {
        classes.push({ id: baseId, color, type, opacity });
      }
    }
  }

  return classes;
}
