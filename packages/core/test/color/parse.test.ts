import { describe, expect, it } from 'vitest';

import {
  CSS_NAMED_COLORS,
  parseColor,
  rgbToHex,
  type RGB,
} from '../../src/color/parse.js';

/** Channel-wise comparison, since RGB is a plain tuple of floats. */
function expectRgb(actual: RGB, expected: RGB, precision = 12): void {
  expect(actual).toHaveLength(3);
  expect(actual[0]).toBeCloseTo(expected[0], precision);
  expect(actual[1]).toBeCloseTo(expected[1], precision);
  expect(actual[2]).toBeCloseTo(expected[2], precision);
}

describe('parseColor: hex', () => {
  it('parses 6-digit hex', () => {
    expectRgb(parseColor('#ff0000'), [1, 0, 0]);
    expectRgb(parseColor('#00ff00'), [0, 1, 0]);
    expectRgb(parseColor('#0000ff'), [0, 0, 1]);
    expectRgb(parseColor('#000000'), [0, 0, 0]);
    expectRgb(parseColor('#ffffff'), [1, 1, 1]);
  });

  it('parses 3-digit hex by doubling each digit', () => {
    expectRgb(parseColor('#abc'), parseColor('#aabbcc'));
    expectRgb(parseColor('#f00'), [1, 0, 0]);
    expectRgb(parseColor('#fff'), [1, 1, 1]);
    expectRgb(parseColor('#000'), [0, 0, 0]);
    // 0xa doubled is 0xaa = 170, not 0xa0 = 160.
    expect(parseColor('#a00')[0]).toBeCloseTo(170 / 255, 12);
  });

  it('is case-insensitive', () => {
    expectRgb(parseColor('#AABBCC'), parseColor('#aabbcc'));
    expectRgb(parseColor('#AbC'), parseColor('#aabbcc'));
  });

  it('accepts hex without the leading hash', () => {
    expectRgb(parseColor('aabbcc'), parseColor('#aabbcc'));
    expectRgb(parseColor('abc'), parseColor('#aabbcc'));
  });

  it('ignores surrounding whitespace', () => {
    expectRgb(parseColor('  #aabbcc \n'), parseColor('#aabbcc'));
  });

  it('computes an 8-bit channel exactly', () => {
    expect(parseColor('#808080')[0]).toBeCloseTo(128 / 255, 12);
  });
});

describe('parseColor: rgb() and rgba()', () => {
  it('parses integer components', () => {
    expectRgb(parseColor('rgb(255, 0, 0)'), [1, 0, 0]);
    expectRgb(parseColor('rgb(0,128,255)'), [0, 128 / 255, 1]);
  });

  it('tolerates loose whitespace', () => {
    expectRgb(parseColor('rgb(   0 ,128,  255   )'), [0, 128 / 255, 1]);
  });

  it('parses percentage components', () => {
    expectRgb(parseColor('rgb(100%, 0%, 0%)'), [1, 0, 0]);
    expectRgb(parseColor('rgb(50%, 50%, 50%)'), [0.5, 0.5, 0.5]);
  });

  it('accepts an alpha component and drops it', () => {
    expectRgb(parseColor('rgba(0, 128, 255, 0.5)'), parseColor('rgb(0, 128, 255)'));
    expectRgb(parseColor('rgba(0, 128, 255, 50%)'), parseColor('rgb(0, 128, 255)'));
    // rgb() and rgba() are synonyms in CSS Color 4; both take 3 or 4 components.
    expectRgb(parseColor('rgb(255, 0, 0, 0.25)'), [1, 0, 0]);
    expectRgb(parseColor('rgba(255, 0, 0)'), [1, 0, 0]);
  });

  it('is case-insensitive in the function name', () => {
    expectRgb(parseColor('RGB(255, 0, 0)'), [1, 0, 0]);
    expectRgb(parseColor('RgBa(255, 0, 0, 1)'), [1, 0, 0]);
  });

  it('clamps out-of-range components, as CSS does', () => {
    expectRgb(parseColor('rgb(300, -20, 0)'), [1, 0, 0]);
    expectRgb(parseColor('rgb(150%, -50%, 0%)'), [1, 0, 0]);
  });

  it('rejects a mix of numbers and percentages', () => {
    expect(() => parseColor('rgb(50%, 0, 0)')).toThrow(/mix of numbers and percentages/);
  });

  it('rejects the wrong number of components', () => {
    expect(() => parseColor('rgb(1,2)')).toThrow(/expected 3 or 4 components/);
    expect(() => parseColor('rgb(1,2,3,4,5)')).toThrow(/expected 3 or 4 components/);
  });

  it('rejects non-numeric components', () => {
    expect(() => parseColor('rgb(a,b,c)')).toThrow(/bad component/);
    expect(() => parseColor('rgb(1,2,3,x)')).toThrow(/bad alpha/);
  });
});

