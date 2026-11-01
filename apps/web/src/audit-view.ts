/**
 * The panels that read an audit, shared by both modes of the app.
 *
 * The Hawaiʻi demo and an uploaded style are the same thing to the engine - a
 * list of map classes and what the auditor made of them - so they get the same
 * score card, the same clash list and the same technical table. Only what is
 * *beside* the panel differs: a map for the demo, a grid of swatches for a
 * style whose data we do not have.
 *
 * All wording comes from core, so the panel, the CLI and an exported report say
 * the same things in the same words.
 */

import {
  PREVALENCE_SOURCE,
  VISION_MODES,
  VISION_MODE_PLAIN,
  compositeOver,
  formatCount,
  generateHtmlReport,
  humaniseClassId,
  rgbToHex,
  runAudit,
  simulateCVD,
  summariseAudit,
  worstModeNote,
  type AuditPair,
  type AuditResult,
  type MapClass,
  type PlainSummary,
  type RGB,
  type ReportData,
  type RemediationResult,
  type VisionMode,
} from '@carto-a11y/core';

import { download, el } from './dom.js';

/** How many clashes the panel shows before asking to be expanded. */
export const CLASHES_SHOWN = 5;

/**
 * Caps for a geological map, which has a hundred classes and a thousand
 * clashes. Building every row on every re-render would stall the panel, and
 * nobody reads the thousandth card anyway.
 */
export const CLASHES_MAX = 100;

/**
 * What one mode of the app hands the shell to render.
 *
 * The shell owns the page: the two tabs, the panel, the area beside it. A mode
 * owns what goes in them. Keeping that contract this small is what lets the
 * demo put a live map where an uploaded style puts a grid of swatches, without
 * either knowing the other exists.
 */
export interface ModeView {
  /** The title in the caption over the map area. */
  caption: string;
  /** Goes under the tabs: the before/after switch, when there is one. */
  header: HTMLElement[];
  /** The score card. */
  score: HTMLElement[];
  /** The scrolling body of the panel. */
  body: HTMLElement[];
  /** What to put over the map area; empty leaves the map showing. */
  cover: HTMLElement[];
  /** Whether the vision-mode switcher belongs at the top of the body. */
  vision: boolean;
}

/** One palette and what the auditor made of it. */
export interface AuditView {
  classes: MapClass[];
  audit: AuditResult;
  background: RGB;
}

/** Audit a palette and keep the three things every panel needs together. */
export function auditView(classes: MapClass[], background: RGB): AuditView {
  return { classes, audit: runAudit(classes, { background }), background };
}

/** A class's colour as a reader in this mode sees it, flattened and simulated. */
export function seenColor(cls: MapClass, background: RGB, mode: VisionMode): RGB {
  const flat = compositeOver(cls.color, cls.opacity, background);
  return mode === 'normal' ? flat : simulateCVD(flat, mode);
}

/** One clash per pair of colours, worst mode first. */
export function clashesByPair(audit: AuditResult): AuditPair[] {
  const worstByPair = new Map<string, AuditPair>();
  for (const pair of audit.failing) {
    const key = `${pair.classA.id}\u0000${pair.classB.id}`;
    const existing = worstByPair.get(key);
    if (existing === undefined || pair.dE < existing.dE) {
      worstByPair.set(key, pair);
    }
  }
  return [...worstByPair.values()].sort((a, b) => a.dE - b.dE);
}

/** Which classes each class clashes with, by id. */
export function clashPartners(audit: AuditResult): Map<string, Set<string>> {
  const partners = new Map<string, Set<string>>();
  const link = (from: string, to: string): void => {
    const set = partners.get(from) ?? new Set<string>();
    set.add(to);
    partners.set(from, set);
  };
  for (const pair of audit.failing) {
    link(pair.classA.id, pair.classB.id);
    link(pair.classB.id, pair.classA.id);
  }
  return partners;
}

/* ------------------------------------------------------------------ *
 * Score
 * ------------------------------------------------------------------ */

