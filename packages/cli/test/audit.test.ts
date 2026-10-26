import { describe, expect, it } from 'vitest';

import { run } from '../src/index.js';
import type { CliIo } from '../src/types.js';

import fixture from './fixtures/test-style.json';

const STYLE_PATH = 'test-style.json';
const FIXTURE_JSON = JSON.stringify(fixture, null, 2);

/** A style where nothing is confusable in any mode. */
const CLEAN_STYLE = JSON.stringify({
  version: 8,
  layers: [
    { id: 'ink', type: 'fill', paint: { 'fill-color': '#000000' } },
    { id: 'paper', type: 'fill', paint: { 'fill-color': '#ffffff' } },
  ],
});

/** An in-memory filesystem, so the tests never touch a real one. */
function memoryIo(files: Record<string, string> = { [STYLE_PATH]: FIXTURE_JSON }): {
  io: CliIo;
  written: Map<string, string>;
} {
  const written = new Map<string, string>();
  return {
    written,
    io: {
      readTextFile(path: string): string {
        const content = files[path];
        if (content === undefined) {
          throw new Error(`ENOENT: no such file or directory, open '${path}'`);
        }
        return content;
      },
      writeTextFile(path: string, contents: string): void {
        written.set(path, contents);
      },
    },
  };
}

describe('audit: the fixture style', () => {
  it('extracts four classes and skips the hidden layer', () => {
    const { io } = memoryIo();
    const result = run(['audit', STYLE_PATH, '--format', 'json'], io);
    const parsed = JSON.parse(result.output) as {
      classes: { id: string; opacity: number }[];
    };
    expect(parsed.classes.map((cls) => cls.id)).toEqual([
      'water',
      'parks',
      'industrial',
      'buildings',
    ]);
    expect(parsed.classes.find((cls) => cls.id === 'buildings')?.opacity).toBe(0.5);
  });

  it('prints the summary, with the protan failure flagged', () => {
    const { io } = memoryIo();
    const result = run(['audit', STYLE_PATH], io);
    expect(result.output).toBe(
      [
        'CartoAccessibility Audit',
        `Source: ${STYLE_PATH}`,
        '',
        'Classes found: 4',
        'Pairs analysed: 24 (across 4 vision modes)',
        '',
        '✓ 5 pairs pass (dE ≥ 10 in all modes)',
        '✗ 1 pair FAILS',
        '',
        'Failing pairs:',
        '  parks ↔ industrial  protan  dE=0.19  contrast=1.01:1',
        '',
        'Worst pair: parks ↔ industrial (dE=0.19 under protan)',
        '',
      ].join('\n'),
    );
  });

  it('exits 1 when a pair is confusable', () => {
    const { io } = memoryIo();
    expect(run(['audit', STYLE_PATH], io).exitCode).toBe(1);
  });
});

