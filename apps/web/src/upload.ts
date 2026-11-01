/**
 * "Your map": audit a MapLibre style the reader brings themselves.
 *
 * The engine already takes any style, so this mode is mostly about what to
 * show *instead of* a map. A style file names its sources but does not contain
 * them, and fetching a stranger's tiles to draw a map we were not asked to draw
 * would be both slow and presumptuous - so the colours themselves become the
 * view: one labelled swatch per class, each with the four ways it can be seen,
 * and a badge wherever a colour collides with another.
 *
 * Nothing leaves the browser. The file is read with the File API, audited by
 * the same engine the demo uses, and the remediated style is handed back as a
 * download. There is no server in this picture at all.
 */

import {
  applyPalette,
  extractBackground,
  extractClasses,
  generateAccessiblePalette,
  humaniseClassId,
  rgbToHex,
  VISION_MODES,
  VISION_MODE_LABELS,
  type AuditPair,
  type MapClass,
  type RGB,
  type VisionMode,
} from '@carto-a11y/core';

import {
  auditView,
  changedPanel,
  clashPanel,
  clashPartners,
  downloadsPanel,
  funFactPanel,
  scoreCard,
  seenColor,
  type AuditView,
  type ModeView,
} from './audit-view.js';
import { download, el, toggleButton } from './dom.js';
import type { Bbox } from './map.js';
import type { RemediateReply, RemediateRequest } from './remediate.worker.js';
import {
  createUploadedMap,
  hasInlineData,
  inlineBounds,
  type UploadedMap,
} from './uploaded-map.js';

/** A style file big enough to be a mistake rather than a map. */
const MAX_BYTES = 32 * 1024 * 1024;

/** The one-letter key under each simulated swatch. */
const MODE_KEYS: Record<VisionMode, string> = {
  normal: 'N',
  protan: 'P',
  deutan: 'D',
  tritan: 'T',
};

type UploadVariant = 'original' | 'accessible';

/** The accessible version of an uploaded style, once it has been worked out. */
interface Remediated {
  view: AuditView;
  /** The reader's own style, recoloured, ready to download. */
  style: unknown;
  /** How many of its colours were actually rewritten. */
  changed: number;
}

/** A style the reader has handed us, and what we have made of it so far. */
interface Loaded {
  fileName: string;
  style: unknown;
  original: AuditView;
  remediated: Remediated | undefined;
  /**
   * True when the style carries its own GeoJSON, so there is a real map in
   * the file and not only a palette.
   */
  drawable: boolean;
  /** The extent of that data, for the opening view. */
  bounds: Bbox | undefined;
}

interface UploadState {
  loaded: Loaded | undefined;
  /** Set while a file is being read and audited. */
  reading: boolean;
  /** Set while the accessible palette is being worked out. */
  remediating: boolean;
  error: string | undefined;
  variant: UploadVariant;
  activePair: AuditPair | undefined;
  /** The grid card the reader has picked out, if any. */
  activeClassId: string | undefined;
  showAllClashes: boolean;
}

export interface UploadOptions {
  /** The one map container, shared with the demos. */
  mapEl: HTMLElement;
  /** The panel, so a map can be framed around rather than behind it. */
  sidebar: HTMLElement;
  /** Ask the shell to render again, after this mode has changed its state. */
  rerender: () => void;
  /**
   * Go back to the landing page.
   *
   * The file picker lives there now, so "audit another file" is a way out of
   * this view rather than a control inside it.
   */
  onLeave: () => void;
}