/**
 * The ring beside the number: how much of the palette is caught up in a clash.
 *
 * A count on its own does not say whether 40 clashes is most of the map or a
 * corner of it. The ring does, at a glance, and it is drawn from the same
 * figures the sentence below it uses.
 */
function donut(summary: PlainSummary): SVGSVGElement {
  const RADIUS = 26;
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
  const share =
    summary.totalColours === 0 ? 0 : summary.confusableColours / summary.totalColours;

  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'donut');
  svg.setAttribute('viewBox', '0 0 64 64');
  svg.setAttribute('role', 'img');
  svg.setAttribute(
    'aria-label',
    summary.totalColours === 0
      ? 'No colours to check'
      : `${formatCount(summary.confusableColours)} of ${formatCount(summary.totalColours)} colours are caught up in a clash`,
  );

  for (const [cls, length] of [
    ['donut-track', CIRCUMFERENCE],
    ['donut-arc', share * CIRCUMFERENCE],
  ] as const) {
    const circle = document.createElementNS(ns, 'circle');
    circle.setAttribute('class', cls);
    circle.setAttribute('cx', '32');
    circle.setAttribute('cy', '32');
    circle.setAttribute('r', String(RADIUS));
    circle.setAttribute('fill', 'none');
    circle.setAttribute('stroke-width', '9');
    circle.setAttribute('stroke-linecap', 'round');
    if (cls === 'donut-arc') {
      circle.setAttribute('stroke-dasharray', `${String(length)} ${String(CIRCUMFERENCE)}`);
      circle.setAttribute('transform', 'rotate(-90 32 32)');
    }
    svg.append(circle);
  }
  return svg;
}

/**
 * The score: a ring, a number, and one sentence saying what the number counts.
 *
 * Nothing else. ΔE figures, contrast ratios, thresholds and the methodology
 * behind them live in the downloadable report, where a reader who wants them
 * has gone looking; a map author opening the panel wants to know whether their
 * map works and what to fix.
 *
 * @param view - The palette being scored.
 * @param comparedTo - The version this one improves on, when there is one.
 */
export function scoreCard(view: AuditView, comparedTo?: AuditView): HTMLElement {
  const summary = summariseAudit(view.classes, view.audit);
  const card = el('section', `score score-${summary.level}`);
  card.setAttribute('aria-label', 'Map accessibility score');

  const head = el('div', 'score-head');
  head.append(donut(summary));

  const text = el('div', 'score-text');
  const headline = el('p', 'score-headline');
  headline.append(
    el('span', 'score-number', formatCount(summary.clashes)),
    el(
      'span',
      'score-unit',
      summary.clashes === 1 ? 'colour clash' : 'colour clashes',
    ),
  );
  text.append(headline);

  // The traffic light is a colour, and this of all tools cannot let a colour
  // carry a meaning on its own: the glyph and the word say it too.
  const verdict = el('p', 'score-verdict');
  const dot = el('span', 'score-dot', summary.indicator);
  dot.setAttribute('aria-hidden', 'true');
  verdict.append(dot, el('span', undefined, summary.label));
  text.append(verdict);
  head.append(text);
  card.append(head);

  card.append(
    el(
      'p',
      'score-plain',
      summary.clashes === 0
        ? 'Every pair of colours on this map stays distinguishable.'
        : 'A clash is a pair of colours that looks the same to people with colour blindness.',
    ),
  );

  if (comparedTo !== undefined) {
    const was = summariseAudit(comparedTo.classes, comparedTo.audit).clashes;
    if (was > summary.clashes) {
      card.append(el('p', 'score-change', `Down from ${formatCount(was)}`));
    }
  }

  return card;
}

/* ------------------------------------------------------------------ *
 * Vision mode
 * ------------------------------------------------------------------ */

export function visionPanel(
  mode: VisionMode,
  onMode: (mode: VisionMode) => void,
): HTMLElement {
  const section = el('section', 'panel');
  section.append(el('h2', 'panel-title', 'Simulate colour blindness'));

  const group = el('div', 'modes');
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', 'Vision mode');

  for (const option of VISION_MODES) {
    const label = el('label', 'mode');
    const input = el('input');
    input.type = 'radio';
    input.name = 'vision-mode';
    input.value = option;
    input.checked = mode === option;
    input.addEventListener('change', () => {
      onMode(option);
    });
    label.append(input, el('span', undefined, VISION_MODE_PLAIN[option]));
    group.append(label);
  }

  section.append(group);
  return section;
}

