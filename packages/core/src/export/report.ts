/**
 * Audit report rendering: one machine-readable form, one human-readable form.
 *
 * Both take the same {@link ReportData}, so a JSON report and an HTML report of
 * the same audit always say the same thing. The HTML report leads with the
 * plain-language verdict from `./language.js` and keeps the full numbers
 * further down, where a reader who wants them can find them.
 */

import { compositeOver } from '../audit/composite.js';
import {
  DEFAULT_THRESHOLD,
  VISION_MODES,
  type AuditOptions,
  type AuditPair,
  type AuditResult,
  type VisionMode,
} from '../audit/engine.js';
import { CVD_MATRICES, simulateCVD } from '../color/cvd.js';
import { rgbToHex, type RGB } from '../color/parse.js';
import type { MapClass } from '../style/extract.js';
import {
  ABOUT_TEXT,
  VISION_MODE_LABELS,
  VISION_MODE_SHORT,
  clashSentence,
  humaniseClassId,
  summariseAudit,
} from './language.js';

/** Everything a report needs: the inputs, the verdict, and when it was run. */
export interface ReportData {
  /** When the audit ran, as an ISO 8601 string. */
  timestamp: string;
  /** Where the style came from: a path, a URL, or any label the caller likes. */
  styleSource: string;
  /** The classes that were audited. */
  classes: MapClass[];
  /** The audit verdict. */
  audit: AuditResult;
  /** The options the audit ran under. */
  options: AuditOptions;
}

/** The options with defaults filled in, so a report never prints "undefined". */
interface ResolvedOptions {
  readonly background: RGB;
  readonly threshold: number;
  readonly modes: readonly VisionMode[];
}

function resolveOptions(options: AuditOptions): ResolvedOptions {
  return {
    background: options.background ?? [1, 1, 1],
    threshold: options.threshold ?? DEFAULT_THRESHOLD,
    modes: options.modes ?? VISION_MODES,
  };
}

/**
 * Serialise a report as JSON.
 *
 * The output is {@link ReportData} verbatim, so it round-trips through
 * `JSON.parse` into the same shape. Colours stay as sRGB triples in 0..1;
 * `rgbToHex` turns them into `#rrggbb` when a consumer wants that.
 *
 * @param data - The report to serialise.
 * @returns JSON text, indented by two spaces.
 */
export function generateJsonReport(data: ReportData): string {
  return JSON.stringify(data, null, 2);
}

/* ------------------------------------------------------------------ *
 * HTML report
 * ------------------------------------------------------------------ */

/** Escape text for insertion into HTML, including attribute values. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** What a class looks like once flattened onto the background. */
function flatten(cls: MapClass, background: RGB): RGB {
  return compositeOver(cls.color, cls.opacity, background);
}

/** What a flattened colour looks like under one vision mode. */
function asSeen(color: RGB, mode: VisionMode): RGB {
  return mode === 'normal' ? color : simulateCVD(color, mode);
}

/** A bare colour chip. */
function chip(color: RGB, title: string): string {
  return `<span class="chip-colour" style="background:${rgbToHex(color)}" title="${escapeHtml(title)}"></span>`;
}

/** A labelled colour chip. Identity never rests on the colour alone. */
function swatch(color: RGB, label: string): string {
  return (
    `<span class="chip">${chip(color, label)}` +
    `<span class="chip-label">${escapeHtml(label)}</span></span>`
  );
}

/** `feColorMatrix` values for one dichromacy, from the Machado matrices. */
function colorMatrixValues(mode: Exclude<VisionMode, 'normal'>): string {
  const matrix = CVD_MATRICES[mode];
  const rows = matrix.map((row) => `${row.join(' ')} 0 0`);
  return `${rows.join(' ')} 0 0 0 1 0`;
}

/**
 * The SVG filters that let a reader preview the whole report as a dichromat.
 *
 * `color-interpolation-filters="linearRGB"` is the SVG default and is also what
 * the Machado matrices expect, but it is stated here so the filters keep
 * working if a stylesheet ever changes the default.
 */
