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
 * The walk itself, and with it the id scheme, lives in `./slots.js`, which the
 * rewriter shares so the two cannot drift apart.
 *
 * @see https://maplibre.org/maplibre-style-spec/
 */

import type { RGB } from '../color/parse.js';

import {
  isHidden,
  isMatchExpression,
  isRecord,
  matchBranches,
  matchInputProperty,
  paintSlots,
  resolveColor,
  resolveOpacity,
  type PaintType,
} from './slots.js';

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
  type: PaintType;
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

/**
 * Extract every statically known colour from a MapLibre GL style.
 *
 * @param style - Parsed style JSON. Anything without a `layers` array yields
 *   an empty list rather than an error, so a malformed style degrades to "no
 *   classes found".
 * @returns One {@link MapClass} per resolvable colour, in layer order.
 */
export function extractClasses(style: unknown): MapClass[] {
  if (!isRecord(style)) {
    return [];
  }

  const classes: MapClass[] = [];
  const featuresBySource = inlineFeatures(style);

  /** Attach a readable name only when one was actually found. */
  const withName = (cls: MapClass, name: string | undefined): MapClass => {
    if (name !== undefined) {
      cls.displayName = name;
    }
    return cls;
  };

  for (const slot of paintSlots(style)) {
    const sourceId = slot.layer['source'];
    const features =
      typeof sourceId === 'string' ? featuresBySource.get(sourceId) : undefined;
    const opacity = resolveOpacity(slot.paint[slot.opacityKey]);
    const value = slot.paint[slot.colorKey];

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
            withName(
              { id: `${slot.baseId}/${label}`, color, type: slot.type, opacity },
              name,
            ),
          );
        }
      }
      continue;
    }

    const color = resolveColor(value);
    if (color !== undefined) {
      classes.push({ id: slot.baseId, color, type: slot.type, opacity });
    }
  }

  return classes;
}
