#!/usr/bin/env node
/**
 * Write `demos/hawaii/styles/remediated.json`: the baseline style with an
 * accessible palette in place of its traditional one.
 *
 * Run it with Node 24 or newer, which strips the types itself:
 *
 *     node scripts/remediate-hawaii.ts        # or: pnpm demo:remediate
 *
 * The colours come from `generateAccessiblePalette`, which spreads the classes
 * evenly through lightness rather than relying on hue. Everything else about
 * the style - layers, sources, labels, zoom - is left exactly as it was, so
 * the two styles differ in nothing but colour.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  applyPalette,
  extractBackground,
  extractClasses,
  generateAccessiblePalette,
  rgbToHex,
  runAudit,
  summariseAudit,
} from '@carto-a11y/core';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const BASELINE = join(REPO_ROOT, 'demos', 'hawaii', 'styles', 'baseline.json');
const OUTPUT = join(REPO_ROOT, 'demos', 'hawaii', 'styles', 'remediated.json');

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const baseline: unknown = JSON.parse(readFileSync(BASELINE, 'utf8'));
const classes = extractClasses(baseline);
if (classes.length === 0) {
  throw new Error('no colours were extracted from the baseline style');
}

// Remediate against what the map is actually drawn on - the ocean, here, not
// paper white - so the palette is tuned for what a reader sees.
const background = extractBackground(baseline);
const before = runAudit(classes, { background });
const palette = generateAccessiblePalette(classes, { background });
const after = classes.map((cls, index) => ({
  ...cls,
  color: palette[index]?.remediated ?? cls.color,
}));
const afterAudit = runAudit(after, { background });

// `applyPalette` walks the same slots `extractClasses` read, so every colour
// lands exactly where the audit found it; anything it could not place would
// mean a palette keyed by ids this style does not have.
const applied = applyPalette(
  baseline,
  new Map(palette.map((entry) => [entry.classId, entry.remediated] as const)),
);
if (applied.missing.length > 0) {
  throw new Error(
    `${String(applied.missing.length)} colours could not be written back: ${applied.missing.join(', ')}`,
  );
}
const remediated = applied.style;
if (isRecord(remediated)) {
  remediated['name'] = 'Hawaiʻi geological map — accessible';
  remediated['metadata'] = {
    'carto-a11y:purpose':
      'The after picture. Same layers, same data, same labels as baseline.json; only ' +
      'the colours differ. The palette is spread evenly through lightness instead of ' +
      'relying on hue, which is the part of colour that dichromacy takes away.',
    'carto-a11y:generatedBy': 'scripts/remediate-hawaii.ts',
    'carto-a11y:derivedFrom': 'baseline.json',
  };
}

writeFileSync(OUTPUT, `${JSON.stringify(remediated, null, 2)}\n`, 'utf8');

const beforeSummary = summariseAudit(classes, before);
const afterSummary = summariseAudit(after, afterAudit);
console.error(`Wrote ${OUTPUT}`);
console.error(`  before: ${beforeSummary.headline} (${String(before.summary.failing)} judgements)`);
console.error(
  `  after:  ${afterSummary.headline} (${String(afterAudit.summary.failing)} judgements)`,
);
for (const entry of palette) {
  console.error(
    `  ${entry.classId.padEnd(26)} ${rgbToHex(entry.original)} -> ${rgbToHex(entry.remediated)}`,
  );
}
