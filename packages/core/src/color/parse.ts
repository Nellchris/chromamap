/**
 * CSS colour parsing into normalised sRGB.
 *
 * Accepted input:
 * - 3- and 6-digit hex, with or without `#` (`#abc`, `#aabbcc`)
 * - legacy `rgb()` / `rgba()` with comma-separated components, either all
 *   numbers (0..255) or all percentages; a fourth alpha component is accepted
 *   and validated but discarded, since this module's output is opaque sRGB
 * - the 148 CSS Color Level 4 named colours, case-insensitively
 *
 * Deliberately out of scope for now: 4- and 8-digit hex, `hsl()`, `lab()`,
 * `color()` and the space-separated `rgb(r g b / a)` syntax.
 */

/** sRGB channels in 0..1, in red/green/blue order. */
export type RGB = [number, number, number];

/** Hex source for {@link CSS_NAMED_COLORS}; see that export for the parsed form. */
const NAMED_HEX: Record<string, string> = {
  aliceblue: 'f0f8ff',
  antiquewhite: 'faebd7',
  aqua: '00ffff',
  aquamarine: '7fffd4',
  azure: 'f0ffff',
  beige: 'f5f5dc',
  bisque: 'ffe4c4',
  black: '000000',
  blanchedalmond: 'ffebcd',
  blue: '0000ff',
  blueviolet: '8a2be2',
  brown: 'a52a2a',
  burlywood: 'deb887',
  cadetblue: '5f9ea0',
  chartreuse: '7fff00',
  chocolate: 'd2691e',
  coral: 'ff7f50',
  cornflowerblue: '6495ed',
  cornsilk: 'fff8dc',
  crimson: 'dc143c',
  cyan: '00ffff',
  darkblue: '00008b',
  darkcyan: '008b8b',
  darkgoldenrod: 'b8860b',
  darkgray: 'a9a9a9',
  darkgreen: '006400',
  darkgrey: 'a9a9a9',
  darkkhaki: 'bdb76b',
  darkmagenta: '8b008b',
  darkolivegreen: '556b2f',
  darkorange: 'ff8c00',
  darkorchid: '9932cc',
  darkred: '8b0000',
  darksalmon: 'e9967a',
  darkseagreen: '8fbc8f',
  darkslateblue: '483d8b',
  darkslategray: '2f4f4f',
  darkslategrey: '2f4f4f',
  darkturquoise: '00ced1',
  darkviolet: '9400d3',
  deeppink: 'ff1493',
  deepskyblue: '00bfff',
  dimgray: '696969',
  dimgrey: '696969',
  dodgerblue: '1e90ff',
  firebrick: 'b22222',
  floralwhite: 'fffaf0',
  forestgreen: '228b22',
  fuchsia: 'ff00ff',
  gainsboro: 'dcdcdc',
  ghostwhite: 'f8f8ff',
  gold: 'ffd700',
  goldenrod: 'daa520',
  gray: '808080',
  green: '008000',
  greenyellow: 'adff2f',
  grey: '808080',
  honeydew: 'f0fff0',
  hotpink: 'ff69b4',
  indianred: 'cd5c5c',
  indigo: '4b0082',
  ivory: 'fffff0',
  khaki: 'f0e68c',
  lavender: 'e6e6fa',
  lavenderblush: 'fff0f5',
  lawngreen: '7cfc00',
  lemonchiffon: 'fffacd',
  lightblue: 'add8e6',
  lightcoral: 'f08080',
  lightcyan: 'e0ffff',
  lightgoldenrodyellow: 'fafad2',
  lightgray: 'd3d3d3',
  lightgreen: '90ee90',
  lightgrey: 'd3d3d3',
  lightpink: 'ffb6c1',
  lightsalmon: 'ffa07a',
  lightseagreen: '20b2aa',
  lightskyblue: '87cefa',
  lightslategray: '778899',
  lightslategrey: '778899',
  lightsteelblue: 'b0c4de',
  lightyellow: 'ffffe0',
  lime: '00ff00',
  limegreen: '32cd32',
  linen: 'faf0e6',
  magenta: 'ff00ff',
  maroon: '800000',
  mediumaquamarine: '66cdaa',
  mediumblue: '0000cd',
  mediumorchid: 'ba55d3',
  mediumpurple: '9370db',
  mediumseagreen: '3cb371',
  mediumslateblue: '7b68ee',
  mediumspringgreen: '00fa9a',
  mediumturquoise: '48d1cc',
  mediumvioletred: 'c71585',
  midnightblue: '191970',
  mintcream: 'f5fffa',
  mistyrose: 'ffe4e1',
  moccasin: 'ffe4b5',
  navajowhite: 'ffdead',
  navy: '000080',
  oldlace: 'fdf5e6',
  olive: '808000',
  olivedrab: '6b8e23',
  orange: 'ffa500',
  orangered: 'ff4500',
  orchid: 'da70d6',
  palegoldenrod: 'eee8aa',
  palegreen: '98fb98',
  paleturquoise: 'afeeee',
  palevioletred: 'db7093',
  papayawhip: 'ffefd5',
  peachpuff: 'ffdab9',
  peru: 'cd853f',
  pink: 'ffc0cb',
  plum: 'dda0dd',
  powderblue: 'b0e0e6',
  purple: '800080',
  rebeccapurple: '663399',
  red: 'ff0000',
  rosybrown: 'bc8f8f',
  royalblue: '4169e1',
  saddlebrown: '8b4513',
  salmon: 'fa8072',
  sandybrown: 'f4a460',
  seagreen: '2e8b57',
  seashell: 'fff5ee',
  sienna: 'a0522d',
  silver: 'c0c0c0',
  skyblue: '87ceeb',
  slateblue: '6a5acd',
  slategray: '708090',
  slategrey: '708090',
  snow: 'fffafa',
  springgreen: '00ff7f',
  steelblue: '4682b4',
  tan: 'd2b48c',
  teal: '008080',
  thistle: 'd8bfd8',
  tomato: 'ff6347',
  turquoise: '40e0d0',
  violet: 'ee82ee',
  wheat: 'f5deb3',
  white: 'ffffff',
  whitesmoke: 'f5f5f5',
  yellow: 'ffff00',
  yellowgreen: '9acd32',
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Expand `rrggbb` (6 hex digits, no `#`) into sRGB channels. */
function sixDigitHexToRgb(hex: string): RGB {
  const int = Number.parseInt(hex, 16);
  return [
    ((int >> 16) & 0xff) / 255,
    ((int >> 8) & 0xff) / 255,
    (int & 0xff) / 255,
  ];
}

/**
 * The 148 CSS Color Level 4 named colours, keyed by lower-case name.
 *
 * Both spellings of the grey names are present and identical, as the spec
 * defines them (`gray`/`grey`, `darkgray`/`darkgrey`, and so on), as are the
 * `aqua`/`cyan` and `fuchsia`/`magenta` synonyms.
 */
export const CSS_NAMED_COLORS: Record<string, RGB> = Object.fromEntries(
  Object.entries(NAMED_HEX).map(([name, hex]) => [name, sixDigitHexToRgb(hex)]),
);

/** Parse `#abc`, `#aabbcc` or the same without the leading `#`. */
function parseHex(hex: string, original: string): RGB {
  if (!/^[0-9a-fA-F]+$/.test(hex)) {
    throw new Error(`cannot parse colour: ${original} (hex digits expected)`);
  }
  if (hex.length === 6) {
    return sixDigitHexToRgb(hex.toLowerCase());
  }
  if (hex.length === 3) {
    // Each digit doubles: #abc is #aabbcc, so one nibble spans 0..255 in 17s.
    const int = Number.parseInt(hex, 16);
    return [
      (((int >> 8) & 0xf) * 0x11) / 255,
      (((int >> 4) & 0xf) * 0x11) / 255,
      ((int & 0xf) * 0x11) / 255,
    ];
  }
  throw new Error(
    `cannot parse colour: ${original} (hex needs 3 or 6 digits, got ${String(hex.length)})`,
  );
}

/** One `rgb()` component: a number in 0..255 or a percentage of 255. */
function parseChannel(raw: string, asPercentage: boolean, original: string): number {
  const text = asPercentage ? raw.slice(0, -1) : raw;
  const value = Number(text);
  if (text.trim() === '' || !Number.isFinite(value)) {
    throw new Error(`cannot parse colour: ${original} (bad component "${raw}")`);
  }
  // CSS clamps out-of-range rgb() components rather than rejecting them.
  return asPercentage ? clamp(value / 100, 0, 1) : clamp(value / 255, 0, 1);
}

/** Parse the inside of `rgb(...)` / `rgba(...)`, which must be comma-separated. */
function parseRgbFunction(body: string, original: string): RGB {
  const parts = body.split(',').map((part) => part.trim());
  if (parts.length !== 3 && parts.length !== 4) {
    throw new Error(
      `cannot parse colour: ${original} (expected 3 or 4 components, got ${String(parts.length)})`,
    );
  }

  const channels = parts.slice(0, 3);
  const percentages = channels.filter((part) => part.endsWith('%')).length;
  if (percentages !== 0 && percentages !== 3) {
    throw new Error(
      `cannot parse colour: ${original} (mix of numbers and percentages)`,
    );
  }
  const asPercentage = percentages === 3;

  const alpha = parts[3];
  if (alpha !== undefined) {
    // Validated for a useful error message, then dropped: RGB is opaque.
    const isPercentage = alpha.endsWith('%');
    const value = Number(isPercentage ? alpha.slice(0, -1) : alpha);
    if (alpha.trim() === '' || !Number.isFinite(value)) {
      throw new Error(`cannot parse colour: ${original} (bad alpha "${alpha}")`);
    }
  }

  const [r, g, b] = channels;
  if (r === undefined || g === undefined || b === undefined) {
    throw new Error(`cannot parse colour: ${original} (missing component)`);
  }
  return [
    parseChannel(r, asPercentage, original),
    parseChannel(g, asPercentage, original),
    parseChannel(b, asPercentage, original),
  ];
}

/**
 * Parse a CSS colour string into sRGB channels in 0..1.
 *
 * @param input - A hex, `rgb()`/`rgba()` or named colour string.
 * @returns A fresh `[r, g, b]` tuple; never a reference into
 *   {@link CSS_NAMED_COLORS}.
 * @throws Error if the string is not one of the supported forms.
 */
export function parseColor(input: string): RGB {
  const text = input.trim();
  if (text === '') {
    throw new Error('cannot parse colour: empty string');
  }

  if (text.startsWith('#')) {
    return parseHex(text.slice(1), input);
  }

  const fn = /^rgba?\(([\s\S]*)\)$/i.exec(text);
  if (fn?.[1] !== undefined) {
    return parseRgbFunction(fn[1], input);
  }

  const named = CSS_NAMED_COLORS[text.toLowerCase()];
  if (named !== undefined) {
    return [named[0], named[1], named[2]];
  }

  // Bare hex such as "aabbcc" is only a colour if it looks like one; anything
  // else (including an unknown name) lands here.
  if (/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(text)) {
    return parseHex(text, input);
  }

  throw new Error(`cannot parse colour: ${input} (unrecognised format)`);
}

/**
 * Format sRGB channels as a lower-case `#rrggbb` string.
 *
 * Channels outside 0..1 are clamped, and each is rounded to the nearest 8-bit
 * value, so `rgbToHex(parseColor(x))` round-trips any 8-bit input.
 *
 * @param rgb - sRGB channels in 0..1.
 * @returns A `#rrggbb` string.
 */
export function rgbToHex(rgb: RGB): string {
  const hex = rgb
    .map((channel) => Math.round(clamp(channel, 0, 1) * 255)
      .toString(16)
      .padStart(2, '0'))
    .join('');
  return `#${hex}`;
}