export interface Upload {
  view(mode: VisionMode): ModeView;
  /**
   * Take the map container, if the loaded style has anything to draw.
   *
   * Only one map may live in it at a time, so the shell hands ownership over
   * when this mode comes to the front and takes it back when a demo does.
   */
  claimMap(): void;
  /** Give the container back. */
  releaseMap(): void;
  /** Audit a style the landing page has read for us. */
  open(fileName: string, text: string): void;
  /** Read a file the landing page was handed, then audit it. */
  openFile(file: File): void;
  /** True once there is something to show in the audit view. */
  isLoaded(): boolean;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/* ------------------------------------------------------------------ *
 * Reading a style
 * ------------------------------------------------------------------ */

/**
 * Parse and audit a style file's text.
 *
 * @throws With a sentence a reader can act on, for every way a file can fail
 *   to be an auditable style.
 */
function readStyle(fileName: string, text: string): Loaded {
  let style: unknown;
  try {
    style = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON, so there is nothing to read in it.');
  }

  if (typeof style !== 'object' || style === null || Array.isArray(style)) {
    throw new Error('A MapLibre style is a JSON object; this file holds something else.');
  }
  if (!Array.isArray((style as { layers?: unknown }).layers)) {
    throw new Error(
      'That does not look like a MapLibre style: it has no “layers” array to take colours from.',
    );
  }

  const classes = extractClasses(style);
  if (classes.length === 0) {
    throw new Error(
      'No colours could be read from that style. Colours that only exist once data is ' +
        'loaded - an interpolate or a step over a feature property - cannot be audited ' +
        'from the file alone.',
    );
  }

  return {
    fileName,
    style,
    original: auditView(classes, extractBackground(style)),
    remediated: undefined,
    drawable: hasInlineData(style),
    bounds: inlineBounds(style),
  };
}

/** Put a worked-out palette back into the style and audit the result. */
function buildRemediated(
  loaded: Loaded,
  palette: ReadonlyArray<{ classId: string; remediated: RGB }>,
): Remediated {
  const wanted = new Map(palette.map((entry) => [entry.classId, entry.remediated] as const));
  const applied = applyPalette(loaded.style, wanted);
  // Audited by reading the rewritten style back, rather than by recolouring the
  // classes in memory: what the panel reports is then exactly what the file a
  // reader downloads will paint.
  const classes = extractClasses(applied.style);
  return {
    view: auditView(classes, extractBackground(applied.style)),
    style: applied.style,
    changed: applied.changed.length,
  };
}

/* ------------------------------------------------------------------ *
 * The mode
 * ------------------------------------------------------------------ */

export function createUpload(options: UploadOptions): Upload {
  const state: UploadState = {
    loaded: undefined,
    reading: false,
    remediating: false,
    error: undefined,
    variant: 'original',
    activePair: undefined,
    activeClassId: undefined,
    showAllClashes: false,
  };

  /** Bumped per file, so a slow worker's answer about an old file is dropped. */
  let generation = 0;

  /** The map, when this mode holds the container and has data to draw. */
  let drawn: UploadedMap | undefined;

  const releaseMap = (): void => {
    drawn?.destroy();
    drawn = undefined;
  };

  /**
   * Draw the loaded style, if it brought data and we hold the container.
   *
   * Called both when a file arrives and when the shell hands the container
   * back after a demo has had it, so the map comes back on returning here.
   */
  const claimMap = (): void => {
    const loaded = state.loaded;
    if (drawn !== undefined || loaded === undefined || !loaded.drawable) {
      return;
    }
    drawn = createUploadedMap({
      container: options.mapEl,
      sidebar: options.sidebar,
      style: activeStyle(loaded),
      bounds: loaded.bounds,
    });
  };

  const reset = (): void => {
    releaseMap();
    generation += 1;
    state.loaded = undefined;
    state.reading = false;
    state.remediating = false;
    state.error = undefined;
    state.variant = 'original';
    state.activePair = undefined;
    state.activeClassId = undefined;
    state.showAllClashes = false;
  };

  /** Drop this style and go back for another. */
  const startOver = (): void => {
    reset();
    options.onLeave();
  };

  /** Work out the accessible palette, off the main thread where possible. */
  const startRemediation = (loaded: Loaded): void => {
    const token = generation;
    state.remediating = true;

    const finish = (
      palette: ReadonlyArray<{ classId: string; remediated: RGB }>,
    ): void => {
      if (token !== generation) {
        return;
      }
      state.remediating = false;
      try {
        loaded.remediated = buildRemediated(loaded, palette);
      } catch (error) {
        state.error = `The accessible palette could not be written back: ${messageOf(error)}`;
      }
      options.rerender();
    };

    let worker: Worker | undefined;
    try {
      worker = new Worker(new URL('./remediate.worker.ts', import.meta.url), {
        type: 'module',
      });
    } catch (error) {
      console.warn('[upload] no worker available:', error);
    }

    if (worker === undefined) {
      // Last resort: this blocks the page while it runs, but a palette the
      // reader waited for beats no palette at all.
      setTimeout(() => {
        finish(
          generateAccessiblePalette(loaded.original.classes, {
            background: loaded.original.background,
          }),
        );
      }, 0);
      return;
    }

    const running = worker;
    running.addEventListener('message', (event) => {
      finish((event as MessageEvent<RemediateReply>).data.palette);
      running.terminate();
    });
    running.addEventListener('error', (event) => {
      console.error('[upload] remediation failed:', event.message);
      running.terminate();
      if (token !== generation) {
        return;
      }
      state.remediating = false;
      state.error =
        'The accessible palette could not be worked out. The audit above still stands.';
      options.rerender();
    });
    const request: RemediateRequest = {
      classes: loaded.original.classes,
      background: loaded.original.background,
    };
    running.postMessage(request);
  };

  /** Take a style's text, whatever it came from, and audit it. */
  const accept = (fileName: string, text: string): void => {
    reset();
    try {
      const loaded = readStyle(fileName, text);
      state.loaded = loaded;
      claimMap();
      startRemediation(loaded);
      options.rerender();
    } catch (error) {
      state.error = messageOf(error);
      options.rerender();
    }
  };

  const openFile = (file: File): void => {
    if (file.size > MAX_BYTES) {
      reset();
      state.error = `That file is ${(file.size / 1024 / 1024).toFixed(0)} MB. A style this large is probably not a style.`;
      options.rerender();
      return;
    }
    reset();
    state.reading = true;
    options.rerender();
    void file
      .text()
      .then((text) => {
        accept(file.name, text);
      })
      .catch((error: unknown) => {
        reset();
        state.error = `That file could not be read: ${messageOf(error)}`;
        options.rerender();
      });
  };

  /** The style the map should be painting: whichever palette is on show. */
  const activeStyle = (loaded: Loaded): unknown =>
    state.variant === 'accessible' && loaded.remediated !== undefined
      ? loaded.remediated.style
      : loaded.style;

  /** The audit the panel is currently showing. */
  const activeView = (loaded: Loaded): AuditView =>
    state.variant === 'accessible' && loaded.remediated !== undefined
      ? loaded.remediated.view
      : loaded.original;

  const showVariant = (variant: UploadVariant): void => {
    if (state.variant === variant) {
      return;
    }
    state.variant = variant;
    state.activePair = undefined;
    state.showAllClashes = false;
    // Only the paint colours differ, and setStyle keeps the camera, so the
    // map recolours in place rather than jumping.
    if (state.loaded !== undefined) {
      drawn?.setStyle(activeStyle(state.loaded));
    }
    options.rerender();
  };

  const selectClass = (id: string): void => {
    state.activeClassId = state.activeClassId === id ? undefined : id;
    state.activePair = undefined;
    options.rerender();
  };

  const selectPair = (pair: AuditPair): void => {
    state.activePair = pair;
    state.activeClassId = pair.classA.id;
    options.rerender();
    // The grid has just been rebuilt, so the card exists by the next frame.
    requestAnimationFrame(() => {
      document
        .querySelector('.grid-card.is-active')
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  };

  return {
    open: accept,
    openFile,
    claimMap,
    releaseMap,
    isLoaded: () => state.loaded !== undefined || state.reading,
    view(mode) {
      if (state.loaded === undefined) {
        // Only reachable while a dropped file is still being read: the landing
        // page is what takes a file, and it opens this view once there is one.
        return {
          caption: 'Your map',
          header: [],
          score: [],
          body: [readingPanel(state), ...errorPanels(state.error)],
          cover: [el('div', 'cover-wait')],
          vision: false,
        };
      }

      const loaded = state.loaded;
      const view = activeView(loaded);
      const { remediated } = loaded;

      const body: HTMLElement[] = [
        filePanel(loaded, view, startOver),
        clashPanel({
          view,
          label: humaniseClassId,
          activePair: state.activePair,
          showAll: state.showAllClashes,
          onPair: selectPair,
          onToggleAll: () => {
            state.showAllClashes = !state.showAllClashes;
            options.rerender();
          },
        }),
      ];

      if (state.remediating) {
        body.push(workingPanel(loaded.original.classes.length));
      }
      body.push(...errorPanels(state.error));

      if (remediated !== undefined && state.variant === 'accessible') {
        body.push(changedPanel(loaded.original, remediated.view, mode));
      }

      body.push(
        downloadsPanel({
          source: loaded.fileName,
          before: loaded.original,
          after: remediated?.view,
          extra: remediated === undefined ? [] : exportButtons(loaded, remediated),
        }),
        funFactPanel(),
      );

      return {
        caption:
          state.variant === 'accessible' && remediated !== undefined
            ? `${loaded.fileName} · accessible palette`
            : loaded.fileName,
        header: [
          ...(remediated === undefined
            ? []
            : [
                toggleButton({
                  label:
                    state.variant === 'original'
                      ? 'Show accessible version'
                      : 'Show original',
                  pressed: state.variant === 'accessible',
                  onToggle: () => {
                    showVariant(state.variant === 'original' ? 'accessible' : 'original');
                  },
                }),
              ]),
          ...(state.remediating
            ? [el('p', 'variant-hint', 'Working out an accessible palette…')]
            : []),
        ],
        score: [
          scoreCard(
            view,
            state.variant === 'accessible' ? loaded.original : undefined,
          ),
        ],
        body,
        // A style that brought its data gets a map, and the shell leaves the
        // map area uncovered; one that did not gets the colours themselves.
        cover: loaded.drawable
          ? []
          : [
              swatchGrid({
                view,
                mode,
                fileName: loaded.fileName,
                activeClassId: state.activeClassId,
                onClass: selectClass,
                onReset: startOver,
              }),
            ],
        vision: true,
      };
    },
  };
}

/* ------------------------------------------------------------------ *
 * The swatch grid: what stands in for a map
 * ------------------------------------------------------------------ */

interface SwatchGridOptions {
  view: AuditView;
  mode: VisionMode;
  fileName: string;
  activeClassId: string | undefined;
  onClass: (id: string) => void;
  onReset: () => void;
}

/**
 * Every colour the style paints, as a labelled card.
 *
 * The large chip carries the colour as authored and is recoloured by the page's
 * CVD filter, exactly as the map is in the other mode, so the two modes agree
 * about what a dichromatic reader sees. The four small chips below it are
 * computed with `simulateCVD` and are never filtered: they are there to be
 * compared against each other, and the labels beside them have to stay
 * readable while the rest of the card is being simulated.
 */
function swatchGrid(options: SwatchGridOptions): HTMLElement {
  const { view } = options;
  const partners = clashPartners(view.audit);
  const highlighted =
    options.activeClassId === undefined
      ? undefined
      : (partners.get(options.activeClassId) ?? new Set<string>());

  const wrap = el('div', 'cover-inner');

  const head = el('div', 'grid-head');
  const headText = el('div');
  headText.append(el('p', 'grid-title', options.fileName));
  const clashing = partners.size;
  headText.append(
    el(
      'p',
      'grid-sub',
      `${String(view.classes.length)} colours · ${
        clashing === 0 ? 'none confusable' : `${String(clashing)} caught up in a clash`
      } · previewing ${VISION_MODE_LABELS[options.mode].toLowerCase()}`,
    ),
  );
  head.append(headText);

  const another = el('button', 'secondary-button grid-another', 'Audit another file');
  another.type = 'button';
  another.addEventListener('click', options.onReset);
  head.append(another);
  wrap.append(head);

  wrap.append(
    el(
      'p',
      'grid-note',
      'Each card: the colour as painted, then how it reads to normal (N), red-blind (P), ' +
        'green-blind (D) and blue-yellow blind (T) viewers. Pick one to see its clashes.',
    ),
  );

  const list = el('ul', 'grid');
  for (const cls of view.classes) {
    list.append(gridCard(cls, view, options, partners, highlighted));
  }
  wrap.append(list);
  return wrap;
}

function gridCard(
  cls: MapClass,
  view: AuditView,
  options: SwatchGridOptions,
  partners: ReadonlyMap<string, Set<string>>,
  highlighted: ReadonlySet<string> | undefined,
): HTMLElement {
  const item = el('li', 'grid-item');
  const clashes = partners.get(cls.id)?.size ?? 0;
  const isActive = options.activeClassId === cls.id;
  const isPartner = highlighted?.has(cls.id) === true;

  const card = el(
    'button',
    ['grid-card', isActive ? 'is-active' : '', isPartner ? 'is-partner' : '']
      .filter((name) => name !== '')
      .join(' '),
  );
  card.type = 'button';
  card.dataset['classId'] = cls.id;

  const authored = seenColor(cls, view.background, 'normal');
  const name = humaniseClassId(cls);
  card.title =
    clashes === 0
      ? name
      : `${name} — confusable with ${String(clashes)} other ${
          clashes === 1 ? 'colour' : 'colours'
        }`;

  const chip = el('span', 'grid-chip');
  chip.style.background = rgbToHex(authored);
  card.append(chip);

  const text = el('span', 'grid-card-text');
  text.append(el('span', 'grid-name', name));
  card.append(text);

  const sims = el('span', 'grid-sims');
  for (const simMode of VISION_MODES) {
    const sim = el('span', 'grid-sim');
    sim.title = `${name} — ${VISION_MODE_LABELS[simMode]}`;
    const simChip = el('span', 'grid-sim-chip');
    simChip.style.background = rgbToHex(seenColor(cls, view.background, simMode));
    sim.append(simChip, el('span', 'grid-sim-label', MODE_KEYS[simMode]));
    sims.append(sim);
  }
  card.append(sims);

  if (clashes > 0) {
    const badge = el('span', 'grid-badge');
    badge.append(
      el('span', 'grid-badge-glyph', '⚠'),
      el('span', undefined, String(clashes)),
    );
    card.append(badge);
  }

  card.addEventListener('click', () => {
    options.onClass(cls.id);
  });
  item.append(card);
  return item;
}

/* ------------------------------------------------------------------ *
 * Upload-only panels
 * ------------------------------------------------------------------ */

function readingPanel(state: UploadState): HTMLElement {
  const section = el('section', 'panel');
  section.append(el('h2', 'panel-title', 'Your map'));
  section.append(
    el(
      'p',
      'cta-text',
      state.reading ? 'Reading your style…' : 'Waiting for a style to audit.',
    ),
  );
  return section;
}

function errorPanels(error: string | undefined): HTMLElement[] {
  if (error === undefined) {
    return [];
  }
  const section = el('section', 'panel');
  section.append(el('h2', 'panel-title', 'That did not work'));
  section.append(el('p', 'error', error));
  return [section];
}

function workingPanel(count: number): HTMLElement {
  const section = el('section', 'panel');
  section.append(el('h2', 'panel-title', 'Accessible palette'));
  section.append(
    el(
      'p',
      'note',
      `Spreading ${String(count)} colours through lightness, in a background thread.`,
    ),
  );
  return section;
}

/** What the audit says about the file itself. */
function filePanel(loaded: Loaded, view: AuditView, onReset: () => void): HTMLElement {
  const section = el('section', 'panel');
  section.append(el('h2', 'panel-title', 'File'));
  section.append(el('p', 'file-name', loaded.fileName));
  section.append(
    el(
      'p',
      'secondary-hint',
      `${String(view.classes.length)} colours read from ${String(
        (loaded.style as { layers: unknown[] }).layers.length,
      )} layers · audited in this browser, nothing uploaded`,
    ),
  );
  const button = el('button', 'secondary-button', 'Audit another file');
  button.type = 'button';
  button.addEventListener('click', onReset);
  section.append(button);
  return section;
}

/** The reader's own style, recoloured, for the shared Downloads card. */
function exportButtons(loaded: Loaded, remediated: Remediated): HTMLElement[] {
  const button = el('button', 'secondary-button', 'Download fixed style');
  button.type = 'button';
  button.addEventListener('click', () => {
    download(
      remediatedName(loaded.fileName),
      JSON.stringify(remediated.style, null, 2) + '\n',
      'application/json',
    );
  });
  return [
    button,
    el(
      'p',
      'secondary-hint',
      `Your own file with ${String(remediated.changed)} colours replaced; nothing else touched.`,
    ),
  ];
}

/** `city.json` comes back as `city.remediated.json`. */
function remediatedName(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot <= 0
    ? `${fileName}.remediated.json`
    : `${fileName.slice(0, dot)}.remediated${fileName.slice(dot)}`;
}
