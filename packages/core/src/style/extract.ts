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

/** What a style is drawn on when it names no background of its own. */
const PAPER_WHITE: RGB = [1, 1, 1];

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
  /**
   * A readable name for this class, when the style carries one.
   *
   * Only available when the layer's source holds its GeoJSON inline: the
   * features are then searched for the one this class paints, and a `name`,
   * `unit_name`, `label` or similar property is taken from it. A source given
   * as a URL cannot be read here - extraction never fetches - so the name
   * stays undefined and callers fall back to the id.
   */
  displayName?: string;
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
): ReadonlyArray<{ readonly label: string; readonly raw: unknown; readonly output: unknown }> {
  const branches: Array<{ label: string; raw: unknown; output: unknown }> = [];
  let index = 2;
  while (index + 1 < expression.length) {
    branches.push({
      label: labelToIdFragment(expression[index]),
      raw: expression[index],
      output: expression[index + 1],
    });
    index += 2;
  }
  if (index === expression.length - 1) {
    branches.push({ label: 'default', raw: undefined, output: expression[index] });
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

/** Properties a feature might carry its readable name under. */
const NAME_KEYS = [
  'name',
  'NAME',
  'unit_name',
  'UNIT_NAME',
  'unitname',
  'label',
  'LABEL',
  'title',
  'description',
] as const;

/** The readable name on a feature, if it has one. */
function featureName(feature: unknown): string | undefined {
  if (!isRecord(feature)) {
    return undefined;
  }
  const properties = feature['properties'];
  if (!isRecord(properties)) {
    return undefined;
  }
  for (const key of NAME_KEYS) {
    const value = properties[key];
    if (typeof value === 'string' && value.trim() !== '') {
      return value;
    }
  }
  return undefined;
}

/** Inline GeoJSON features per source id; sources given as a URL are skipped. */
function inlineFeatures(style: Record<string, unknown>): Map<string, readonly unknown[]> {
  const bySource = new Map<string, readonly unknown[]>();
  const sources = style['sources'];
  if (!isRecord(sources)) {
    return bySource;
  }
  for (const [id, source] of Object.entries(sources)) {
    if (!isRecord(source) || source['type'] !== 'geojson') {
      continue;
    }
    const data = source['data'];
    if (!isRecord(data)) {
      // A URL. Extraction never fetches, so there is nothing to read here.
      continue;
    }
    const features = data['features'];
    if (Array.isArray(features)) {
      bySource.set(id, features);
    }
  }
  return bySource;
}

/** The feature property a match expression switches on, if it is a plain get. */
function matchInputProperty(expression: readonly unknown[]): string | undefined {
  const input = expression[1];
  if (Array.isArray(input) && input[0] === 'get' && typeof input[1] === 'string') {
    return input[1];
  }
  // The legacy form names the property directly.
  return typeof input === 'string' ? input : undefined;
}

/** The name of the first feature whose `property` equals `label`. */
function nameForLabel(
  features: readonly unknown[],
  property: string,
  label: unknown,
): string | undefined {
  const wanted = Array.isArray(label) ? (label as unknown[])[0] : label;
  for (const feature of features) {
    if (!isRecord(feature)) {
      continue;
    }
    const properties = feature['properties'];
    if (isRecord(properties) && String(properties[property]) === String(wanted)) {
      return featureName(feature);
    }
  }
  return undefined;
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
/**
 * The colour a style paints behind everything else.
 *
 * A `background` layer is not a class - nothing else is compared against it -
 * but it is what every translucent class ends up composited over, so an audit
 * of a style should use it rather than assuming white paper.
 *
 * @param style - Parsed style JSON.
 * @returns The first `background-color` found, or white.
 */
export function extractBackground(style: unknown): RGB {
  if (!isRecord(style) || !Array.isArray(style['layers'])) {
    return [...PAPER_WHITE];
  }
  for (const layer of style['layers'] as readonly unknown[]) {
    if (!isRecord(layer) || isHidden(layer)) {
      continue;
    }
    const paint = layer['paint'];
    if (!isRecord(paint)) {
      continue;
    }
    const colour = resolveColor(paint['background-color']);
    if (colour !== undefined) {
      return colour;
    }
  }
  return [...PAPER_WHITE];
}

export function extractClasses(style: unknown): MapClass[] {
  if (!isRecord(style) || !Array.isArray(style['layers'])) {
    return [];
  }

  const layers: readonly unknown[] = style['layers'];
  const classes: MapClass[] = [];
  const featuresBySource = inlineFeatures(style);

  /** Attach a readable name only when one was actually found. */
  const withName = (cls: MapClass, name: string | undefined): MapClass => {
    if (name !== undefined) {
      cls.displayName = name;
    }
    return cls;
  };

  for (const [index, rawLayer] of layers.entries()) {
    if (!isRecord(rawLayer) || isHidden(rawLayer)) {
      continue;
    }

    const layerId =
      typeof rawLayer['id'] === 'string' && rawLayer['id'] !== ''
        ? rawLayer['id']
        : `layer-${String(index)}`;
    const paint = isRecord(rawLayer['paint']) ? rawLayer['paint'] : {};
    const sourceId = rawLayer['source'];
    const features =
      typeof sourceId === 'string' ? featuresBySource.get(sourceId) : undefined;

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
        const property = matchInputProperty(value);
        for (const { label, raw, output } of matchBranches(value)) {
          const color = resolveColor(output);
          if (color !== undefined) {
            const name =
              features === undefined || property === undefined || raw === undefined
                ? undefined
                : nameForLabel(features, property, raw);
            classes.push(
              withName({ id: `${baseId}/${label}`, color, type, opacity }, name),
            );
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