/* ------------------------------------------------------------------ *
 * Clashes
 * ------------------------------------------------------------------ */

export interface ClashPanelOptions {
  view: AuditView;
  /** What to call a class on a card; the demo uses its unit codes. */
  label: (cls: MapClass) => string;
  activePair: AuditPair | undefined;
  showAll: boolean;
  onPair: (pair: AuditPair) => void;
  onToggleAll: () => void;
}

/**
 * The clashes, as paint chips.
 *
 * Two big swatches of the colours *as that reader sees them*, side by side, so
 * the card shows the problem rather than asserting it; then the two names; then
 * one short line saying which kind of vision it is worst for. No distance, no
 * hex, no ratio - a map author cannot act on 4.2 ΔE00, and the report carries
 * it for anyone who can.
 */
export function clashPanel(options: ClashPanelOptions): HTMLElement {
  const { view } = options;
  const section = el('section', 'panel');
  const clashes = clashesByPair(view.audit);

  const heading = el('h2', 'panel-title', 'Worst clashes');
  if (clashes.length > 0) {
    heading.append(el('span', 'panel-count is-bad', formatCount(clashes.length)));
  }
  section.append(heading);

  if (clashes.length === 0) {
    section.append(el('p', 'empty', 'Nothing on this map is confusable ✓'));
    return section;
  }

  const shown = clashes.slice(0, options.showAll ? CLASHES_MAX : CLASHES_SHOWN);
  const list = el('ul', 'list');
  for (const pair of shown) {
    const item = el('li');
    const card = el('button', `clash${options.activePair === pair ? ' is-active' : ''}`);
    card.type = 'button';

    const nameA = options.label(pair.classA);
    const nameB = options.label(pair.classB);
    card.title = `${nameA} and ${nameB}: ${worstModeNote(pair.mode)}`;

    const chips = el('span', 'chips');
    for (const [cls, name] of [
      [pair.classA, nameA],
      [pair.classB, nameB],
    ] as const) {
      const chip = el('span', 'chip');
      chip.style.background = rgbToHex(seenColor(cls, view.background, pair.mode));
      chip.title = name;
      chips.append(chip);
    }

    const names = el('span', 'clash-names');
    names.append(
      el('span', 'clash-name', nameA),
      el('span', 'clash-swap', '↔'),
      el('span', 'clash-name', nameB),
    );

    card.append(chips, names, el('span', 'clash-why', worstModeNote(pair.mode)));
    card.addEventListener('click', () => {
      options.onPair(pair);
    });
    item.append(card);
    list.append(item);
  }
  section.append(list);

  if (clashes.length > CLASHES_SHOWN) {
    const more = el(
      'button',
      'link-button',
      options.showAll
        ? 'Show fewer'
        : clashes.length > CLASHES_MAX
          ? `Show worst ${formatCount(CLASHES_MAX)} of ${formatCount(clashes.length)}`
          : `Show all ${formatCount(clashes.length)}`,
    );
    more.type = 'button';
    more.setAttribute('aria-expanded', String(options.showAll));
    more.addEventListener('click', options.onToggleAll);
    section.append(more);
  }
  return section;
}

/* ------------------------------------------------------------------ *
 * What changed
 * ------------------------------------------------------------------ */

