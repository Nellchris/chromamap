/**
 * The `carto-a11y audit` subcommand: style file in, report out.
 */

import {
  DEFAULT_THRESHOLD,
  TOOL_NAME,
  VISION_MODES,
  extractClasses,
  generateHtmlReport,
  generateJsonReport,
  parseColor,
  runAudit,
  type AuditPair,
  type AuditResult,
  type MapClass,
  type RGB,
  type ReportData,
  type VisionMode,
} from '@carto-a11y/core';

import type { CliIo, CliResult } from './types.js';

/** Exit codes: 0 clean, 1 findings, 2 the command could not be run. */
const EXIT_CLEAN = 0;
const EXIT_FINDINGS = 1;
const EXIT_USAGE = 2;

/** Output shapes `--format` accepts. */
const FORMATS = ['summary', 'json', 'html'] as const;
type Format = (typeof FORMATS)[number];

/** How a mode is named in the summary output. */
const MODE_NAMES: Record<VisionMode, string> = {
  normal: 'normal',
  protan: 'protan',
  deutan: 'deutan',
  tritan: 'tritan',
};

interface AuditFlags {
  readonly stylePath: string;
  readonly format: Format;
  readonly output: string | undefined;
  readonly threshold: number;
  readonly background: RGB;
  readonly modes: VisionMode[];
}

type ParseResult =
  | { readonly ok: true; readonly flags: AuditFlags }
  | { readonly ok: false; readonly message: string };

function fail(message: string): ParseResult {
  return { ok: false, message };
}

function isFormat(value: string): value is Format {
  return (FORMATS as readonly string[]).includes(value);
}

function isVisionMode(value: string): value is VisionMode {
  return (VISION_MODES as readonly string[]).includes(value);
}

/**
 * Parse `audit` arguments.
 *
 * Accepts `--flag value` and `--flag=value`, and exactly one positional path.
 * Anything unexpected is an error rather than a silently ignored argument.
 */
export function parseAuditArgs(args: readonly string[]): ParseResult {
  let stylePath: string | undefined;
  let format: Format = 'summary';
  let output: string | undefined;
  let threshold: number = DEFAULT_THRESHOLD;
  let background: RGB = [1, 1, 1];
  let modes: VisionMode[] = [...VISION_MODES];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) {
      continue;
    }

    if (!arg.startsWith('--')) {
      if (stylePath !== undefined) {
        return fail(`unexpected argument: ${arg}`);
      }
      stylePath = arg;
      continue;
    }

    const equals = arg.indexOf('=');
    const name = equals === -1 ? arg : arg.slice(0, equals);
    let value: string | undefined;
    if (equals === -1) {
      value = args[index + 1];
      if (value !== undefined && !value.startsWith('--')) {
        index += 1;
      } else {
        value = undefined;
      }
    } else {
      value = arg.slice(equals + 1);
    }

    switch (name) {
      case '--format': {
        if (value === undefined) {
          return fail(`--format needs a value (${FORMATS.join(', ')})`);
        }
        if (!isFormat(value)) {
          return fail(`unknown format: ${value} (expected ${FORMATS.join(', ')})`);
        }
        format = value;
        break;
      }
      case '--output': {
        if (value === undefined || value === '') {
          return fail('--output needs a file path');
        }
        output = value;
        break;
      }
      case '--threshold': {
        if (value === undefined) {
          return fail('--threshold needs a number');
        }
        const parsed = Number(value);
        if (value.trim() === '' || !Number.isFinite(parsed) || parsed < 0) {
          return fail(`--threshold must be a number of 0 or more, got: ${value}`);
        }
        threshold = parsed;
        break;
      }
      case '--background': {
        if (value === undefined) {
          return fail('--background needs a colour');
        }
        try {
          background = parseColor(value);
        } catch (error) {
          return fail(error instanceof Error ? error.message : String(error));
        }
        break;
      }
      case '--modes': {
        if (value === undefined) {
          return fail(`--modes needs a comma-separated list (${VISION_MODES.join(', ')})`);
        }
        const requested = value
          .split(',')
          .map((mode) => mode.trim())
          .filter((mode) => mode !== '');
        if (requested.length === 0) {
          return fail('--modes needs at least one mode');
        }
        const unknown = requested.filter((mode) => !isVisionMode(mode));
        if (unknown.length > 0) {
          return fail(
            `unknown vision mode: ${unknown.join(', ')} (expected ${VISION_MODES.join(', ')})`,
          );
        }
        modes = [...new Set(requested.filter(isVisionMode))];
        break;
      }
      default:
        return fail(`unknown option: ${name}`);
    }
  }

  if (stylePath === undefined) {
    return fail('audit needs a path to a style file');
  }

  return { ok: true, flags: { stylePath, format, output, threshold, background, modes } };
}

