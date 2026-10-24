/**
 * @carto-a11y/cli — argument handling for the `carto-a11y` command.
 *
 * This module stays free of Node globals so it can be unit-tested anywhere;
 * `bin/carto-a11y.js` is the thin shim that wires it to `process`.
 */

import { contrastRatio, parseColor, relativeLuminance } from '@carto-a11y/core';

/** What the shim needs in order to print and exit. */
export interface CliResult {
  readonly output: string;
  readonly exitCode: number;
}

const USAGE = `carto-a11y — web-map accessibility auditing

Usage:
  carto-a11y contrast <colour> <colour>   WCAG 2.1 contrast ratio of two colours
  carto-a11y --help                       Show this message

Colours may be hex (#abc, #aabbcc), rgb()/rgba(), or any CSS colour name.
`;

/** Run the CLI over already-sliced arguments (no program name, no flags file). */
export function run(argv: readonly string[]): CliResult {
  const [command, ...rest] = argv;

  if (command === undefined || command === '--help' || command === '-h') {
    return { output: USAGE, exitCode: 0 };
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