function filterDefs(): string {
  const filters = (['protan', 'deutan', 'tritan'] as const)
    .map(
      (mode) =>
        `<filter id="cvd-${mode}" color-interpolation-filters="linearRGB">` +
        `<feColorMatrix type="matrix" values="${colorMatrixValues(mode)}"/>` +
        `</filter>`,
    )
    .join('');
  return `<svg class="filter-defs" aria-hidden="true" focusable="false"><defs>${filters}</defs></svg>`;
}

/** Radio inputs plus labels: a CSS-only vision-mode switch, no scripting. */
function visionControls(): string {
  const inputs = VISION_MODES.map(
    (mode, index) =>
      `<input type="radio" name="vision" id="vision-${mode}" class="vision-toggle"` +
      `${index === 0 ? ' checked' : ''}>`,
  ).join('');
  const labels = VISION_MODES.map(
    (mode) => `<label for="vision-${mode}">${escapeHtml(VISION_MODE_LABELS[mode])}</label>`,
  ).join('');
  return (
    `${inputs}<div class="controls" role="group" aria-label="Preview vision mode">` +
    `<span class="controls-title">Preview as</span>${labels}</div>`
  );
}

/** The verdict a reader sees before anything else. */
function verdictSection(data: ReportData): string {
  const summary = summariseAudit(data.classes, data.audit);
  const worst =
    summary.worstLine === undefined
      ? ''
      : `<p class="verdict-worst">${escapeHtml(summary.worstLine)}</p>`;

  return (
    `<section class="verdict verdict-${summary.level}">` +
    `<p class="verdict-label"><span class="verdict-dot" aria-hidden="true">${summary.indicator}</span>` +
    `${escapeHtml(summary.label)}</p>` +
    `<p class="verdict-headline">${escapeHtml(summary.headline)}</p>` +
    `<p class="verdict-detail">${escapeHtml(summary.detail)}</p>` +
    `${worst}</section>`
  );
}

/** The clashes, each as a sentence rather than a row of numbers. */
function clashSection(data: ReportData, resolved: ResolvedOptions): string {
  const { audit } = data;
  if (audit.failing.length === 0) {
    return (
      `<section><h2>Colour clashes</h2>` +
      `<p class="pass-note">✓ Every pair of map colours stays apart in ` +
      `${escapeHtml(resolved.modes.map((mode) => VISION_MODE_SHORT[mode].toLowerCase()).join(', '))}.</p></section>`
    );
  }

  // One line per pair of colours, naming the worst mode it fails in, so a
  // reader is not told the same thing four times over.
  const worstByPair = new Map<string, AuditPair>();
  for (const pair of audit.failing) {
    const key = `${pair.classA.id}\u0000${pair.classB.id}`;
    const current = worstByPair.get(key);
    if (current === undefined || pair.dE < current.dE) {
      worstByPair.set(key, pair);
    }
  }
  const worst = [...worstByPair.values()].sort((a, b) => a.dE - b.dE);

  const items = worst
    .map((pair) => {
      const nameA = humaniseClassId(pair.classA.id);
      const nameB = humaniseClassId(pair.classB.id);
      const flatA = flatten(pair.classA, resolved.background);
      const flatB = flatten(pair.classB, resolved.background);
      const seenA = asSeen(flatA, pair.mode);
      const seenB = asSeen(flatB, pair.mode);
      return (
        `<li class="clash">` +
        `<p class="clash-text">${escapeHtml(clashSentence(nameA, nameB, pair.mode))}</p>` +
        `<p class="clash-colours">` +
        `${chip(flatA, `${nameA}, as authored`)}${chip(flatB, `${nameB}, as authored`)}` +
        `<span class="clash-arrow" aria-hidden="true">→</span>` +
        `${chip(seenA, `${nameA}, simulated`)}${chip(seenB, `${nameB}, simulated`)}` +
        `<span class="clash-caption">as authored → as seen</span>` +
        `</p></li>`
      );
    })
    .join('');

  return (
    `<section><h2>Colour clashes <span class="count count-bad">${String(worst.length)}</span></h2>` +
    `<p class="note">Each line is one pair of map colours a reader cannot tell apart, shown ` +
    `under the vision mode where they are closest.</p>` +
    `<ul class="clashes">${items}</ul></section>`
  );
}

