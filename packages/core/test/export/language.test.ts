import { describe, expect, it } from 'vitest';

import { VISION_MODES, runAudit } from '../../src/audit/engine.js';
import { parseColor } from '../../src/color/parse.js';
import {
  ABOUT_TEXT,
  VISION_MODE_AUDIENCE,
  VISION_MODE_LABELS,
  VISION_MODE_SHORT,
  clashSentence,
  humaniseClassId,
  summariseAudit,
} from '../../src/export/language.js';
import type { MapClass } from '../../src/style/extract.js';

function fill(id: string, color: string, opacity = 1): MapClass {
  return { id, color: parseColor(color), type: 'fill', opacity };
}

/** Summarise a set of classes under the default options. */
function summarise(classes: MapClass[]) {
  return summariseAudit(classes, runAudit(classes));
}

describe('vision mode wording', () => {
  it('names each mode in plain language first, with the clinical term after', () => {
    expect(VISION_MODE_LABELS.normal).toBe('Normal Vision');
    expect(VISION_MODE_LABELS.protan).toBe('Red-Blind (Protanopia)');
    expect(VISION_MODE_LABELS.deutan).toBe('Green-Blind (Deuteranopia)');
    expect(VISION_MODE_LABELS.tritan).toBe('Blue-Yellow Blind (Tritanopia)');
  });

  it('has a label, an audience and a short form for every mode', () => {
    for (const mode of VISION_MODES) {
      expect(VISION_MODE_LABELS[mode], mode).not.toBe('');
      expect(VISION_MODE_AUDIENCE[mode], mode).not.toBe('');
      expect(VISION_MODE_SHORT[mode], mode).not.toBe('');
    }
  });

  it('explains who is affected without jargon', () => {
    expect(ABOUT_TEXT).toContain('colour vision deficiency');
    expect(ABOUT_TEXT).toContain('colour blindness');
    expect(ABOUT_TEXT).toContain('8% of men');
    expect(ABOUT_TEXT).not.toContain('CVD');
  });
});

describe('clashSentence', () => {
  it('reads like a sentence', () => {
    expect(clashSentence('Historical Lava', 'Mauna Loa Holocene', 'protan')).toBe(
      '“Historical Lava” and “Mauna Loa Holocene” look the same to red-blind viewers',
    );
    expect(clashSentence('A', 'B', 'deutan')).toContain('green-blind viewers');
    expect(clashSentence('A', 'B', 'tritan')).toContain('blue-yellow blind viewers');
  });

  it('says plainly when a clash is not about colour blindness at all', () => {
    expect(clashSentence('A', 'B', 'normal')).toContain('everyone');
  });
});

describe('humaniseClassId', () => {
  it('keeps the value of a match branch, which is the map label', () => {
    expect(humaniseClassId('geologic-units/Qkh')).toBe('Qkh');
    expect(humaniseClassId('landuse/park')).toBe('park');
  });

  it('tidies a bare layer id', () => {
    expect(humaniseClassId('unit-contacts')).toBe('Unit contacts');
    expect(humaniseClassId('water')).toBe('Water');
    expect(humaniseClassId('road_major')).toBe('Road major');
  });

  it('spells out a match fallback', () => {
    expect(humaniseClassId('geologic-units/default')).toBe('Geologic units (everything else)');
  });

  it('separates a layer from its paint type', () => {
    expect(humaniseClassId('labels:text')).toBe('Labels – text');
  });
});

describe('summariseAudit: a style with nothing wrong', () => {
  const summary = summarise([fill('ink', 'black'), fill('paper', 'white')]);

  it('is green and says so', () => {
    expect(summary.level).toBe('accessible');
    expect(summary.label).toBe('Accessible');
    expect(summary.indicator).toBe('🟢');
  });

  it('counts no clashes', () => {
    expect(summary.clashes).toBe(0);
    expect(summary.confusableColours).toBe(0);
    expect(summary.headline).toBe('No colour clashes found');
    expect(summary.detail).toContain('All 2 map colours stay distinguishable');
  });

  it('has no worst mode to report', () => {
    expect(summary.worstMode).toBeUndefined();
    expect(summary.worstLine).toBeUndefined();
  });
});

describe('summariseAudit: a style with a few problems', () => {
  // Three identical fills clash with each other: three pairs, under every mode.
  const summary = summarise([
    fill('a', '#ff0000'),
    fill('b', '#ff0000'),
    fill('c', '#ff0000'),
    fill('d', 'white'),
  ]);

  it('is amber between one and ten clashes', () => {
    expect(summary.clashes).toBe(3);
    expect(summary.level).toBe('some-issues');
    expect(summary.label).toBe('Some issues');
    expect(summary.indicator).toBe('🟡');
  });

  it('counts the colours caught up in a clash, not the clashes', () => {
    expect(summary.totalColours).toBe(4);
    expect(summary.confusableColours).toBe(3);
    expect(summary.detail).toBe(
      '3 of 4 map colours become confusable for people with colour vision deficiency',
    );
  });

  it('counts a pair once however many modes it fails in', () => {
    // Three pairs failing in four modes each is twelve judgements, three clashes.
    expect(summary.clashes).toBe(3);
  });
});

describe('summariseAudit: a style in trouble', () => {
  const classes = Array.from({ length: 6 }, (_, index) => fill(`c${String(index)}`, '#336699'));
  const summary = summarise(classes);

  it('is red at eleven clashes or more', () => {
    expect(summary.clashes).toBe(15);
    expect(summary.level).toBe('needs-attention');
    expect(summary.label).toBe('Needs attention');
    expect(summary.indicator).toBe('🔴');
  });

  it('writes the headline in the plural', () => {
    expect(summary.headline).toBe('15 colour clashes found');
    expect(summary.detail).toContain('6 of 6 map colours');
  });
});

describe('summariseAudit: naming who is worst affected', () => {
  // Both simulate to #6d5f00 under protanopia and nowhere else.
  const summary = summarise([fill('roads', '#ff0000'), fill('parks', '#006a00')]);

  it('points at the mode with the most clashes', () => {
    expect(summary.worstMode).toBe('protan');
    expect(summary.worstLine).toBe('Worst problems: Red-blind viewers (1 clash)');
  });

  it('writes a single clash in the singular', () => {
    expect(summary.headline).toBe('1 colour clash found');
  });

  it('uses no jargon anywhere a reader lands first', () => {
    const lead = [summary.label, summary.headline, summary.detail, summary.worstLine ?? ''].join(
      ' ',
    );
    for (const jargon of ['ΔE', 'CIEDE', 'dE', 'protan', 'deutan', 'tritan', 'CVD']) {
      expect(lead, jargon).not.toContain(jargon);
    }
  });
});