describe('parseColor: named colours', () => {
  it('parses the primaries', () => {
    expectRgb(parseColor('red'), [1, 0, 0]);
    expectRgb(parseColor('lime'), [0, 1, 0]);
    expectRgb(parseColor('blue'), [0, 0, 1]);
    expectRgb(parseColor('black'), [0, 0, 0]);
    expectRgb(parseColor('white'), [1, 1, 1]);
  });

  it('is case-insensitive', () => {
    expectRgb(parseColor('RED'), parseColor('red'));
    expectRgb(parseColor('RebeccaPurple'), parseColor('rebeccapurple'));
    expectRgb(parseColor('  CornflowerBlue  '), parseColor('cornflowerblue'));
  });

  it('matches the hex the spec gives for a sample of names', () => {
    const samples: ReadonlyArray<readonly [string, string]> = [
      ['rebeccapurple', '#663399'],
      ['cornflowerblue', '#6495ed'],
      ['darkslategray', '#2f4f4f'],
      ['navajowhite', '#ffdead'],
      ['yellowgreen', '#9acd32'],
      ['mediumspringgreen', '#00fa9a'],
      ['papayawhip', '#ffefd5'],
      ['gainsboro', '#dcdcdc'],
    ];
    for (const [name, hex] of samples) {
      expect(rgbToHex(parseColor(name)), name).toBe(hex);
    }
  });

  it('carries all 148 CSS Color 4 names', () => {
    expect(Object.keys(CSS_NAMED_COLORS)).toHaveLength(148);
  });

  it('keeps both spellings of every grey name, with equal values', () => {
    const pairs: ReadonlyArray<readonly [string, string]> = [
      ['gray', 'grey'],
      ['darkgray', 'darkgrey'],
      ['dimgray', 'dimgrey'],
      ['lightgray', 'lightgrey'],
      ['slategray', 'slategrey'],
      ['darkslategray', 'darkslategrey'],
      ['lightslategray', 'lightslategrey'],
    ];
    for (const [a, b] of pairs) {
      expect(rgbToHex(parseColor(a)), `${a} vs ${b}`).toBe(rgbToHex(parseColor(b)));
    }
  });

  it('keeps the spec synonyms equal', () => {
    expect(rgbToHex(parseColor('aqua'))).toBe(rgbToHex(parseColor('cyan')));
    expect(rgbToHex(parseColor('fuchsia'))).toBe(rgbToHex(parseColor('magenta')));
  });

  it('holds every value in 0..1', () => {
    for (const [name, rgb] of Object.entries(CSS_NAMED_COLORS)) {
      for (const channel of rgb) {
        expect(channel, name).toBeGreaterThanOrEqual(0);
        expect(channel, name).toBeLessThanOrEqual(1);
      }
    }
  });

  it('returns a fresh tuple, not a reference into the table', () => {
    const first = parseColor('red');
    first[1] = 0.5;
    expectRgb(parseColor('red'), [1, 0, 0]);
    expect(CSS_NAMED_COLORS['red']?.[1]).toBe(0);
  });
});

describe('parseColor: invalid input', () => {
  const invalid = [
    '',
    '   ',
    '#',
    '#ab',
    '#abcd',
    '#abcde',
    '#abcdefg',
    '#gg0000',
    'notacolour',
    'redd',
    'hsl(0, 0%, 0%)',
    'lab(50% 0 0)',
    'rgb(1,2,3',
    'transparent',
  ];

  for (const input of invalid) {
    it(`throws on ${JSON.stringify(input)}`, () => {
      expect(() => parseColor(input)).toThrow();
    });
  }

  it('names the offending input in the message', () => {
    expect(() => parseColor('notacolour')).toThrow(/notacolour/);
  });
});

describe('rgbToHex', () => {
  it('formats lower-case #rrggbb', () => {
    expect(rgbToHex([1, 0, 0])).toBe('#ff0000');
    expect(rgbToHex([0, 0, 0])).toBe('#000000');
    expect(rgbToHex([1, 1, 1])).toBe('#ffffff');
    expect(rgbToHex([0.4, 0.2, 0.6])).toBe('#663399');
  });

  it('rounds to the nearest 8-bit value', () => {
    expect(rgbToHex([128 / 255, 128 / 255, 128 / 255])).toBe('#808080');
    expect(rgbToHex([0.5, 0.5, 0.5])).toBe('#808080');
  });

  it('clamps out-of-range channels', () => {
    expect(rgbToHex([2, -1, 0.5])).toBe('#ff0080');
  });

  it('round-trips every named colour', () => {
    for (const [name, rgb] of Object.entries(CSS_NAMED_COLORS)) {
      expect(rgbToHex(parseColor(name)), name).toBe(rgbToHex(rgb));
      expectRgb(parseColor(rgbToHex(rgb)), rgb);
    }
  });

  it('round-trips every 8-bit grey', () => {
    for (let i = 0; i <= 255; i += 1) {
      const channel = i / 255;
      const hex = rgbToHex([channel, channel, channel]);
      expectRgb(parseColor(hex), [channel, channel, channel]);
    }
  });
});
