/**
 * @carto-a11y/cli — argument handling for the `carto-a11y` command.
 *
 * This module stays free of Node globals so it can be unit-tested anywhere;
 * `bin/carto-a11y.js` is the thin shim that wires it to `process`.
 */

import { contrastRatio, relativeLuminance } from '@carto-a11y/core';

/** What the shim needs in order to print and exit. */
export interface CliResult {
  readonly output: string;
  readonly exitCode: number;
}

const USAGE = `carto-a11y — web-map accessibility auditing

Usage:
  carto-a11y contrast <#rrggbb> <#rrggbb>   WCAG 2.1 contrast ratio of two colours
  carto-a11y --help                         Show this message
`;

/** Parse `#rrggbb` (or `rrggbb`) into sRGB channels in 0..1. */
export function parseHexColor(input: string): readonly [number, number, number] {
  const hex = input.startsWith('#') ? input.slice(1) : input;
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
    throw new Error(`not a #rrggbb colour: ${input}`);
  }
  const int = Number.parseInt(hex, 16);
  return [
    ((int >> 16) & 0xff) / 255,
    ((int >> 8) & 0xff) / 255,
    (int & 0xff) / 255,
  ];
}

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
      const [r1, g1, b1] = parseHexColor(first);
      const [r2, g2, b2] = parseHexColor(second);
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
