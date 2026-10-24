/**
 * @carto-a11y/cli — argument handling for the `carto-a11y` command.
 *
 * This module stays free of Node globals so it can be unit-tested anywhere;
 * `bin/carto-a11y.js` is the thin shim that wires it to `process` and
 * `node:fs`, passing the latter in as a {@link CliIo}.
 */

import { contrastRatio, parseColor, relativeLuminance } from '@carto-a11y/core';

import { runAuditCommand } from './audit-command.js';
import type { CliIo, CliResult } from './types.js';

export type { CliIo, CliResult } from './types.js';
export { parseAuditArgs, renderSummary, runAuditCommand } from './audit-command.js';

const USAGE = `carto-a11y — web-map accessibility auditing

Usage:
  carto-a11y audit <style.json> [options]   Audit a MapLibre style for confusable classes
  carto-a11y contrast <colour> <colour>     WCAG 2.1 contrast ratio of two colours
  carto-a11y --help                         Show this message

Audit options:
  --format <summary|json|html>  Output shape (default: summary)
  --output <file>               Write to a file instead of stdout
  --threshold <number>          CIEDE2000 distance a pair must reach (default: 10)
  --background <colour>         What the map is drawn on (default: #ffffff)
  --modes <list>                Comma-separated: normal,protan,deutan,tritan (default: all)

Colours may be hex (#abc, #aabbcc), rgb()/rgba(), or any CSS colour name.

Exit codes: 0 nothing confusable, 1 at least one pair fails, 2 the command could not run.
`;

/**
 * Run the CLI over already-sliced arguments (no program name, no flags file).
 *
 * @param argv - Arguments after the program name.
 * @param io - Filesystem access, needed by `audit` only.
 */
export function run(argv: readonly string[], io?: CliIo): CliResult {
  const [command, ...rest] = argv;

  if (command === undefined || command === '--help' || command === '-h') {
    return { output: USAGE, exitCode: 0 };
  }

  if (command === 'audit') {
    return runAuditCommand(rest, io);
  }

  if (command === 'contrast') {
    const [first, second] = rest;
    if (first === undefined || second === undefined) {
      return { output: `error: contrast needs two colours\n\n${USAGE}`, exitCode: 2 };
    }
    try {
      const [r1, g1, b1] = parseColor(first);
      const [r2, g2, b2] = parseColor(second);
      const ratio = contrastRatio(
        relativeLuminance(r1, g1, b1),
        relativeLuminance(r2, g2, b2),
      );
      return { output: `${ratio.toFixed(2)}:1\n`, exitCode: 0 };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { output: `error: ${message}\n`, exitCode: 2 };
    }
  }

  return { output: `error: unknown command: ${command}\n\n${USAGE}`, exitCode: 2 };
}