/** Failures broken down by vision mode. */
function modeSection(audit: AuditResult, resolved: ResolvedOptions): string {
  const rows = VISION_MODES.map((mode) => {
    const audited = resolved.modes.includes(mode);
    const count = audit.summary.byMode[mode];
    const verdict = !audited ? 'not checked' : count === 0 ? '✓ clear' : `✗ ${String(count)} clashing`;
    return (
      `<tr class="${!audited ? 'skipped' : count === 0 ? 'ok' : 'bad'}">` +
      `<td>${escapeHtml(VISION_MODE_LABELS[mode])}</td>` +
      `<td class="num">${audited ? String(count) : '—'}</td>` +
      `<td>${escapeHtml(verdict)}</td></tr>`
    );
  }).join('');

  return (
    `<section><h2>By vision mode</h2>` +
    `<table class="modes"><thead><tr><th>Who is affected</th><th class="num">Clashes</th><th>Verdict</th></tr></thead>` +
    `<tbody>${rows}</tbody></table></section>`
  );
}

/** Every colour the style paints, as swatch and name. */
function colourSection(classes: readonly MapClass[], background: RGB): string {
  if (classes.length === 0) {
    return `<section><h2>Map colours</h2><p class="empty">No colours were extracted from this style.</p></section>`;
  }

  const cards = classes
    .map((cls) => {
      const flat = flatten(cls, background);
      const name = humaniseClassId(cls.id);
      const opacity = cls.opacity === 1 ? '' : ` · ${String(Math.round(cls.opacity * 100))}% opacity`;
      return (
        `<li class="class-card">` +
        `<span class="class-colour" style="background:${rgbToHex(flat)}"></span>` +
        `<span class="class-text">` +
        `<span class="class-id">${escapeHtml(name)}</span>` +
        `<span class="class-meta">${escapeHtml(cls.type)} · ${rgbToHex(cls.color)}${escapeHtml(opacity)}</span>` +
        `</span></li>`
      );
    })
    .join('');

  return (
    `<section><h2>Map colours <span class="count">${String(classes.length)}</span></h2>` +
    `<p class="note">Each colour as it lands on the map background.</p>` +
    `<ul class="class-grid">${cards}</ul></section>`
  );
}

/** One row of the technical table. */
function technicalRow(pair: AuditPair, background: RGB): string {
  const seenA = asSeen(flatten(pair.classA, background), pair.mode);
  const seenB = asSeen(flatten(pair.classB, background), pair.mode);
  return (
    `<tr>` +
    `<td>${swatch(flatten(pair.classA, background), humaniseClassId(pair.classA.id))}</td>` +
    `<td>${swatch(flatten(pair.classB, background), humaniseClassId(pair.classB.id))}</td>` +
    `<td>${escapeHtml(VISION_MODE_LABELS[pair.mode])}</td>` +
    `<td class="num">${pair.dE.toFixed(2)}</td>` +
    `<td class="num">${pair.contrast.toFixed(2)}:1</td>` +
    `<td><span class="seen">${swatch(seenA, rgbToHex(seenA))}${swatch(seenB, rgbToHex(seenB))}</span></td>` +
    `</tr>`
  );
}

/**
 * The numbers behind the verdict.
 *
 * This is a document rather than a live panel, so the full table stays on the
 * page; it simply comes after the plain-language account rather than instead
 * of it.
 */
function technicalSection(data: ReportData, resolved: ResolvedOptions): string {
  const rows = data.audit.failing
    .slice()
    .sort((a, b) => a.dE - b.dE)
    .map((pair) => technicalRow(pair, resolved.background))
    .join('');

  const settings =
    `<p class="note">Audited at a CIEDE2000 threshold of ${String(resolved.threshold)} ΔE00 over ` +
    `<code>${rgbToHex(resolved.background)}</code>. ΔE00 is a measure of how different two colours ` +
    `look: below about 1 nothing is visible, and this audit asks for ${String(resolved.threshold)}, ` +
    `because map classes are read in small patches at a glance. Contrast is the WCAG 2.1 ratio.</p>`;

  if (rows === '') {
    return `<section><h2>Technical details</h2>${settings}<p class="empty">No pair fell below the threshold.</p></section>`;
  }

  return (
    `<section><h2>Technical details</h2>${settings}` +
    `<table><thead><tr>` +
    `<th>Colour A</th><th>Colour B</th><th>Vision mode</th>` +
    `<th class="num">ΔE00</th><th class="num">Contrast</th><th>As seen</th>` +
    `</tr></thead><tbody>${rows}</tbody></table>` +
    `<p class="note">${String(data.audit.summary.total)} judgements in total: every pair of map ` +
    `colours, under every vision mode checked.</p></section>`
  );
}

