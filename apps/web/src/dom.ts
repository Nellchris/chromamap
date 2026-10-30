/**
 * The small DOM helpers the whole app is built out of - no framework, as asked.
 *
 * Everything here is presentation-only: nothing in this file knows what a map
 * class or an audit is.
 */

import { CVD_MATRICES, rgbToHex, type RGB } from '@carto-a11y/core';

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

export function swatch(color: RGB, title: string, small = false): HTMLSpanElement {
  const node = el('span', small ? 'swatch swatch-sm' : 'swatch');
  node.style.background = rgbToHex(color);
  node.title = title;
  return node;
}

/** A `<details>` card with a quiet summary. */
export function disclosure(summaryText: string, ...content: HTMLElement[]): HTMLElement {
  const section = el('section', 'panel');
  const details = el('details');
  details.append(el('summary', 'disclosure-summary', summaryText), ...content);
  section.append(details);
  return section;
}

/** One choice in a segmented control. */
export interface Segment<T extends string> {
  key: T;
  label: string;
}

/**
 * A pill-shaped segmented control.
 *
 * The same control serves the two tabs at the top of the panel and the
 * before/after switch below them, so a reader only has one kind of switch to
 * learn. `data-variant` carries the key, which the stylesheet uses to colour
 * the accessible option as an improvement.
 */
export function segmented<T extends string>(options: {
  segments: ReadonlyArray<Segment<T>>;
  active: T;
  ariaLabel: string;
  onSelect: (key: T) => void;
  extraClass?: string;
}): HTMLElement {
  const group = el(
    'div',
    options.extraClass === undefined ? 'variant' : `variant ${options.extraClass}`,
  );
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', options.ariaLabel);

  for (const segment of options.segments) {
    const selected = options.active === segment.key;
    const button = el(
      'button',
      `variant-option${selected ? ' is-selected' : ''}`,
      segment.label,
    );
    button.type = 'button';
    button.dataset['variant'] = segment.key;
    button.setAttribute('aria-pressed', String(selected));
    button.addEventListener('click', () => {
      options.onSelect(segment.key);
    });
    group.append(button);
  }

  return group;
}

/** Hand the browser a file without a round trip to a server. */
export function download(filename: string, contents: string, type: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.append(link);
  link.click();
  link.remove();
  // Give the click a tick to start before the blob is reclaimed.
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}

/**
 * Install one SVG filter per dichromacy, built from the same Machado matrices
 * the engine uses.
 *
 * `color-interpolation-filters="linearRGB"` makes the browser apply the matrix
 * in linear light using the real sRGB transfer function, which is exactly what
 * `simulateCVD` does. Doing it instead with an explicit feComponentTransfer
 * gamma of 2.2 would only approximate that curve, and the map would then
 * disagree with the swatches beside it.
 */
export function installFilters(): void {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'filter-defs');
  svg.setAttribute('aria-hidden', 'true');
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');

  for (const mode of ['protan', 'deutan', 'tritan'] as const) {
    const matrix = CVD_MATRICES[mode];
    const filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
    filter.setAttribute('id', `cvd-${mode}`);
    filter.setAttribute('color-interpolation-filters', 'linearRGB');
    const transform = document.createElementNS(
      'http://www.w3.org/2000/svg',
      'feColorMatrix',
    );
    transform.setAttribute('type', 'matrix');
    transform.setAttribute(
      'values',
      `${matrix.map((row) => `${row.join(' ')} 0 0`).join(' ')} 0 0 0 1 0`,
    );
    filter.append(transform);
    defs.append(filter);
  }

  svg.append(defs);
  document.body.append(svg);
}
