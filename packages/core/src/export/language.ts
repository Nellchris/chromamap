/**
 * The words an audit is reported in.
 *
 * A map author is not a vision scientist. ΔE, CIEDE2000 and "protanopia" are
 * the right words for the engine and the wrong ones for the first thing a
 * reader sees, so every surface - the HTML report and the web app alike -
 * takes its phrasing from here rather than inventing its own.
 */

import type { AuditResult, VisionMode } from '../audit/engine.js';
import type { MapClass } from '../style/extract.js';

/** How a vision mode is named in a heading or a control. */
export const VISION_MODE_LABELS: Record<VisionMode, string> = {
  normal: 'Normal Vision',
  protan: 'Red-Blind (Protanopia)',
  deutan: 'Green-Blind (Deuteranopia)',
  tritan: 'Blue-Yellow Blind (Tritanopia)',
};

/** How a vision mode is named mid-sentence: "…look the same to X". */
export const VISION_MODE_AUDIENCE: Record<VisionMode, string> = {
  normal: 'everyone, before colour blindness is considered',
  protan: 'red-blind viewers',
  deutan: 'green-blind viewers',
  tritan: 'blue-yellow blind viewers',
};

/**
 * The bare name of a mode, with the clinical term left out.
 *
 * What a switch in the app is labelled with. "Protanopia" is the right word
 * for a report and the wrong one for a control a map author meets once.
 */
export const VISION_MODE_PLAIN: Record<VisionMode, string> = {
  normal: 'Normal',
  protan: 'Red-Blind',
  deutan: 'Green-Blind',
  tritan: 'Blue-Blind',
};

/** The short form used in a count: "Red-blind viewers (40 clashes)". */
export const VISION_MODE_SHORT: Record<VisionMode, string> = {
  normal: 'Normal vision',
  protan: 'Red-blind viewers',
  deutan: 'Green-blind viewers',
  tritan: 'Blue-yellow blind viewers',
};

/** One line explaining who this is for, used wherever there is room for it. */
export const ABOUT_TEXT =
  'This tool checks whether map colours remain distinguishable for people ' +
  'with colour vision deficiency (colour blindness). About 8% of men and ' +
  '0.5% of women are affected.';

/** What the tool is called, wherever it has to name itself. */
export const TOOL_NAME = 'CartoAccessibility Studio';

/** The version a report stamps itself with. Tracks the workspace version. */
export const TOOL_VERSION = '0.0.0';

/** Traffic-light verdict for a whole style. */
export type VerdictLevel = 'accessible' | 'some-issues' | 'needs-attention';

/**
 * Above this many clashes a style is called "needs attention".
 *
 * Amber covers one to fifty: a palette with a handful of collisions is worth
 * fixing but is not in trouble, and a map author who sees red for two clashes
 * learns to ignore the colour. Past fifty the problem is the palette, not a
 * pair of colours in it.
 */
const NEEDS_ATTENTION_FROM = 51;