/** The report's stylesheet. Neutral ink throughout: colour belongs to the data. */
const STYLES = `
:root {
  --ink: #16191d;
  --ink-2: #4a5159;
  --ink-3: #6b737c;
  --surface: #ffffff;
  --surface-2: #f5f6f8;
  --line: #dfe3e8;
  --bad: #b42318;
  --warn: #b54708;
  --good: #1a7f4b;
  --radius: 6px;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 24px 16px 64px;
  background: var(--surface-2);
  color: var(--ink);
  font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  -webkit-text-size-adjust: 100%;
}
.filter-defs { position: absolute; width: 0; height: 0; }
.vision-toggle { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
.controls {
  display: flex; flex-wrap: wrap; gap: 6px; align-items: center;
  max-width: 1040px; margin: 0 auto 16px;
}
.controls-title { color: var(--ink-3); font-size: 13px; margin-right: 4px; }
.controls label {
  padding: 5px 11px; border: 1px solid var(--line); border-radius: 999px;
  background: var(--surface); color: var(--ink-2); font-size: 13px; cursor: pointer;
}
.controls label:hover { border-color: var(--ink-3); }
#vision-normal:checked ~ .controls label[for="vision-normal"],
#vision-protan:checked ~ .controls label[for="vision-protan"],
#vision-deutan:checked ~ .controls label[for="vision-deutan"],
#vision-tritan:checked ~ .controls label[for="vision-tritan"] {
  background: var(--ink); border-color: var(--ink); color: #fff;
}
.vision-toggle:focus-visible ~ .controls label[for] { outline: 2px solid var(--ink); outline-offset: 2px; }
#vision-protan:checked ~ .report { filter: url(#cvd-protan); }
#vision-deutan:checked ~ .report { filter: url(#cvd-deutan); }
#vision-tritan:checked ~ .report { filter: url(#cvd-tritan); }
.report { max-width: 1040px; margin: 0 auto; }
header { margin-bottom: 20px; }
h1 { font-size: 22px; margin: 0 0 6px; letter-spacing: -0.01em; }
h2 { font-size: 15px; margin: 0 0 10px; display: flex; align-items: center; gap: 8px; }
.meta { color: var(--ink-3); font-size: 13px; margin: 0; }
.meta code { font-size: 12px; background: var(--surface); padding: 1px 5px; border-radius: 4px; border: 1px solid var(--line); }
section {
  background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius);
  padding: 16px; margin-bottom: 14px;
}
.note, .pass-note { color: var(--ink-3); font-size: 13px; margin: 0 0 12px; }
.pass-note { color: var(--good); margin: 0; }
.empty { color: var(--ink-3); font-size: 13px; margin: 0; }
.count {
  font-size: 12px; font-weight: 400; color: var(--ink-3);
  background: var(--surface-2); border-radius: 999px; padding: 1px 8px;
}
.count-bad { color: #fff; background: var(--bad); }

/* ---- the verdict, which is the first thing anyone reads ---- */
.verdict { border-left: 4px solid var(--ink-3); }
.verdict-accessible { border-left-color: var(--good); }
.verdict-some-issues { border-left-color: var(--warn); }
.verdict-needs-attention { border-left-color: var(--bad); }
.verdict-label {
  margin: 0 0 6px; font-size: 12px; letter-spacing: 0.06em; text-transform: uppercase;
  color: var(--ink-3); display: flex; align-items: center; gap: 7px;
}
.verdict-dot { font-size: 14px; }
.verdict-accessible .verdict-label { color: var(--good); }
.verdict-some-issues .verdict-label { color: var(--warn); }
.verdict-needs-attention .verdict-label { color: var(--bad); }
.verdict-headline { margin: 0 0 4px; font-size: 24px; font-weight: 600; letter-spacing: -0.02em; }
.verdict-detail { margin: 0; color: var(--ink-2); font-size: 14px; max-width: 62ch; }
.verdict-worst { margin: 8px 0 0; color: var(--ink-3); font-size: 13px; }

/* ---- clashes as sentences ---- */
.clashes { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.clash { padding: 9px 0; border-bottom: 1px solid var(--line); }
.clash:last-child { border-bottom: 0; }
.clash-text { margin: 0 0 6px; font-size: 14px; }
.clash-colours { margin: 0; display: flex; align-items: center; gap: 2px; flex-wrap: wrap; }
.clash-arrow { color: var(--ink-3); margin: 0 7px; }
.clash-caption { color: var(--ink-3); font-size: 11px; margin-left: 10px; }

.class-grid { display: flex; flex-wrap: wrap; gap: 8px; margin: 0; padding: 0; list-style: none; }
.class-card {
  display: flex; align-items: center; gap: 10px; flex: 1 1 220px;
  border: 1px solid var(--line); border-radius: var(--radius); padding: 8px 10px;
}
.class-colour {
  width: 34px; height: 34px; flex: none; border-radius: 4px;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.14);
}
.class-text { display: flex; flex-direction: column; min-width: 0; }
.class-id { font-size: 13px; font-weight: 500; overflow-wrap: anywhere; }
.class-meta { color: var(--ink-3); font-size: 12px; font-variant-numeric: tabular-nums; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--line); vertical-align: middle; }
th { color: var(--ink-3); font-weight: 500; font-size: 12px; }
tbody tr:last-child td { border-bottom: 0; }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
.modes tr.skipped td { color: var(--ink-3); }
.modes tr.bad td:last-child { color: var(--bad); }
.modes tr.ok td:last-child { color: var(--good); }
.chip { display: inline-flex; align-items: center; gap: 7px; }
.chip-colour {
  width: 18px; height: 18px; flex: none; border-radius: 3px; display: inline-block;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.14);
}
.chip-label { overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
/* A 2px gap of surface between two swatches: without it two collapsed colours
   would read as one block and hide the very thing being shown. */
.seen { display: inline-flex; gap: 2px; align-items: center; flex-wrap: wrap; }
footer { color: var(--ink-3); font-size: 12px; max-width: 1040px; margin: 16px auto 0; }
@media (max-width: 620px) {
  table, thead, tbody, tr, th, td { display: block; }
  thead { display: none; }
  tbody tr { border-bottom: 1px solid var(--line); padding: 8px 0; }
  th, td { border: 0; padding: 3px 0; }
  td.num, th.num { text-align: left; }
}
`;

