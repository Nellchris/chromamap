/**
 * The landing page: what the tool is, in about five seconds.
 *
 * A visitor arrives knowing nothing. Before any numbers, the page shows them
 * the problem itself - one strip of colours as most people see it, the same
 * strip as a red-blind reader does - and then offers the two things they can
 * do about it: drop in their own style, or open a real map that has the
 * problem already.
 */

import { TOOL_NAME, rgbToHex, simulateCVD, type RGB } from '@carto-a11y/core';

import { DEMOS, type DemoKey, type DemoSpec } from './demo.js';
import { el } from './dom.js';

/**
 * Five colours a thematic map might reasonably use.
 *
 * Chosen because they are unremarkable - a green, a red, an amber, a purple,
 * a blue, the palette of a hundred published maps - and because the first two
 * land on top of each other the moment red sensitivity goes.
 */
const HERO_COLOURS: readonly RGB[] = [
  [0.18, 0.49, 0.2], // forest green
  [0.776, 0.157, 0.157], // brick red
  [0.976, 0.659, 0.145], // amber
  [0.416, 0.106, 0.604], // purple
  [0.082, 0.396, 0.753], // blue
];

/** What the tool does, one line each. */
const POINTS: ReadonlyArray<{ glyph: string; text: string }> = [
  { glyph: '↑', text: 'Upload any MapLibre style to check its colours' },
  { glyph: '◐', text: 'Simulates three types of colour blindness' },
  { glyph: '↓', text: 'Download an accessible version of your palette' },
];

export interface LandingOptions {
  /** Open one of the built-in demos. */
  onDemo: (key: DemoKey) => void;
  /** Audit a style the visitor has handed over. */
  onFile: (file: File) => void;
}

/** One row of the hero strip: the same colours, one way of seeing them. */
function strip(label: string, colours: readonly RGB[]): HTMLElement {
  const row = el('div', 'hero-row');
  row.append(el('p', 'hero-row-label', label));
  const chips = el('div', 'hero-chips');
  for (const colour of colours) {
    const chip = el('span', 'hero-chip');
    chip.style.background = rgbToHex(colour);
    chips.append(chip);
  }
  row.append(chips);
  return row;
}

/**
 * The drop zone.
 *
 * The drag highlight is toggled on the node directly rather than through a
 * re-render: replacing the element mid-drag would cancel the drag itself.
 */
function dropZone(onFile: (file: File) => void): HTMLElement {
  const zone = el('div', 'drop-zone');
  zone.append(
    el('p', 'drop-title', 'Drop a MapLibre style JSON here'),
    el('p', 'drop-hint', 'Nothing is uploaded — every colour is measured on your device'),
  );

  const picker = el('label', 'drop-button');
  const input = el('input', 'visually-hidden');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file !== undefined) {
      onFile(file);
    }
  });
  picker.append(input, el('span', undefined, 'Choose a file…'));
  zone.append(picker);

  const stop = (event: DragEvent): void => {
    event.preventDefault();
    event.stopPropagation();
  };
  zone.addEventListener('dragenter', (event) => {
    stop(event);
    zone.classList.add('is-dragging');
  });
  zone.addEventListener('dragover', (event) => {
    stop(event);
    if (event.dataTransfer !== null) {
      event.dataTransfer.dropEffect = 'copy';
    }
    zone.classList.add('is-dragging');
  });
  zone.addEventListener('dragleave', (event) => {
    stop(event);
    zone.classList.remove('is-dragging');
  });
  zone.addEventListener('drop', (event) => {
    stop(event);
    zone.classList.remove('is-dragging');
    const file = event.dataTransfer?.files[0];
    if (file !== undefined) {
      onFile(file);
    }
  });

  return zone;
}

/** One demo, as a card: its real colours, its name, where the data came from. */
function demoCard(spec: DemoSpec, onOpen: () => void): HTMLElement {
  const card = el('button', 'demo-card');
  card.type = 'button';
  card.addEventListener('click', onOpen);

  const strip = el('span', 'demo-strip');
  for (const colour of spec.preview) {
    const chip = el('span', 'demo-chip');
    chip.style.background = colour;
    strip.append(chip);
  }
  card.append(
    strip,
    el('span', 'demo-name', spec.title),
    el('span', 'demo-blurb', spec.blurb),
  );
  return card;
}

/** Build the landing page. */
export function renderLanding(root: HTMLElement, options: LandingOptions): void {
  const page = el('div', 'landing-inner');

  const header = el('header', 'landing-head');
  header.append(
    el('p', 'landing-brand', TOOL_NAME),
    el(
      'h1',
      'landing-tagline',
      'See how your map looks to people with colour vision deficiency',
    ),
  );
  page.append(header);

  const hero = el('section', 'hero');
  const demo = el('div', 'hero-strips');
  demo.append(
    strip('Normal vision', HERO_COLOURS),
    strip(
      'Red-blind vision',
      HERO_COLOURS.map((colour) => simulateCVD(colour, 'protan')),
    ),
  );
  hero.append(demo);

  const points = el('ul', 'hero-points');
  for (const point of POINTS) {
    const item = el('li', 'hero-point');
    const glyph = el('span', 'hero-glyph', point.glyph);
    glyph.setAttribute('aria-hidden', 'true');
    item.append(glyph, el('span', undefined, point.text));
    points.append(item);
  }
  hero.append(points);
  page.append(hero);

  const upload = el('section', 'landing-upload');
  upload.append(dropZone(options.onFile));
  upload.append(
    el(
      'p',
      'upload-note',
      'Styles with embedded map data will display as an interactive map. ' +
        'Styles referencing external data will show a colour scheme audit.',
    ),
  );
  page.append(upload);

  const demos = el('section', 'landing-demos');
  demos.append(el('h2', 'landing-section-title', 'Or explore a demo'));
  const cards = el('div', 'demo-cards');
  for (const key of ['hawaii', 'nyc'] as const) {
    cards.append(
      demoCard(DEMOS[key], () => {
        options.onDemo(key);
      }),
    );
  }
  demos.append(cards);
  page.append(demos);

  const footer = el('footer', 'landing-foot');
  footer.append(
    el('p', 'landing-foot-name', 'Built by Nelson Christopher, Geospatial Analyst'),
    el(
      'p',
      'landing-foot-note',
      'Every audit comes with a technical report: the metric, the thresholds and the full numbers.',
    ),
  );
  page.append(footer);

  root.replaceChildren(page);
}
