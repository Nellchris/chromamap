import { describe, expect, it } from 'vitest';

import { runAudit, type AuditOptions } from '../../src/audit/engine.js';
import { parseColor } from '../../src/color/parse.js';
import {
  generateHtmlReport,
  generateJsonReport,
  type ReportData,
} from '../../src/export/report.js';
import type { MapClass } from '../../src/style/extract.js';

function fill(id: string, color: string, opacity = 1): MapClass {
  return { id, color: parseColor(color), type: 'fill', opacity };
}

/** Build a report over the given classes. */
function report(classes: MapClass[], options: AuditOptions = {}): ReportData {
  return {
    timestamp: '2026-10-24T12:00:00.000Z',
    styleSource: 'demo/style.json',
    classes,
    audit: runAudit(classes, options),
    options,
  };
}

/** The pair that collapses under protanopia; both simulate to #6d5f00. */
const CONFUSABLE = [fill('roads', '#ff0000'), fill('parks', '#006a00')];

/** Nothing here is confusable in any mode. */
const CLEAN = [fill('ink', 'black'), fill('paper', 'white')];

describe('generateJsonReport', () => {
  it('parses back into the same structure', () => {
    const data = report(CONFUSABLE);
    const parsed: unknown = JSON.parse(generateJsonReport(data));
    expect(parsed).toEqual(JSON.parse(JSON.stringify(data)));
  });

  it('indents with two spaces', () => {
    const lines = generateJsonReport(report(CONFUSABLE)).split('\n');
    expect(lines[0]).toBe('{');
    expect(lines[1]).toMatch(/^ {2}"timestamp":/);
    expect(lines.some((line) => /^ {4}"/.test(line))).toBe(true);
  });

  it('carries the inputs, the verdict and the options', () => {
    const data = report(CONFUSABLE, { threshold: 10, modes: ['normal', 'protan'] });
    const parsed = JSON.parse(generateJsonReport(data)) as ReportData;
    expect(parsed.timestamp).toBe('2026-10-24T12:00:00.000Z');
    expect(parsed.styleSource).toBe('demo/style.json');
    expect(parsed.classes.map((cls) => cls.id)).toEqual(['roads', 'parks']);
    expect(parsed.audit.summary.total).toBe(2);
    expect(parsed.audit.failing).toHaveLength(1);
    expect(parsed.audit.failing[0]?.mode).toBe('protan');
    expect(parsed.options.threshold).toBe(10);
    expect(parsed.options.modes).toEqual(['normal', 'protan']);
  });

  it('keeps colours as sRGB triples', () => {
    const parsed = JSON.parse(generateJsonReport(report(CONFUSABLE))) as ReportData;
    expect(parsed.classes[0]?.color).toEqual([1, 0, 0]);
  });

  it('produces a clean report when nothing fails', () => {
    const parsed = JSON.parse(generateJsonReport(report(CLEAN))) as ReportData;
    expect(parsed.audit.failing).toEqual([]);
    expect(parsed.audit.summary.failing).toBe(0);
    expect(parsed.audit.summary.byMode).toEqual({
      normal: 0,
      protan: 0,
      deutan: 0,
      tritan: 0,
    });
  });

  it('handles an empty class list', () => {
    const parsed = JSON.parse(generateJsonReport(report([]))) as ReportData;
    expect(parsed.classes).toEqual([]);
    expect(parsed.audit.pairs).toEqual([]);
  });
});

describe('generateHtmlReport: document', () => {
  const html = generateHtmlReport(report(CONFUSABLE));

  it('is a complete HTML document', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<html lang="en">');
    expect(html.trimEnd().endsWith('</html>')).toBe(true);
    expect(html).toContain('<meta charset="utf-8">');
  });

  it('is self-contained: no external requests and no scripting', () => {
    expect(html).not.toContain('<script');
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toContain('<link');
    expect(html).toContain('<style>');
  });

  it('names the source and the timestamp', () => {
    expect(html).toContain('demo/style.json');
    expect(html).toContain('2026-10-24T12:00:00.000Z');
  });

  it('states the options it ran under', () => {
    const custom = generateHtmlReport(report(CONFUSABLE, { threshold: 25 }));
    expect(custom).toContain('Threshold 25');
    expect(custom).toContain('#ffffff');
  });
});

describe('generateHtmlReport: summary', () => {
  const html = generateHtmlReport(report(CONFUSABLE));

  it('shows the headline counts', () => {
    expect(html).toContain('classes extracted');
    expect(html).toContain('pairs confusable');
    expect(html).toMatch(/<div class="tile-value">2<\/div>/);
  });

  it('breaks failures down by vision mode', () => {
    expect(html).toContain('Protanopia');
    expect(html).toContain('Deuteranopia');
    expect(html).toContain('Tritanopia');
    expect(html).toContain('1 failing');
    expect(html).toContain('✓ clear');
  });

  it('marks modes that were not audited', () => {
    const limited = generateHtmlReport(report(CONFUSABLE, { modes: ['protan'] }));
    expect(limited).toContain('not audited');
  });
});

describe('generateHtmlReport: swatches', () => {
  const html = generateHtmlReport(report(CONFUSABLE));

  it('draws a swatch for every class', () => {
    expect(html).toContain('class="class-colour" style="background:#ff0000"');
    expect(html).toContain('class="class-colour" style="background:#006a00"');
  });

  it('labels every swatch, so identity never rests on colour alone', () => {
    expect(html).toContain('>roads<');
    expect(html).toContain('>parks<');
    expect(html).toContain('#ff0000');
    expect(html).toContain('#006a00');
  });

  it('shows the composited colour for a translucent class', () => {
    const translucent = generateHtmlReport(report([fill('haze', '#ff0000', 0.5)]));
    expect(translucent).toContain('style="background:#ff8080"');
    expect(translucent).toContain('50% opacity');
  });
});

describe('generateHtmlReport: failing pairs', () => {
  const html = generateHtmlReport(report(CONFUSABLE));

  it('tables the failing pair with its ids, mode and numbers', () => {
    expect(html).toContain('Confusable pairs');
    expect(html).toContain('roads');
    expect(html).toContain('parks');
    expect(html).toContain('Protanopia');
    expect(html).toContain('>0.19</td>');
    expect(html).toContain('>1.01:1</td>');
  });

  it('shows both colours as the affected reader sees them', () => {
    // The whole point: under protanopia both land on the same olive.
    const simulated = html.match(/#6d5f00/g) ?? [];
    expect(simulated.length).toBeGreaterThanOrEqual(2);
    expect(html).toContain('class="seen"');
  });

  it('defines an SVG filter for each dichromacy', () => {
    for (const mode of ['protan', 'deutan', 'tritan']) {
      expect(html, mode).toContain(`id="cvd-${mode}"`);
    }
    expect(html).toContain('feColorMatrix');
    expect(html).toContain('color-interpolation-filters="linearRGB"');
  });

  it('offers a preview control for every vision mode', () => {
    for (const mode of ['normal', 'protan', 'deutan', 'tritan']) {
      expect(html, mode).toContain(`id="vision-${mode}"`);
      expect(html, mode).toContain(`for="vision-${mode}"`);
    }
  });
});

describe('generateHtmlReport: clean audit', () => {
  const html = generateHtmlReport(report(CLEAN));

  it('says so plainly instead of showing an empty table', () => {
    expect(html).toContain('Every pair stays at least 10 ΔE apart');
    expect(html).not.toContain('<tbody></tbody>');
    // The red count badge is markup, not just a stylesheet rule.
    expect(html).not.toContain('class="count count-bad"');
    expect(generateHtmlReport(report(CONFUSABLE))).toContain('class="count count-bad"');
  });

  it('still lists the classes', () => {
    expect(html).toContain('>ink<');
    expect(html).toContain('>paper<');
  });

  it('handles a style with no classes at all', () => {
    const empty = generateHtmlReport(report([]));
    expect(empty).toContain('No colours were extracted');
    expect(empty.startsWith('<!doctype html>')).toBe(true);
  });
});

describe('generateHtmlReport: escaping', () => {
  it('escapes class ids, so a style cannot inject markup', () => {
    const nasty = [
      fill('<script>alert(1)</script>', '#ff0000'),
      fill('a "quoted" & <b>bold</b>', '#006a00'),
    ];
    const html = generateHtmlReport(report(nasty));
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&quot;quoted&quot;');
    expect(html).toContain('&amp;');
  });

  it('escapes the style source', () => {
    const data = report(CLEAN);
    data.styleSource = '<img src=x onerror=alert(1)>';
    const html = generateHtmlReport(data);
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
  });
});