/**
 * Render a self-contained HTML report.
 *
 * The page has no external dependencies: styles are inline, the vision-mode
 * preview is a CSS-only radio switch driving inline SVG `feColorMatrix`
 * filters, and there is no scripting. It can be opened from disk or emailed as
 * a single file.
 *
 * It reads top to bottom from verdict, to what clashes and for whom, to the
 * colours themselves, to the numbers. Every colour shown belongs to the
 * audited style; the report's own chrome stays in neutral ink so the two are
 * never confused. Each swatch is labelled, so nothing depends on colour alone
 * - which matters rather more than usual in a report that is itself meant to
 * be read with colour vision deficiency.
 *
 * @param data - The report to render.
 * @returns A complete HTML document.
 */
export function generateHtmlReport(data: ReportData): string {
  const resolved = resolveOptions(data.options);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Map accessibility audit — ${escapeHtml(data.styleSource)}</title>
<style>${STYLES}</style>
</head>
<body>
${filterDefs()}
${visionControls()}
<main class="report">
<header>
<h1>Map accessibility audit</h1>
<p class="meta">Check if your map colours work for everyone.</p>
<p class="meta">Source <code>${escapeHtml(data.styleSource)}</code> · run ${escapeHtml(data.timestamp)}</p>
</header>
${verdictSection(data)}
${clashSection(data, resolved)}
${modeSection(data.audit, resolved)}
${colourSection(data.classes, resolved.background)}
${technicalSection(data, resolved)}
</main>
<footer>
${escapeHtml(ABOUT_TEXT)}
Dichromacy simulation follows Machado, Oliveira and Fernandes (2009) at full severity.
</footer>
</body>
</html>
`;
}
