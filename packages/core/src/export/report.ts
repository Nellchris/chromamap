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
import { rgbToLab } from '../color/lab.js';
import { rgbToHex, type RGB } from '../color/parse.js';
import { REMEDIATION_LIGHTNESS, type RemediationResult } from '../remediate/palette.js';
import type { MapClass } from '../style/extract.js';
import {
  ABOUT_TEXT,
  TOOL_NAME,
  TOOL_VERSION,
  VISION_MODE_LABELS,
  VISION_MODE_SHORT,
  clashSentence,
  formatCount,
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
  /**
   * The accessible palette, where one has been worked out.
   *
   * Optional because an audit stands on its own: the CLI reports what a style
   * does today whether or not anyone has asked for a repair. When it is here,
   * the report gains a before-and-after column and a remediation section.
   */
  remediation?: RemediationResult[];
  /** The audit of that palette, for the before-and-after figures. */
  remediatedAudit?: AuditResult;
  /** Overrides the tool version the report stamps itself with. */
  toolVersion?: string;
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

/** One clash in a JSON report: the two classes named by id, and the numbers. */
export interface JsonReportClash {
  classA: string;
  classB: string;
  mode: VisionMode;
  dE: number;
  contrast: number;
}

/** The shape {@link generateJsonReport} writes. */
export interface JsonReport {
  timestamp: string;
  styleSource: string;
  options: { background: RGB; threshold: number; modes: readonly VisionMode[] };
  summary: AuditResult['summary'];
  /** Every class, in style order. Clashes refer to these by `id`. */
  classes: MapClass[];
  /** Only the pairs that failed, closest first. */
  clashes: JsonReportClash[];
}

/**
 * Serialise a report as JSON.
 *
 * The classes are listed once and the clashes name them by id, rather than
 * each pair carrying two copies of a class object. On a small style that is
 * tidier; on a geological map with a hundred classes it is the difference
 * between a 225 kB file and a 12 MB one.
 *
 * Only failures are listed. Every pair judged is still accounted for in
 * `summary.total`, but a hundred classes make 19,800 judgements and the ones
 * that passed carry no information a reader or a diff can use.
 *
 * Colours stay as sRGB triples in 0..1; `rgbToHex` turns them into `#rrggbb`
 * when a consumer wants that.
 *
 * @param data - The report to serialise.
 * @returns JSON text, indented by two spaces.
 */
export function generateJsonReport(data: ReportData): string {
  const resolved = resolveOptions(data.options);
  const report: JsonReport = {
    timestamp: data.timestamp,
    styleSource: data.styleSource,
    options: {
      background: resolved.background,
      threshold: resolved.threshold,
      modes: resolved.modes,
    },
    summary: data.audit.summary,
    classes: data.classes,
    clashes: data.audit.failing
      .slice()
      .sort((a, b) => a.dE - b.dE)
      .map((pair) => ({
        classA: pair.classA.id,
        classB: pair.classB.id,
        mode: pair.mode,
        dE: pair.dE,
        contrast: pair.contrast,
      })),
  };
  return JSON.stringify(report, null, 2);
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
      const nameA = humaniseClassId(pair.classA);
      const nameB = humaniseClassId(pair.classB);
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
      const name = humaniseClassId(cls);
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

/** Below this ratio a pair fails WCAG 2.1 SC 1.4.11 for non-text contrast. */
const CONTRAST_FLOOR = 3;

/** One row of the technical table. */
function technicalRow(
  pair: AuditPair,
  background: RGB,
  fixed: ReadonlyMap<string, RGB> | undefined,
): string {
  const seenA = asSeen(flatten(pair.classA, background), pair.mode);
  const seenB = asSeen(flatten(pair.classB, background), pair.mode);
  const nameA = humaniseClassId(pair.classA);
  const nameB = humaniseClassId(pair.classB);

  const after =
    fixed === undefined
      ? ''
      : (() => {
          const fixedA = fixed.get(pair.classA.id);
          const fixedB = fixed.get(pair.classB.id);
          if (fixedA === undefined || fixedB === undefined) {
            return `<td class="muted">—</td>`;
          }
          return (
            `<td><span class="seen">` +
            `${swatch(fixedA, `${nameA}, remediated`)}${swatch(fixedB, `${nameB}, remediated`)}` +
            `</span></td>`
          );
        })();

  const contrastClass = pair.contrast < CONTRAST_FLOOR ? ' class="num bad-cell"' : ' class="num"';
  return (
    `<tr>` +
    `<td>${swatch(flatten(pair.classA, background), nameA)} <code>${rgbToHex(pair.classA.color)}</code></td>` +
    `<td>${swatch(flatten(pair.classB, background), nameB)} <code>${rgbToHex(pair.classB.color)}</code></td>` +
    `<td>${escapeHtml(VISION_MODE_LABELS[pair.mode])}</td>` +
    `<td class="num">${pair.dE.toFixed(2)}</td>` +
    `<td${contrastClass}>${pair.contrast.toFixed(2)}:1</td>` +
    `<td><span class="seen">${swatch(seenA, `${nameA}, simulated`)}${swatch(seenB, `${nameB}, simulated`)}</span></td>` +
    `${after}</tr>`
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
  const fixed =
    data.remediation === undefined
      ? undefined
      : new Map(data.remediation.map((entry) => [entry.classId, entry.remediated] as const));

  const rows = data.audit.failing
    .slice()
    .sort((a, b) => a.dE - b.dE)
    .map((pair) => technicalRow(pair, resolved.background, fixed))
    .join('');

  const settings =
    `<p class="note">Audited at a CIEDE2000 threshold of ${String(resolved.threshold)} ΔE00 over ` +
    `<code>${rgbToHex(resolved.background)}</code>. ΔE00 is a measure of how different two colours ` +
    `look: below about 1 nothing is visible, and this audit asks for ${String(resolved.threshold)}, ` +
    `because map classes are read in small patches at a glance. Contrast is the WCAG 2.1 ratio.</p>`;

  if (rows === '') {
    return `<section id="clash-table"><h2>Technical details</h2>${settings}<p class="empty">No pair fell below the threshold.</p></section>`;
  }

  return (
    `<section id="clash-table"><h2>Technical details</h2>${settings}` +
    `<table><thead><tr>` +
    `<th>Colour A</th><th>Colour B</th><th>Vision mode</th>` +
    `<th class="num">ΔE00</th><th class="num">Contrast</th><th>As seen</th>` +
    `${fixed === undefined ? '' : '<th>Remediated</th>'}` +
    `</tr></thead><tbody>${rows}</tbody></table>` +
    `<p class="note">${formatCount(data.audit.summary.total)} judgements in total: every pair of ` +
    `map colours, under every vision mode checked. A contrast ratio below ` +
    `${String(CONTRAST_FLOOR)}:1 is marked: that is the WCAG 2.1 floor for non-text ` +
    `graphical objects.</p></section>`
  );
}


/* ------------------------------------------------------------------ *
 * Methodology, remediation and the colour table
 *
 * The app's panel shows a reader what is wrong with their map. This report is
 * where the working is kept: what was measured, with which metric, against
 * which threshold, and what every number came out at. Anything stripped out of
 * the panel for being jargon has to be here, or it is simply gone.
 * ------------------------------------------------------------------ */

/** How the audit was carried out, in enough detail to be checked or repeated. */
function methodologySection(resolved: ResolvedOptions): string {
  const modes = resolved.modes
    .map((mode) => escapeHtml(VISION_MODE_LABELS[mode]))
    .join(', ');
  return (
    `<section id="methodology"><h2>Methodology</h2>` +
    `<dl class="method">` +
    `<dt>Colour difference</dt><dd>CIEDE2000 (ΔE<sub>00</sub>), the CIE 2000 ` +
    `colour-difference formula, computed in CIELAB under a D65 white point. ` +
    `Below about 1 ΔE<sub>00</sub> two colours are indistinguishable side by side.</dd>` +
    `<dt>Clash threshold</dt><dd>A pair is reported as a clash when ` +
    `ΔE<sub>00</sub> &lt; ${String(resolved.threshold)}. That is far above the ` +
    `just-noticeable difference on purpose: map classes are read at a glance, in ` +
    `small patches, against varying surroundings, not compared side by side.</dd>` +
    `<dt>Contrast</dt><dd>WCAG 2.1 relative-luminance contrast ratio, 1:1 to 21:1 ` +
    `(<a href="https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio">W3C WCAG 2.1, ` +
    `contrast ratio</a>). A ratio below 3:1 is reported as failing: that is the ` +
    `WCAG 2.1 floor for non-text graphical objects ` +
    `(<a href="https://www.w3.org/TR/WCAG21/#non-text-contrast">SC 1.4.11 Non-text ` +
    `Contrast</a>, Level AA).</dd>` +
    `<dt>Colour vision deficiency</dt><dd>Simulated with the matrices of Machado, ` +
    `Oliveira and Fernandes (2009), <em>A Physiologically-based Model for Simulation ` +
    `of Color Vision Deficiency</em>, IEEE Transactions on Visualization and Computer ` +
    `Graphics 15(6), at full severity (1.0). Applied in linear light through the ` +
    `sRGB transfer function.</dd>` +
    `<dt>Compositing</dt><dd>Every class is flattened onto the map background ` +
    `(<code>${rgbToHex(resolved.background)}</code>) at its own opacity before ` +
    `being measured, so a translucent class is judged as it lands rather than as ` +
    `it was written.</dd>` +
    `<dt>Modes audited</dt><dd>${modes}</dd>` +
    `</dl></section>`
  );
}

/** What the repalette did, and what it could not do. */
function remediationSection(data: ReportData): string {
  const { remediation } = data;
  if (remediation === undefined || remediation.length === 0) {
    return '';
  }

  const before = summariseAudit(data.classes, data.audit).clashes;
  const after =
    data.remediatedAudit === undefined
      ? undefined
      : summariseAudit(data.classes, data.remediatedAudit).clashes;
  const moved = remediation.filter(
    (entry) => rgbToHex(entry.original) !== rgbToHex(entry.remediated),
  ).length;

  const figures =
    after === undefined
      ? `<p>${formatCount(moved)} of ${formatCount(remediation.length)} colours were changed.</p>`
      : `<p class="figures">` +
        `<span class="figure"><span class="figure-n">${formatCount(before)}</span>` +
        `<span class="figure-l">clashes before</span></span>` +
        `<span class="figure"><span class="figure-n">${formatCount(after)}</span>` +
        `<span class="figure-l">clashes after</span></span>` +
        `<span class="figure"><span class="figure-n">${formatCount(Math.max(0, before - after))}</span>` +
        `<span class="figure-l">clashes resolved</span></span>` +
        `<span class="figure"><span class="figure-n">${formatCount(moved)}</span>` +
        `<span class="figure-l">colours changed</span></span>` +
        `</p>`;

  return (
    `<section id="remediation"><h2>Remediation</h2>${figures}` +
    `<h3>How the palette was built</h3>` +
    `<p>Dichromacy takes away hue discrimination and leaves lightness very nearly ` +
    `intact. The repair therefore stops the palette relying on hue: the classes are ` +
    `ranked by their original lightness and handed evenly spaced slots through an ` +
    `L* band of ${String(REMEDIATION_LIGHTNESS.min)}–${String(REMEDIATION_LIGHTNESS.max)}, ` +
    `which keeps the light-to-dark ordering the author chose. Hues are then rotated, ` +
    `a class at a time, while a trial audit after each move keeps whichever palette ` +
    `scores best.</p>` +
    `<h3>Why it does not reach zero</h3>` +
    `<p>Even spacing across a 60 L* band gives adjacent classes 60/(n−1) L* of ` +
    `separation, and CIEDE2000 between two colours of similar hue is close to their ` +
    `lightness difference. A palette of more than about twelve classes therefore ` +
    `cannot put every pair ${String(resolveOptions(data.options).threshold)} ΔE` +
    `<sub>00</sub> apart however the hues are arranged — the ceiling is arithmetic, ` +
    `not a shortcoming of the search. Past that point a map needs texture, labels, ` +
    `direct annotation or fewer classes; colour alone will not carry it, and this ` +
    `report says how far colour got.</p></section>`
  );
}

/** Every class with the numbers behind its swatch. */
function colourTableSection(classes: readonly MapClass[], background: RGB): string {
  if (classes.length === 0) {
    return '';
  }
  const rows = classes
    .map((cls) => {
      const flat = flatten(cls, background);
      const [r, g, b] = flat;
      const lab = rgbToLab(flat);
      return (
        `<tr>` +
        `<td>${swatch(flat, humaniseClassId(cls))}</td>` +
        `<td><code>${escapeHtml(cls.id)}</code></td>` +
        `<td>${escapeHtml(cls.type)}</td>` +
        `<td class="num">${String(Math.round(cls.opacity * 100))}%</td>` +
        `<td class="num"><code>${rgbToHex(cls.color)}</code></td>` +
        `<td class="num"><code>${rgbToHex(flat)}</code></td>` +
        `<td class="num">${String(Math.round(r * 255))}, ${String(Math.round(g * 255))}, ${String(Math.round(b * 255))}</td>` +
        `<td class="num">${lab.L.toFixed(1)}, ${lab.a.toFixed(1)}, ${lab.b.toFixed(1)}</td>` +
        `</tr>`
      );
    })
    .join('');

  return (
    `<section id="colour-table"><h2>Colour table ` +
    `<span class="count">${formatCount(classes.length)}</span></h2>` +
    `<p class="note">As authored, as composited onto the background, and in CIELAB — ` +
    `the space the distances are measured in.</p>` +
    `<table><thead><tr>` +
    `<th>Colour</th><th>Class id</th><th>Type</th><th class="num">Opacity</th>` +
    `<th class="num">Authored</th><th class="num">Composited</th>` +
    `<th class="num">sRGB 0–255</th><th class="num">L*, a*, b*</th>` +
    `</tr></thead><tbody>${rows}</tbody></table></section>`
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
h3 { font-size: 13px; margin: 16px 0 6px; color: var(--ink-2); }
section p { font-size: 14px; color: var(--ink-2); margin: 0 0 10px; max-width: 74ch; }
section p:last-child { margin-bottom: 0; }
section a { color: #1a56a8; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }
td.bad-cell { color: var(--bad); font-weight: 600; }
td.muted { color: var(--ink-3); }

/* ---- methodology: a definition list reads better than prose here ---- */
.method { margin: 0; display: grid; grid-template-columns: 180px 1fr; gap: 8px 18px; }
.method dt { font-size: 13px; font-weight: 600; color: var(--ink); }
.method dd { margin: 0; font-size: 13px; color: var(--ink-2); max-width: 74ch; }
@media (max-width: 620px) {
  .method { grid-template-columns: 1fr; gap: 2px; }
  .method dd { margin-bottom: 10px; }
}

/* ---- before-and-after figures ---- */
.figures { display: flex; flex-wrap: wrap; gap: 10px; margin: 0 0 14px; }
.figure {
  flex: 1 1 130px; display: flex; flex-direction: column; gap: 2px;
  border: 1px solid var(--line); border-radius: var(--radius); padding: 10px 12px;
}
.figure-n { font-size: 22px; font-weight: 600; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
.figure-l { font-size: 12px; color: var(--ink-3); }

@media (max-width: 620px) {
  table, thead, tbody, tr, th, td { display: block; }
  thead { display: none; }
  tbody tr { border-bottom: 1px solid var(--line); padding: 8px 0; }
  th, td { border: 0; padding: 3px 0; }
  td.num, th.num { text-align: left; }
}

/* ---- paper ---- */
@media print {
  body { background: #fff; padding: 0; font-size: 11pt; }
  .controls, .vision-toggle { display: none; }
  .report { max-width: none; }
  section {
    border: 1px solid #ccc; break-inside: avoid; page-break-inside: avoid;
    margin-bottom: 10px;
  }
  tr { break-inside: avoid; page-break-inside: avoid; }
  h2 { break-after: avoid; page-break-after: avoid; }
  a { color: inherit; text-decoration: none; }
  a[href^="http"]::after { content: " (" attr(href) ")"; font-size: 9pt; color: #555; }
  /* Swatches are the whole point of this document; keep the ink. */
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
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
<p class="meta">${escapeHtml(TOOL_NAME)} ${escapeHtml(data.toolVersion ?? TOOL_VERSION)} · ${formatCount(data.classes.length)} map ${data.classes.length === 1 ? 'colour' : 'colours'} audited</p>
</header>
${verdictSection(data)}
${clashSection(data, resolved)}
${modeSection(data.audit, resolved)}
${remediationSection(data)}
${colourSection(data.classes, resolved.background)}
${methodologySection(resolved)}
${technicalSection(data, resolved)}
${colourTableSection(data.classes, resolved.background)}
</main>
<footer>
${escapeHtml(ABOUT_TEXT)}
Dichromacy simulation follows Machado, Oliveira and Fernandes (2009) at full severity.
Generated by ${escapeHtml(TOOL_NAME)} ${escapeHtml(data.toolVersion ?? TOOL_VERSION)}.
</footer>
</body>
</html>
`;
}
