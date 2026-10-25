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
  extractBackground,
  extractClasses,
  generateAccessiblePalette,
  rgbToHex,
  runAudit,
  summariseAudit,
  type RemediationResult,
} from '@carto-a11y/core';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const BASELINE = join(REPO_ROOT, 'demos', 'hawaii', 'styles', 'baseline.json');
const OUTPUT = join(REPO_ROOT, 'demos', 'hawaii', 'styles', 'remediated.json');

/** The paint properties a colour can live under, as the extractor sees them. */
const COLOR_KEYS = ['fill-color', 'line-color', 'text-color', 'circle-color'] as const;
const TYPE_OF: Record<(typeof COLOR_KEYS)[number], string> = {
  'fill-color': 'fill',
  'line-color': 'line',
  'text-color': 'text',
  'circle-color': 'circle',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Render a match label the way `extractClasses` does when building an id. */
function labelFragment(label: unknown): string {
  return Array.isArray(label)
    ? (label as unknown[]).map((entry) => String(entry)).join('|')
    : String(label);
}

/**
 * Put the new colours back into the style, wherever the old ones were.
 *
 * Walks the same shapes the extractor walks and rebuilds each class id the
 * same way, so a colour lands exactly where the audit found it.
 */
function applyPalette(style: unknown, palette: readonly RemediationResult[]): unknown {
  const byId = new Map(palette.map((entry) => [entry.classId, rgbToHex(entry.remediated)]));
  const next: unknown = JSON.parse(JSON.stringify(style));
  if (!isRecord(next) || !Array.isArray(next['layers'])) {
    throw new Error('the baseline style has no layers array');
  }

  let replaced = 0;
  for (const [index, layer] of (next['layers'] as unknown[]).entries()) {
    if (!isRecord(layer)) {
      continue;
    }
    const layerId =
      typeof layer['id'] === 'string' && layer['id'] !== '' ? layer['id'] : `layer-${String(index)}`;
    const paint = layer['paint'];
    if (!isRecord(paint)) {
      continue;
    }

    const present = COLOR_KEYS.filter((key) => paint[key] !== undefined);
    for (const key of present) {
      const baseId = present.length > 1 ? `${layerId}:${TYPE_OF[key]}` : layerId;
      const value = paint[key];

      if (Array.isArray(value) && value[0] === 'match') {
        const expression = [...(value as unknown[])];
        let cursor = 2;
        while (cursor + 1 < expression.length) {
          const colour = byId.get(`${baseId}/${labelFragment(expression[cursor])}`);
          if (colour !== undefined) {
            expression[cursor + 1] = colour;
            replaced += 1;
          }
          cursor += 2;
        }
        if (cursor === expression.length - 1) {
          const colour = byId.get(`${baseId}/default`);
          if (colour !== undefined) {
            expression[cursor] = colour;
            replaced += 1;
          }
        }
        paint[key] = expression;
        continue;
      }

      const colour = byId.get(baseId);
      if (colour !== undefined) {
        paint[key] = colour;
        replaced += 1;
      }
    }
  }

  if (replaced !== palette.length) {
    throw new Error(
      `expected to replace ${String(palette.length)} colours, replaced ${String(replaced)}`,
    );
  }
  return next;
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

const remediated = applyPalette(baseline, palette);
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