/** What the repalette did, as a strip of before/after pairs. */
export function changedPanel(
  before: AuditView,
  after: AuditView,
  mode: VisionMode,
): HTMLElement {
  const section = el('section', 'panel');
  const wasById = new Map(before.classes.map((cls) => [cls.id, cls]));

  const heading = el('h2', 'panel-title', 'What changed');
  section.append(heading);

  const strip = el('ul', 'changed-strip');
  let changed = 0;
  for (const cls of after.classes) {
    const was = wasById.get(cls.id);
    if (was === undefined) {
      continue;
    }
    const name = humaniseClassId(cls);
    const beforeColor = seenColor(was, before.background, mode);
    const afterColor = seenColor(cls, after.background, mode);

    const item = el('li', 'changed-pair');
    item.title = `${name}: ${rgbToHex(beforeColor)} → ${rgbToHex(afterColor)}`;
    const left = el('span');
    left.style.background = rgbToHex(beforeColor);
    const right = el('span');
    right.style.background = rgbToHex(afterColor);
    item.append(left, right);
    strip.append(item);
    changed += 1;
  }

  heading.append(el('span', 'panel-count', String(changed)));
  section.append(strip);
  return section;
}

/* ------------------------------------------------------------------ *
 * Downloads
 *
 * Where everything the panel no longer says has gone. The panel answers "does
 * my map work, and what do I fix"; the report answers "how do you know", and
 * is what a reviewer, a journal or a procurement officer asks for.
 * ------------------------------------------------------------------ */

/** The move from one palette to another, as the report wants it. */
export function remediationOf(
  before: AuditView,
  after: AuditView,
): RemediationResult[] {
  const afterById = new Map(after.classes.map((cls) => [cls.id, cls] as const));
  return before.classes.flatMap((cls) => {
    const fixed = afterById.get(cls.id);
    return fixed === undefined
      ? []
      : [{ classId: cls.id, original: cls.color, remediated: fixed.color }];
  });
}

/** `city.json` becomes `city-accessibility-report.html`. */
function reportName(source: string): string {
  const base = source.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9-]+/g, '-');
  return `${base === '' ? 'map' : base}-accessibility-report.html`;
}

export interface DownloadsOptions {
  /** What the report should call the style it audited. */
  source: string;
  /** The palette as authored. */
  before: AuditView;
  /** The accessible palette, once there is one. */
  after: AuditView | undefined;
  /** Buttons the mode adds of its own, such as the demo's GeoJSON. */
  extra?: HTMLElement[];
}

export function downloadsPanel(options: DownloadsOptions): HTMLElement {
  const section = el('section', 'panel');
  section.append(el('h2', 'panel-title', 'Downloads'));

  for (const button of options.extra ?? []) {
    section.append(button);
  }

  const reportButton = el('button', 'secondary-button', 'Download technical report');
  reportButton.type = 'button';
  reportButton.addEventListener('click', () => {
    const { before, after } = options;
    const data: ReportData = {
      timestamp: new Date().toISOString(),
      styleSource: options.source,
      classes: before.classes,
      audit: before.audit,
      options: { background: before.background },
      ...(after === undefined
        ? {}
        : { remediation: remediationOf(before, after), remediatedAudit: after.audit }),
    };
    download(reportName(options.source), generateHtmlReport(data), 'text/html');
  });
  section.append(
    reportButton,
    el(
      'p',
      'secondary-hint',
      'Every measurement, the method behind it and the full clash table, as one HTML file.',
    ),
  );
  return section;
}

/* ------------------------------------------------------------------ *
 * How it works, and the closing note
 * ------------------------------------------------------------------ */

/**
 * The last thing in the panel: who this is actually for.
 *
 * Everything above it is about a palette. This is the reason the palette
 * matters, and it is the one line worth leaving open rather than folded away.
 */
export function funFactPanel(): HTMLElement {
  const section = el('section', 'panel fact');
  section.append(el('p', 'fact-label', 'Did you know?'));

  const text = el('p', 'fact-text');
  text.append(
    el(
      'span',
      undefined,
      'About 8% of men and 0.5% of women of Northern European descent have ' +
        'red-green colour vision deficiency — roughly one man in twelve. ',
    ),
  );
  // The figure is someone's finding, not folklore, and the panel says whose.
  const cite = el('a', 'fact-cite', `(${PREVALENCE_SOURCE.short})`);
  cite.href = PREVALENCE_SOURCE.doi;
  cite.target = '_blank';
  cite.rel = 'noreferrer';
  cite.title = PREVALENCE_SOURCE.full;
  text.append(cite);

  section.append(text);
  return section;
}