/** A whole audit, said in plain words. */
export interface PlainSummary {
  /** Traffic-light level. */
  level: VerdictLevel;
  /** What the level is called: "Accessible", "Some issues", "Needs attention". */
  label: string;
  /** A coloured dot for the level, for surfaces that want one. */
  indicator: string;
  /** Distinct pairs of map colours that clash under at least one vision mode. */
  clashes: number;
  /** How many colours the style paints. */
  totalColours: number;
  /** How many of them are caught up in at least one clash. */
  confusableColours: number;
  /** The vision mode with the most clashes, if any. */
  worstMode: VisionMode | undefined;
  /** How many clashes that mode has. */
  worstModeClashes: number;
  /** "48 colour clashes found", or "No colour clashes found". */
  headline: string;
  /** "12 of 18 map colours become confusable…", or the all-clear equivalent. */
  detail: string;
  /** "Worst problems: Green-blind viewers (40 clashes)", when there are any. */
  worstLine: string | undefined;
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

/**
 * A count with thousands separated: a geological map's 1,295 clashes.
 *
 * Fixed to en-US rather than the host's locale so a report says the same thing
 * wherever it is generated and whoever opens it.
 */
const GROUPED = new Intl.NumberFormat('en-US');

export function formatCount(count: number): string {
  return GROUPED.format(count);
}

/**
 * Turn an audit into the plain-language verdict every surface leads with.
 *
 * A "clash" is a pair of map colours that a reader cannot tell apart under at
 * least one vision mode - counted once per pair, however many modes it fails
 * in, because that is what a map author has to go and fix.
 *
 * @param classes - The colours that were audited.
 * @param audit - What the engine found.
 * @returns The verdict, ready to render.
 */
export function summariseAudit(
  classes: readonly MapClass[],
  audit: AuditResult,
): PlainSummary {
  const clashedPairs = new Set(
    audit.failing.map((pair) => `${pair.classA.id}\u0000${pair.classB.id}`),
  );
  const clashedColours = new Set<string>();
  for (const pair of audit.failing) {
    clashedColours.add(pair.classA.id);
    clashedColours.add(pair.classB.id);
  }

  const clashes = clashedPairs.size;
  const level: VerdictLevel =
    clashes === 0 ? 'accessible' : clashes < NEEDS_ATTENTION_FROM ? 'some-issues' : 'needs-attention';

  let worstMode: VisionMode | undefined;
  let worstModeClashes = 0;
  for (const [mode, count] of Object.entries(audit.summary.byMode) as Array<
    [VisionMode, number]
  >) {
    if (count > worstModeClashes) {
      worstMode = mode;
      worstModeClashes = count;
    }
  }

  const headline =
    clashes === 0
      ? 'No colour clashes found'
      : `${formatCount(clashes)} colour ${plural(clashes, 'clash', 'clashes')} found`;

  const detail =
    clashes === 0
      ? `All ${String(classes.length)} map ${plural(classes.length, 'colour stays', 'colours stay')} distinguishable for people with colour vision deficiency`
      : `${formatCount(clashedColours.size)} of ${formatCount(classes.length)} map colours become confusable for people with colour vision deficiency`;

  const worstLine =
    worstMode === undefined
      ? undefined
      : `Worst problems: ${VISION_MODE_SHORT[worstMode]} (${formatCount(worstModeClashes)} ${plural(worstModeClashes, 'clash', 'clashes')})`;

  return {
    level,
    label:
      level === 'accessible'
        ? 'Accessible'
        : level === 'some-issues'
          ? 'Some issues'
          : 'Needs attention',
    indicator: level === 'accessible' ? '🟢' : level === 'some-issues' ? '🟡' : '🔴',
    clashes,
    totalColours: classes.length,
    confusableColours: clashedColours.size,
    worstMode,
    worstModeClashes,
    headline,
    detail,
    worstLine,
  };
}

/**
 * Turn a class, or a bare class id, into something readable.
 *
 * A class that carries a `displayName` - because its style held its GeoJSON
 * inline, or because a caller filled one in from data it fetched itself -
 * uses that. Otherwise the id is tidied up: `geologic-units/Qkh`,
 * `unit-contacts` and `labels:text` are the best names available when nothing
 * better is known.
 *
 * @param id - The class, or just its id.
 * @returns A human-facing name.
 */
export function humaniseClassId(id: string | MapClass): string {
  if (typeof id !== 'string') {
    const named = id.displayName;
    return named !== undefined && named.trim() !== '' ? named : humaniseClassId(id.id);
  }
  const slash = id.lastIndexOf('/');
  const layer = slash === -1 ? id : id.slice(0, slash);
  const value = slash === -1 ? undefined : id.slice(slash + 1);

  const pretty = (text: string): string => {
    const spaced = text.replace(/[-_]+/g, ' ').replace(/:/g, ' – ').trim();
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
  };

  if (value === undefined) {
    return pretty(layer);
  }
  if (value === 'default') {
    return `${pretty(layer)} (everything else)`;
  }
  return value;
}

/**
 * Why a pair is on the list, in the fewest words that still say something.
 *
 * "worst under red-blind vision" - the mode where the two colours are closest.
 * A pair whose worst mode is normal vision has nothing to do with colour
 * blindness at all: the style gives two classes the same colour.
 */
export function worstModeNote(mode: VisionMode): string {
  return mode === 'normal'
    ? 'already the same before colour blindness'
    : `worst under ${VISION_MODE_PLAIN[mode].toLowerCase()} vision`;
}

/** "“A” and “B” look the same to red-blind viewers". */
export function clashSentence(nameA: string, nameB: string, mode: VisionMode): string {
  return `“${nameA}” and “${nameB}” look the same to ${VISION_MODE_AUDIENCE[mode]}`;
}
