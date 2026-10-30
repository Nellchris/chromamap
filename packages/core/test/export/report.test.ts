import { describe, expect, it } from 'vitest';

import { runAudit, type AuditOptions } from '../../src/audit/engine.js';
import { parseColor } from '../../src/color/parse.js';
import { TOOL_VERSION } from '../../src/export/language.js';
import { generateAccessiblePalette } from '../../src/remediate/palette.js';
import {
  generateHtmlReport,
  generateJsonReport,
  type JsonReport,
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

/** Enough identical fills to land in the red band: eleven make 55 clashes. */
const TROUBLE = Array.from({ length: 11 }, (_, index) => fill(`c${String(index)}`, '#336699'));

describe('generateJsonReport', () => {
  it('parses back into the documented structure', () => {
    const parsed = JSON.parse(generateJsonReport(report(CONFUSABLE))) as JsonReport;
    expect(Object.keys(parsed).sort()).toEqual([
      'clashes',
      'classes',
      'options',
      'styleSource',
      'summary',
      'timestamp',
    ]);
    expect(Array.isArray(parsed.classes)).toBe(true);
    expect(Array.isArray(parsed.clashes)).toBe(true);
  });

  it('names classes once and refers to them by id', () => {
    const parsed = JSON.parse(generateJsonReport(report(CONFUSABLE))) as JsonReport;
    const ids = new Set(parsed.classes.map((cls) => cls.id));
    expect(ids).toEqual(new Set(['roads', 'parks']));
    for (const clash of parsed.clashes) {
      expect(typeof clash.classA).toBe('string');
      expect(ids.has(clash.classA)).toBe(true);
      expect(ids.has(clash.classB)).toBe(true);
    }
  });

  it('lists the failures, not every judgement', () => {
    // A hundred-class map makes 19,800 judgements; writing the passing ones
    // out makes a file nobody can read and git cannot diff.
    const data = report(CONFUSABLE);
    const parsed = JSON.parse(generateJsonReport(data)) as JsonReport;
    expect(parsed.summary.total).toBe(4);
    expect(parsed.clashes).toHaveLength(data.audit.failing.length);
    expect(parsed.clashes).toHaveLength(1);
  });

  it('sorts the clashes closest first', () => {
    const parsed = JSON.parse(generateJsonReport(report(TROUBLE))) as JsonReport;
    const distances = parsed.clashes.map((clash) => clash.dE);
    expect(distances).toEqual([...distances].sort((a, b) => a - b));
  });

  it('records the options with their defaults filled in', () => {
    const parsed = JSON.parse(generateJsonReport(report(CONFUSABLE))) as JsonReport;
    expect(parsed.options.threshold).toBe(10);
    expect(parsed.options.background).toEqual([1, 1, 1]);
    expect(parsed.options.modes).toEqual(['normal', 'protan', 'deutan', 'tritan']);
  });

  it('indents with two spaces', () => {
    const lines = generateJsonReport(report(CONFUSABLE)).split('\n');
    expect(lines[0]).toBe('{');
    expect(lines[1]).toMatch(/^ {2}"timestamp":/);
    expect(lines.some((line) => /^ {4}"/.test(line))).toBe(true);
  });

  it('carries the inputs, the verdict and the options', () => {
    const data = report(CONFUSABLE, { threshold: 10, modes: ['normal', 'protan'] });
    const parsed = JSON.parse(generateJsonReport(data)) as JsonReport;
    expect(parsed.timestamp).toBe('2026-10-24T12:00:00.000Z');
    expect(parsed.styleSource).toBe('demo/style.json');
    expect(parsed.classes.map((cls) => cls.id)).toEqual(['roads', 'parks']);
    expect(parsed.summary.total).toBe(2);
    expect(parsed.clashes).toHaveLength(1);
    expect(parsed.clashes[0]?.mode).toBe('protan');
    expect(parsed.options.threshold).toBe(10);
    expect(parsed.options.modes).toEqual(['normal', 'protan']);
  });

  it('keeps colours as sRGB triples', () => {
    const parsed = JSON.parse(generateJsonReport(report(CONFUSABLE))) as JsonReport;
    expect(parsed.classes[0]?.color).toEqual([1, 0, 0]);
  });

  it('produces a clean report when nothing fails', () => {
    const parsed = JSON.parse(generateJsonReport(report(CLEAN))) as JsonReport;
    expect(parsed.clashes).toEqual([]);
    expect(parsed.summary.failing).toBe(0);
    expect(parsed.summary.byMode).toEqual({
      normal: 0,
      protan: 0,
      deutan: 0,
      tritan: 0,
    });
  });

  it('handles an empty class list', () => {
    const parsed = JSON.parse(generateJsonReport(report([]))) as JsonReport;
    expect(parsed.classes).toEqual([]);
    expect(parsed.clashes).toEqual([]);
    expect(parsed.summary.total).toBe(0);
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
    expect(html).not.toContain('<link');
    expect(html).not.toMatch(/src=/);
    expect(html).not.toContain('@import');
    expect(html).not.toMatch(/url\(\s*['"]?https?:/);
    expect(html).toContain('<style>');
  });

  it('reaches the network only through links a reader may choose to follow', () => {
    // The report cites WCAG, and a citation worth having is one you can click.
    // An href is not a request: nothing is fetched unless the reader asks.
    const urls = html.match(/https?:\/\/[^"'\s<>]+/g) ?? [];
    for (const url of urls) {
      expect(html).toContain(`<a href="${url}">`);
    }
    expect(urls.some((url) => url.includes('w3.org/TR/WCAG21'))).toBe(true);
  });

  it('is titled in plain language', () => {
    expect(html).toContain('<h1>Map accessibility audit</h1>');
    expect(html).toContain('Check if your map colours work for everyone');
  });

  it('names the source and the timestamp', () => {
    expect(html).toContain('demo/style.json');
    expect(html).toContain('2026-10-24T12:00:00.000Z');
  });

  it('says who the tool is for', () => {
    expect(html).toContain('About 8% of men and 0.5% of women are affected.');
  });
});

describe('generateHtmlReport: the verdict', () => {
  it('leads with the verdict, before anything technical', () => {
    const html = generateHtmlReport(report(CONFUSABLE));
    const verdict = html.indexOf('class="verdict');
    const technical = html.indexOf('Technical details');
    const clashes = html.indexOf('Colour clashes');
    expect(verdict).toBeGreaterThan(-1);
    expect(verdict).toBeLessThan(clashes);
    expect(clashes).toBeLessThan(technical);
  });

  it('is amber with a handful of clashes', () => {
    const html = generateHtmlReport(report(CONFUSABLE));
    expect(html).toContain('verdict verdict-some-issues');
    expect(html).toContain('Some issues');
    expect(html).toContain('1 colour clash found');
    expect(html).toContain('2 of 2 map colours become confusable');
    expect(html).toContain('Worst problems: Red-blind viewers (1 clash)');
  });

  it('is green when nothing clashes', () => {
    const html = generateHtmlReport(report(CLEAN));
    expect(html).toContain('verdict verdict-accessible');
    expect(html).toContain('Accessible');
    expect(html).toContain('No colour clashes found');
    expect(html).toContain('🟢');
  });

  it('is red once there are fifty-one clashes or more', () => {
    const html = generateHtmlReport(report(TROUBLE));
    expect(html).toContain('verdict verdict-needs-attention');
    expect(html).toContain('Needs attention');
    expect(html).toContain('55 colour clashes found');
    expect(html).toContain('🔴');
  });
});

describe('generateHtmlReport: plain language', () => {
  const html = generateHtmlReport(report(CONFUSABLE));

  it('names the vision modes in plain words', () => {
    expect(html).toContain('Normal Vision');
    expect(html).toContain('Red-Blind (Protanopia)');
    expect(html).toContain('Green-Blind (Deuteranopia)');
    expect(html).toContain('Blue-Yellow Blind (Tritanopia)');
  });

  it('writes each clash as a sentence', () => {
    expect(html).toContain('“Roads” and “Parks” look the same to red-blind viewers');
  });

  it('calls them colour clashes, not failing pairs', () => {
    expect(html).toContain('Colour clashes');
    expect(html).not.toContain('Confusable pairs');
    expect(html).not.toContain('failing pairs');
  });

  it('calls them map colours, not classes', () => {
    expect(html).toContain('Map colours');
    expect(html).not.toContain('classes extracted');
  });

  it('keeps the numbers out of the plain-language sections', () => {
    const upToTechnical = html.slice(0, html.indexOf('Technical details'));
    expect(upToTechnical).not.toContain('ΔE00');
    expect(upToTechnical).not.toContain('0.19');
    expect(upToTechnical).not.toContain('1.01:1');
  });

  it('shows a clash as authored and as seen', () => {
    expect(html).toContain('as authored → as seen');
    // Under protanopia both colours land on the same olive.
    expect((html.match(/#6d5f00/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});

describe('generateHtmlReport: by vision mode', () => {
  it('counts clashes per mode', () => {
    const html = generateHtmlReport(report(CONFUSABLE));
    expect(html).toContain('Who is affected');
    expect(html).toContain('1 clashing');
    expect(html).toContain('✓ clear');
  });

  it('marks modes that were not checked', () => {
    const html = generateHtmlReport(report(CONFUSABLE, { modes: ['protan'] }));
    expect(html).toContain('not checked');
  });
});

describe('generateHtmlReport: map colours', () => {
  const html = generateHtmlReport(report(CONFUSABLE));

  it('draws a swatch for every colour', () => {
    expect(html).toContain('class="class-colour" style="background:#ff0000"');
    expect(html).toContain('class="class-colour" style="background:#006a00"');
  });

  it('labels every swatch, so identity never rests on colour alone', () => {
    expect(html).toContain('>Roads<');
    expect(html).toContain('>Parks<');
  });

  it('shows the composited colour for a translucent class', () => {
    const translucent = generateHtmlReport(report([fill('haze', '#ff0000', 0.5)]));
    expect(translucent).toContain('style="background:#ff8080"');
    expect(translucent).toContain('50% opacity');
  });

  it('handles a style with no colours at all', () => {
    const empty = generateHtmlReport(report([]));
    expect(empty).toContain('No colours were extracted');
    expect(empty.startsWith('<!doctype html>')).toBe(true);
  });
});

describe('generateHtmlReport: technical details', () => {
  const html = generateHtmlReport(report(CONFUSABLE));

  it('keeps the full table, with the numbers', () => {
    expect(html).toContain('Technical details');
    expect(html).toContain('>0.19</td>');
    expect(html).toContain('>1.01:1</td>');
    expect(html).toContain('ΔE00');
  });

  it('explains what the numbers mean', () => {
    expect(html).toContain('CIEDE2000 threshold of 10 ΔE00');
    expect(html).toContain('WCAG 2.1 ratio');
  });

  it('reports the threshold it ran at', () => {
    expect(generateHtmlReport(report(CONFUSABLE, { threshold: 25 }))).toContain(
      'CIEDE2000 threshold of 25 ΔE00',
    );
  });

  it('says how many checks were made', () => {
    // Two colours make one pair, judged under each of the four modes.
    expect(html).toContain('4 judgements in total');
  });

  it('says plainly when nothing fell below the threshold', () => {
    expect(generateHtmlReport(report(CLEAN))).toContain('No pair fell below the threshold');
  });
});

describe('generateHtmlReport: clean audit', () => {
  const html = generateHtmlReport(report(CLEAN));

  it('says so plainly instead of showing an empty table', () => {
    expect(html).toContain('Every pair of map colours stays apart');
    expect(html).not.toContain('<tbody></tbody>');
    expect(html).not.toContain('class="count count-bad"');
    expect(generateHtmlReport(report(CONFUSABLE))).toContain('class="count count-bad"');
  });

  it('still lists the colours', () => {
    expect(html).toContain('>Ink<');
    expect(html).toContain('>Paper<');
  });
});

describe('generateHtmlReport: preview filters', () => {
  const html = generateHtmlReport(report(CONFUSABLE));

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

describe('generateHtmlReport: escaping', () => {
  it('escapes class ids, so a style cannot inject markup', () => {
    // A match branch keeps its label verbatim, so this is the id shape that
    // carries a hostile string all the way to the page.
    const nasty = [
      fill('layer/<img src=x onerror=alert(1)>', '#ff0000'),
      fill('layer/a "quoted" & ampersand', '#006a00'),
    ];
    const html = generateHtmlReport(report(nasty));
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('&quot;quoted&quot;');
    expect(html).toContain('&amp; ampersand');
  });

  it('escapes an id that would otherwise close a tag', () => {
    const html = generateHtmlReport(report([fill('<script>alert(1)</script>', '#ff0000')]));
    expect(html).not.toContain('<script');
    expect(html).not.toContain('</script>');
  });

  it('escapes a hostile id inside a title attribute', () => {
    const html = generateHtmlReport(report([fill('layer/" onmouseover="alert(1)', '#ff0000')]));
    expect(html).not.toContain('onmouseover="alert(1)"');
    expect(html).toContain('&quot; onmouseover=&quot;alert(1)');
  });

  it('escapes the style source', () => {
    const data = report(CLEAN);
    data.styleSource = '<img src=x onerror=alert(1)>';
    const html = generateHtmlReport(data);
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
  });
});

describe('generateHtmlReport: methodology', () => {
  const html = generateHtmlReport(report(CONFUSABLE));

  it('names the metric and the space it is measured in', () => {
    expect(html).toContain('CIEDE2000');
    expect(html).toContain('CIELAB');
    expect(html).toContain('D65');
  });

  it('states the clash threshold it ran at', () => {
    expect(html).toContain('&lt; 10');
  });

  it('cites WCAG 2.1 for contrast, with the 3:1 floor for non-text', () => {
    expect(html).toContain('WCAG 2.1');
    expect(html).toContain('1.4.11');
    expect(html).toContain('3:1');
    expect(html).toContain('w3.org/TR/WCAG21');
  });

  it('cites the simulation model by author and year', () => {
    expect(html).toContain('Machado');
    expect(html).toContain('2009');
  });

  it('says what the colours were composited over', () => {
    const over = generateHtmlReport(report(CONFUSABLE, { background: [0, 0, 0] }));
    expect(over).toContain('#000000');
  });

  it('lists the modes that were audited', () => {
    const one = generateHtmlReport(report(CONFUSABLE, { modes: ['protan'] }));
    expect(one).toContain('Red-Blind (Protanopia)');
  });
});

describe('generateHtmlReport: remediation', () => {
  const classes = CONFUSABLE;
  const palette = generateAccessiblePalette(classes);
  const fixed = classes.map((cls, index) => ({
    ...cls,
    color: palette[index]?.remediated ?? cls.color,
  }));
  const withFix: ReportData = {
    ...report(classes),
    remediation: palette,
    remediatedAudit: runAudit(fixed),
  };
  const html = generateHtmlReport(withFix);

  it('is left out entirely when no palette was worked out', () => {
    expect(generateHtmlReport(report(classes))).not.toContain('id="remediation"');
  });

  it('reports clashes before and after', () => {
    expect(html).toContain('id="remediation"');
    expect(html).toContain('clashes before');
    expect(html).toContain('clashes after');
    expect(html).toContain('clashes resolved');
  });

  it('describes the algorithm rather than just its output', () => {
    expect(html).toContain('lightness');
    expect(html).toContain('hue');
  });

  it('explains the ceiling a large palette runs into', () => {
    expect(html).toContain('twelve classes');
  });

  it('adds a remediated column to the clash table', () => {
    expect(html).toContain('<th>Remediated</th>');
    expect(html).toContain('remediated');
  });
});

describe('generateHtmlReport: colour table', () => {
  const html = generateHtmlReport(report([fill('roads', '#ff0000', 0.5)]));

  it('gives every class its hex, sRGB and Lab values', () => {
    expect(html).toContain('id="colour-table"');
    expect(html).toContain('L*, a*, b*');
    expect(html).toContain('sRGB 0–255');
    // Authored, then composited over white at half opacity.
    expect(html).toContain('#ff0000');
    expect(html).toContain('#ff8080');
  });

  it('records the opacity a class was composited at', () => {
    expect(html).toContain('50%');
  });
});

describe('generateHtmlReport: provenance and print', () => {
  const html = generateHtmlReport(report(CONFUSABLE));

  it('stamps the tool and version', () => {
    expect(html).toContain('CartoAccessibility Studio');
    expect(html).toContain(TOOL_VERSION);
  });

  it('takes a version from the caller when given one', () => {
    expect(generateHtmlReport({ ...report(CONFUSABLE), toolVersion: '9.9.9' })).toContain('9.9.9');
  });

  it('carries print rules, and keeps the swatches inked', () => {
    expect(html).toContain('@media print');
    expect(html).toContain('print-color-adjust: exact');
  });
});