describe('audit: json format', () => {
  it('parses into the report structure', () => {
    const { io } = memoryIo();
    const result = run(['audit', STYLE_PATH, '--format', 'json'], io);
    const parsed = JSON.parse(result.output) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual([
      'clashes',
      'classes',
      'options',
      'styleSource',
      'summary',
      'timestamp',
    ]);
    expect(parsed['styleSource']).toBe(STYLE_PATH);
  });

  it('timestamps the run with a parseable ISO string', () => {
    const { io } = memoryIo();
    const parsed = JSON.parse(
      run(['audit', STYLE_PATH, '--format', 'json'], io).output,
    ) as { timestamp: string };
    expect(Number.isNaN(Date.parse(parsed.timestamp))).toBe(false);
    expect(parsed.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('records the options the audit ran under', () => {
    const { io } = memoryIo();
    const parsed = JSON.parse(
      run(
        ['audit', STYLE_PATH, '--format', 'json', '--threshold', '25', '--modes', 'protan'],
        io,
      ).output,
    ) as { options: { threshold: number; modes: string[]; background: number[] } };
    expect(parsed.options.threshold).toBe(25);
    expect(parsed.options.modes).toEqual(['protan']);
    expect(parsed.options.background).toEqual([1, 1, 1]);
  });

  it('reports the same verdict as the summary', () => {
    const { io } = memoryIo();
    const parsed = JSON.parse(
      run(['audit', STYLE_PATH, '--format', 'json'], io).output,
    ) as { summary: { total: number; failing: number }; clashes: unknown[] };
    expect(parsed.summary.total).toBe(24);
    expect(parsed.summary.failing).toBe(1);
    expect(parsed.clashes).toHaveLength(1);
  });
});

describe('audit: html format', () => {
  const { io } = memoryIo();
  const html = run(['audit', STYLE_PATH, '--format', 'html'], io).output;

  it('is a self-contained document', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('</html>');
    expect(html).not.toContain('<script');
    expect(html).not.toMatch(/https?:\/\//);
  });

  it('contains the audit findings', () => {
    expect(html).toContain('Map accessibility audit');
    expect(html).toContain('Colour clashes');
    // Layer ids are tidied for display: `parks` reads as "Parks".
    expect(html).toContain('“Parks” and “Industrial” look the same to red-blind viewers');
    expect(html).toContain('Red-Blind (Protanopia)');
    expect(html).toContain('#6d5f00');
  });

  it('leads with a plain-language verdict', () => {
    // The fixture has exactly one clash, so the headline is singular.
    expect(html).toContain('1 colour clash found');
    expect(html).toMatch(/\d+ of \d+ map colours become confusable/);
    expect(html).toContain('Worst problems:');
    expect(html.indexOf('class="verdict')).toBeLessThan(html.indexOf('Technical details'));
  });

  it('contains a swatch for every class', () => {
    for (const hex of ['#aad3df', '#006a00', '#ff0000', '#c5b9aa']) {
      expect(html, hex).toContain(`style="background:${hex}"`);
    }
  });

  it('contains the vision-mode preview filters', () => {
    expect(html).toContain('feColorMatrix');
    expect(html).toContain('id="cvd-protan"');
  });
});

describe('audit: --output', () => {
  it('writes the report and prints the path', () => {
    const { io, written } = memoryIo();
    const result = run(['audit', STYLE_PATH, '--format', 'html', '--output', 'out.html'], io);
    expect(result.output).toBe('out.html\n');
    expect(written.get('out.html')?.startsWith('<!doctype html>')).toBe(true);
  });

  it('keeps the findings exit code when writing to a file', () => {
    const { io } = memoryIo();
    expect(run(['audit', STYLE_PATH, '--output', 'out.txt'], io).exitCode).toBe(1);
  });

  it('writes json just as happily', () => {
    const { io, written } = memoryIo();
    run(['audit', STYLE_PATH, '--format', 'json', '--output', 'out.json'], io);
    const parsed: unknown = JSON.parse(written.get('out.json') ?? '');
    expect(parsed).toHaveProperty('clashes');
  });

  it('reports a write failure without pretending it worked', () => {
    const { io } = memoryIo();
    const failing: CliIo = {
      readTextFile: io.readTextFile.bind(io),
      writeTextFile() {
        throw new Error('EACCES: permission denied');
      },
    };
    const result = run(['audit', STYLE_PATH, '--output', '/root/out.html'], failing);
    expect(result.exitCode).toBe(2);
    expect(result.output).toMatch(/cannot write \/root\/out\.html: EACCES/);
  });
});

describe('audit: --threshold', () => {
  it('finds nothing when the threshold is 0', () => {
    const { io } = memoryIo();
    const result = run(['audit', STYLE_PATH, '--threshold', '0'], io);
    expect(result.output).toContain('✗ 0 pairs FAIL');
    expect(result.output).not.toContain('Failing pairs:');
    expect(result.exitCode).toBe(0);
  });

  it('finds more as the threshold rises', () => {
    const { io } = memoryIo();
    const lenient = run(['audit', STYLE_PATH, '--threshold', '10'], io);
    const strict = run(['audit', STYLE_PATH, '--threshold', '30'], io);
    expect(lenient.output).toContain('✗ 1 pair FAILS');
    expect(strict.output).toContain('✗ 3 pairs FAIL');
    expect(strict.output).toContain('dE ≥ 30 in all modes');
    expect(strict.exitCode).toBe(1);
  });

  it('accepts --threshold=value as well', () => {
    const { io } = memoryIo();
    expect(run(['audit', STYLE_PATH, '--threshold=30'], io).output).toContain(
      '✗ 3 pairs FAIL',
    );
  });
});

describe('audit: --modes and --background', () => {
  it('audits only the requested modes', () => {
    const { io } = memoryIo();
    const result = run(['audit', STYLE_PATH, '--modes', 'normal,tritan'], io);
    expect(result.output).toContain('Pairs analysed: 12 (across 2 vision modes)');
    expect(result.output).toContain('✗ 0 pairs FAIL');
    expect(result.exitCode).toBe(0);
  });

  it('still catches the failure when protan is among them', () => {
    const { io } = memoryIo();
    const result = run(['audit', STYLE_PATH, '--modes', 'protan'], io);
    expect(result.output).toContain('Pairs analysed: 6 (across 1 vision mode)');
    expect(result.output).toContain('✗ 1 pair FAILS');
  });

  it('composites over the given background', () => {
    const { io } = memoryIo();
    const parsed = JSON.parse(
      run(['audit', STYLE_PATH, '--format', 'json', '--background', 'black'], io).output,
    ) as { options: { background: number[] } };
    expect(parsed.options.background).toEqual([0, 0, 0]);
  });

  it('accepts a named background colour', () => {
    const { io } = memoryIo();
    expect(run(['audit', STYLE_PATH, '--background', 'ivory'], io).exitCode).toBe(1);
  });
});

describe('audit: a style with nothing wrong', () => {
  const files = { 'clean.json': CLEAN_STYLE };

  it('passes every pair and exits 0', () => {
    const { io } = memoryIo(files);
    const result = run(['audit', 'clean.json'], io);
    expect(result.output).toContain('Classes found: 2');
    expect(result.output).toContain('✓ 1 pair passes (dE ≥ 10 in all modes)');
    expect(result.output).toContain('✗ 0 pairs FAIL');
    expect(result.output).not.toContain('Worst pair');
    expect(result.exitCode).toBe(0);
  });

  it('says so in the HTML report too', () => {
    const { io } = memoryIo(files);
    const html = run(['audit', 'clean.json', '--format', 'html'], io).output;
    expect(html).toContain('No colour clashes found');
    expect(html).toContain('verdict verdict-accessible');
    expect(html).toContain('Every pair of map colours stays apart');
  });
});

describe('audit: errors', () => {
  it('needs a style path', () => {
    const { io } = memoryIo();
    const result = run(['audit'], io);
    expect(result.exitCode).toBe(2);
    expect(result.output).toMatch(/needs a path to a style file/);
  });

  it('reports a missing file', () => {
    const { io } = memoryIo();
    const result = run(['audit', 'nope.json'], io);
    expect(result.exitCode).toBe(2);
    expect(result.output).toMatch(/cannot read nope\.json: ENOENT/);
  });

  it('reports invalid JSON', () => {
    const { io } = memoryIo({ 'bad.json': 'not json at all' });
    const result = run(['audit', 'bad.json'], io);
    expect(result.exitCode).toBe(2);
    expect(result.output).toMatch(/bad\.json is not valid JSON/);
  });

  it('rejects an unknown format, mode, option or extra argument', () => {
    const { io } = memoryIo();
    const cases: ReadonlyArray<readonly [readonly string[], RegExp]> = [
      [['audit', STYLE_PATH, '--format', 'xml'], /unknown format: xml/],
      [['audit', STYLE_PATH, '--modes', 'nope'], /unknown vision mode: nope/],
      [['audit', STYLE_PATH, '--bogus', '1'], /unknown option: --bogus/],
      [['audit', STYLE_PATH, 'extra.json'], /unexpected argument: extra\.json/],
      [['audit', STYLE_PATH, '--threshold', 'abc'], /--threshold must be a number/],
      [['audit', STYLE_PATH, '--threshold', '-1'], /--threshold must be a number/],
      [['audit', STYLE_PATH, '--background', 'notacolour'], /cannot parse colour/],
      [['audit', STYLE_PATH, '--format'], /--format needs a value/],
      [['audit', STYLE_PATH, '--modes', ''], /--modes needs at least one mode/],
    ];
    for (const [argv, pattern] of cases) {
      const result = run(argv, io);
      expect(result.exitCode, argv.join(' ')).toBe(2);
      expect(result.output, argv.join(' ')).toMatch(pattern);
    }
  });

  it('explains itself when no filesystem is available', () => {
    const result = run(['audit', STYLE_PATH]);
    expect(result.exitCode).toBe(2);
    expect(result.output).toMatch(/no filesystem access/);
  });
});

describe('audit: usage', () => {
  it('appears in the help text with its options', () => {
    const usage = run(['--help']).output;
    expect(usage).toContain('carto-a11y audit <style.json>');
    expect(usage).toContain('--format');
    expect(usage).toContain('--threshold');
    expect(usage).toContain('--background');
    expect(usage).toContain('--modes');
    expect(usage).toContain('Exit codes:');
  });
});