/** `a ↔ b`, the way a pair is named in the summary. */
function pairName(pair: AuditPair): string {
  return `${pair.classA.id} ↔ ${pair.classB.id}`;
}

/** How many distinct class pairs fail in at least one mode. */
function failingClassPairs(audit: AuditResult): number {
  return new Set(audit.failing.map(pairName)).size;
}

function plural(count: number, singular: string, pluralForm: string): string {
  return count === 1 ? singular : pluralForm;
}

/**
 * Render the human-readable summary.
 *
 * Pass and fail counts are per *class pair* - a pair fails if it fails under
 * any mode - while the failing list shows one line per mode, since that is
 * what tells you which readers are affected.
 */
export function renderSummary(data: ReportData, threshold: number): string {
  const { audit, classes } = data;
  const classPairs = (classes.length * (classes.length - 1)) / 2;
  const failing = failingClassPairs(audit);
  const passing = classPairs - failing;
  const modeCount = data.options.modes?.length ?? VISION_MODES.length;

  const lines: string[] = [
    `${TOOL_NAME} Audit`,
    `Source: ${data.styleSource}`,
    '',
    `Classes found: ${String(classes.length)}`,
    `Pairs analysed: ${String(audit.summary.total)} (across ${String(modeCount)} vision ${plural(modeCount, 'mode', 'modes')})`,
    '',
    `✓ ${String(passing)} ${plural(passing, 'pair passes', 'pairs pass')} (dE ≥ ${String(threshold)} in all modes)`,
    `✗ ${String(failing)} ${plural(failing, 'pair FAILS', 'pairs FAIL')}`,
  ];

  if (audit.failing.length > 0) {
    const sorted = audit.failing.slice().sort((a, b) => a.dE - b.dE);
    const width = Math.max(...sorted.map((pair) => pairName(pair).length));
    lines.push('', 'Failing pairs:');
    for (const pair of sorted) {
      lines.push(
        `  ${pairName(pair).padEnd(width)}  ${MODE_NAMES[pair.mode].padEnd(6)}  ` +
          `dE=${pair.dE.toFixed(2)}  contrast=${pair.contrast.toFixed(2)}:1`,
      );
    }
    const worst = sorted[0];
    if (worst !== undefined) {
      lines.push(
        '',
        `Worst pair: ${pairName(worst)} (dE=${worst.dE.toFixed(2)} under ${MODE_NAMES[worst.mode]})`,
      );
    }
  }

  return `${lines.join('\n')}\n`;
}

/**
 * Run the `audit` subcommand.
 *
 * @param args - Everything after `audit`.
 * @param io - Filesystem access; without it the command cannot read a style.
 * @returns Output plus an exit code: 0 when nothing fails, 1 when a pair is
 *   confusable, 2 when the command itself could not run.
 */
export function runAuditCommand(args: readonly string[], io?: CliIo): CliResult {
  const parsed = parseAuditArgs(args);
  if (!parsed.ok) {
    return { output: `error: ${parsed.message}\n`, exitCode: EXIT_USAGE };
  }
  const flags = parsed.flags;

  if (io === undefined) {
    return {
      output: 'error: no filesystem access available in this environment\n',
      exitCode: EXIT_USAGE,
    };
  }

  let source: string;
  try {
    source = io.readTextFile(flags.stylePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { output: `error: cannot read ${flags.stylePath}: ${message}\n`, exitCode: EXIT_USAGE };
  }

  let style: unknown;
  try {
    style = JSON.parse(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      output: `error: ${flags.stylePath} is not valid JSON: ${message}\n`,
      exitCode: EXIT_USAGE,
    };
  }

  const classes: MapClass[] = extractClasses(style);
  const options = {
    background: flags.background,
    threshold: flags.threshold,
    modes: flags.modes,
  };
  const audit = runAudit(classes, options);

  const data: ReportData = {
    timestamp: new Date().toISOString(),
    styleSource: flags.stylePath,
    classes,
    audit,
    options,
  };

  const rendered =
    flags.format === 'json'
      ? `${generateJsonReport(data)}\n`
      : flags.format === 'html'
        ? generateHtmlReport(data)
        : renderSummary(data, flags.threshold);

  const exitCode = audit.failing.length > 0 ? EXIT_FINDINGS : EXIT_CLEAN;

  if (flags.output !== undefined) {
    try {
      io.writeTextFile(flags.output, rendered);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { output: `error: cannot write ${flags.output}: ${message}\n`, exitCode: EXIT_USAGE };
    }
    return { output: `${flags.output}\n`, exitCode };
  }

  return { output: rendered, exitCode };
}
