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
  ABOUT_TEXT,
  DEFAULT_THRESHOLD,
  VISION_MODES,
  VISION_MODE_LABELS,
  VISION_MODE_SHORT,
  compositeOver,
  humaniseClassId,
  rgbToHex,
  runAudit,
  simulateCVD,
  summariseAudit,
  type AuditPair,
  type AuditResult,
  type MapClass,
  type RGB,
  type VisionMode,
} from '@carto-a11y/core';

import { disclosure, el, swatch } from './dom.js';

/** How many clashes the panel shows before asking to be expanded. */
export const CLASHES_SHOWN = 5;

/**
 * Caps for a geological map, which has a hundred classes and a thousand
 * clashes. Building every row on every re-render would stall the panel, and
 * nobody reads the thousandth card anyway.
 */
export const CLASHES_MAX = 100;
const TECHNICAL_ROWS_MAX = 200;

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
 * The score: headline first, the explanation only if asked for.
 *
 * @param view - The palette being scored.
 * @param comparedTo - The version this one improves on, when there is one; its
 *   clash count becomes the "Down from N" line.
 */
export function scoreCard(view: AuditView, comparedTo?: AuditView): HTMLElement {
  const summary = summariseAudit(view.classes, view.audit);
  const card = el('section', `score score-${summary.level}`);
  card.setAttribute('aria-label', 'Map accessibility score');

  const label = el('p', 'score-label');
  const dot = el('span', 'score-dot', summary.indicator);
  dot.setAttribute('aria-hidden', 'true');
  label.append(dot, el('span', undefined, summary.label));

  card.append(label, el('p', 'score-headline', summary.headline));

  if (comparedTo !== undefined) {
    const was = summariseAudit(comparedTo.classes, comparedTo.audit).clashes;
    if (was > summary.clashes) {
      card.append(el('p', 'score-change', `Down from ${String(was)}`));
    }
  }

  // Everything that explains the number, folded away.
  const details = el('details', 'score-more');
  details.append(el('summary', 'score-more-summary', 'What does this mean?'));
  details.append(el('p', 'score-detail', summary.detail));
  if (summary.worstLine !== undefined) {
    details.append(el('p', 'score-worst', summary.worstLine));
  }
  details.append(
    el(
      'p',
      'score-detail',
      'Two map colours clash when a reader cannot tell them apart. The fewer, the better.',
    ),
  );
  card.append(details);
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
  section.append(el('h2', 'panel-title', 'Preview as'));

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
    label.append(input, el('span', undefined, VISION_MODE_LABELS[option]));
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

/** The clashes: big swatches, short names, a distance. */
export function clashPanel(options: ClashPanelOptions): HTMLElement {
  const { view } = options;
  const section = el('section', 'panel');
  const clashes = clashesByPair(view.audit);

  const heading = el('h2', 'panel-title', 'Worst clashes');
  if (clashes.length > 0) {
    heading.append(el('span', 'panel-count is-bad', String(clashes.length)));
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

    const nameA = humaniseClassId(pair.classA);
    const nameB = humaniseClassId(pair.classB);
    card.title = `${nameA} ↔ ${nameB} — ${VISION_MODE_LABELS[pair.mode]}`;

    const colours = el('div', 'clash-colours');
    colours.append(
      swatch(seenColor(pair.classA, view.background, pair.mode), nameA),
      swatch(seenColor(pair.classB, view.background, pair.mode), nameB),
    );

    const text = el('div', 'clash-labels');
    text.append(
      el(
        'span',
        'clash-codes',
        `${options.label(pair.classA)} ↔ ${options.label(pair.classB)}`,
      ),
      el(
        'span',
        'clash-meta',
        `ΔE ${pair.dE.toFixed(1)} · ${VISION_MODE_SHORT[pair.mode].toLowerCase()}`,
      ),
    );

    card.append(colours, text);
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
          ? `Show worst ${String(CLASHES_MAX)} of ${String(clashes.length)}`
          : `Show all ${String(clashes.length)}`,
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
 * Technical details and About
 * ------------------------------------------------------------------ */

export function technicalPanel(
  view: AuditView,
  label: (cls: MapClass) => string,
): HTMLElement {
  const { audit } = view;
  const body = el('div');

  body.append(
    el(
      'p',
      'note',
      `${String(audit.summary.total)} checks: every pair of map colours under every vision ` +
        `mode. A pair is reported when its CIEDE2000 distance (ΔE00) falls below ` +
        `${String(DEFAULT_THRESHOLD)}, measured on colours composited over ` +
        `${rgbToHex(view.background)}. Contrast is the WCAG 2.1 ratio. Dichromacy ` +
        `simulation follows Machado, Oliveira and Fernandes (2009) at full severity.`,
    ),
  );

  const modes = el('table', 'data-table');
  const modeHead = el('thead');
  const modeHeadRow = el('tr');
  modeHeadRow.append(el('th', undefined, 'Who is affected'), el('th', 'num', 'Clashes'));
  modeHead.append(modeHeadRow);
  const modeBody = el('tbody');
  for (const mode of VISION_MODES) {
    const row = el('tr');
    row.append(
      el('td', undefined, VISION_MODE_LABELS[mode]),
      el('td', 'num', String(audit.summary.byMode[mode])),
    );
    modeBody.append(row);
  }
  modes.append(modeHead, modeBody);
  body.append(el('p', 'technical-heading', 'By vision mode'), modes);

  if (audit.failing.length > 0) {
    const table = el('table', 'data-table');
    const head = el('thead');
    const headRow = el('tr');
    headRow.append(
      el('th', undefined, 'Pair'),
      el('th', 'num', 'ΔE00'),
      el('th', 'num', 'Contrast'),
    );
    head.append(headRow);
    const tableBody = el('tbody');
    const sorted = [...audit.failing].sort((a, b) => a.dE - b.dE);
    for (const pair of sorted.slice(0, TECHNICAL_ROWS_MAX)) {
      const row = el('tr');
      const cell = el('td');
      cell.append(
        el('span', 'data-pair', `${label(pair.classA)} ↔ ${label(pair.classB)}`),
        el('span', 'data-mode', VISION_MODE_LABELS[pair.mode]),
      );
      row.append(
        cell,
        el('td', 'num', pair.dE.toFixed(2)),
        el('td', 'num', `${pair.contrast.toFixed(2)}:1`),
      );
      tableBody.append(row);
    }
    table.append(head, tableBody);
    body.append(
      el(
        'p',
        'technical-heading',
        audit.failing.length > TECHNICAL_ROWS_MAX
          ? `Closest ${String(TECHNICAL_ROWS_MAX)} of ${String(audit.failing.length)} clashes`
          : `Every clash (${String(audit.failing.length)})`,
      ),
      table,
    );
  }

  return disclosure('Technical details', body);
}

export function aboutPanel(): HTMLElement {
  return disclosure('About', el('p', 'about-text', ABOUT_TEXT));
}
