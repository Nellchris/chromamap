/**
 * The shell: one tool, two modes.
 *
 * "Hawaiʻi Demo" is a real geological map, audited live. "Your Map" audits a
 * MapLibre style the reader brings themselves. Both are the same engine over
 * the same panel - a score, the worst clashes, a vision-mode preview - and the
 * shell's whole job is to own the page and hand the active mode the three
 * places it can render into, plus the area beside the panel.
 *
 * Which mode supplies what is in `ModeView`; the modes themselves are in
 * `demo.ts` and `upload.ts` and know nothing about each other.
 */

import { VISION_MODE_LABELS, type VisionMode } from '@carto-a11y/core';

import { howItWorksPanel, visionPanel, type ModeView } from './audit-view.js';
import { createDemo, isSheetLayout, type Demo } from './demo.js';
import { el, installFilters, segmented, type Segment } from './dom.js';
import { createUpload } from './upload.js';

type Tab = 'demo' | 'upload';

/** The demo lands first: it is the thing worth seeing without a file to hand. */
const TABS: ReadonlyArray<Segment<Tab>> = [
  { key: 'demo', label: 'Hawaiʻi Demo' },
  { key: 'upload', label: 'Your Map' },
];

/** Where the panel renders: a fixed header, a scrolling body, and the map area. */
interface Mounts {
  tabs: HTMLElement;
  variant: HTMLElement;
  score: HTMLElement;
  body: HTMLElement;
  captionTitle: HTMLElement;
  captionMode: HTMLElement;
  cover: HTMLElement;
}

export async function startApp(root: HTMLElement): Promise<void> {
  const mounts: Mounts | undefined = (() => {
    const tabs = root.querySelector<HTMLElement>('#tabs-mount');
    const variant = root.querySelector<HTMLElement>('#variant-mount');
    const score = root.querySelector<HTMLElement>('#score-mount');
    const body = root.querySelector<HTMLElement>('#sidebar-scroll');
    const captionTitle = root.querySelector<HTMLElement>('#map-caption-title');
    const captionMode = root.querySelector<HTMLElement>('#map-caption-mode');
    const cover = root.querySelector<HTMLElement>('#cover');
    return tabs && variant && score && body && captionTitle && captionMode && cover
      ? { tabs, variant, score, body, captionTitle, captionMode, cover }
      : undefined;
  })();
  const mapEl = root.querySelector<HTMLElement>('#map');
  const sidebar = root.querySelector<HTMLElement>('#sidebar');
  const collapse = root.querySelector<HTMLButtonElement>('#sidebar-toggle');
  const handle = root.querySelector<HTMLButtonElement>('#sheet-handle');
  if (
    mounts === undefined ||
    mapEl === null ||
    sidebar === null ||
    collapse === null ||
    handle === null
  ) {
    throw new Error('the page shell is missing an element the app needs');
  }

  installFilters();

  // One control on desktop (the chevron), another on narrow screens (the sheet
  // handle); both do the same thing.
  const toggleSidebar = (): void => {
    const open = root.dataset['sidebar'] !== 'closed';
    root.dataset['sidebar'] = open ? 'closed' : 'open';
    for (const button of [collapse, handle]) {
      button.setAttribute('aria-expanded', String(!open));
    }
  };
  collapse.addEventListener('click', toggleSidebar);
  handle.addEventListener('click', toggleSidebar);

  // A sheet starts at its resting height, showing the score and the switch
  // with the map still in view; a reader pulls it up for the detail. A column
  // beside the map starts open, since it costs the map nothing.
  if (isSheetLayout()) {
    root.dataset['sidebar'] = 'closed';
    for (const button of [collapse, handle]) {
      button.setAttribute('aria-expanded', 'false');
    }
  }

  let tab: Tab = 'demo';
  let mode: VisionMode = 'normal';
  let demo: Demo | undefined;
  let demoError: string | undefined;

  const render = (): void => {
    root.dataset['tab'] = tab;
    mounts.tabs.replaceChildren(
      segmented({
        segments: TABS,
        active: tab,
        ariaLabel: 'Which map to audit',
        onSelect: (next) => {
          if (tab === next) {
            return;
          }
          tab = next;
          render();
          // A reader who has just changed what they are looking at should not
          // land halfway down the previous mode's panel.
          mounts.body.scrollTop = 0;
        },
        extraClass: 'tabs',
      }),
    );

    const view: ModeView | undefined =
      tab === 'demo' ? demo?.view(mode) : upload.view(mode);

    if (view === undefined) {
      // The demo's style and geology are still loading, or failed to.
      mounts.variant.replaceChildren();
      mounts.score.replaceChildren();
      mounts.body.replaceChildren(
        demoError === undefined
          ? el('p', 'loading', 'Loading the Hawaiʻi demo…')
          : demoErrorPanel(demoError),
      );
      mounts.captionTitle.textContent = 'Hawaiʻi Geological Map';
      mounts.captionMode.hidden = true;
      mounts.cover.replaceChildren();
      mounts.cover.hidden = true;
      mapEl.style.filter = '';
      return;
    }

    mounts.variant.replaceChildren(...view.header);
    mounts.score.replaceChildren(...view.score);
    mounts.body.replaceChildren(
      // Both modes get the same three lines about what is being measured,
      // above everything they have to say about one particular map.
      howItWorksPanel(),
      ...(view.vision
        ? [
            visionPanel(mode, (next) => {
              mode = next;
              render();
            }),
          ]
        : []),
      ...view.body,
    );

    mounts.captionTitle.textContent = view.caption;
    // The caption only speaks up when what is shown is not normal vision.
    if (mode === 'normal') {
      mounts.captionMode.textContent = '';
      mounts.captionMode.hidden = true;
    } else {
      mounts.captionMode.textContent = `Previewing: ${VISION_MODE_LABELS[mode]}`;
      mounts.captionMode.hidden = false;
    }

    mounts.cover.replaceChildren(...view.cover);
    mounts.cover.hidden = view.cover.length === 0;
    // The swatch grid is simulated by the same filters the map is, so the two
    // modes cannot disagree about what a dichromatic reader sees.
    mounts.cover.dataset['vision'] = mode;
    mapEl.style.filter = view.cover.length === 0 && mode !== 'normal' ? `url(#cvd-${mode})` : '';
  };

  const upload = createUpload({ rerender: render });

  render();

  try {
    demo = await createDemo({
      mapEl,
      sidebar,
      rerender: render,
      onAuditOwnMap: () => {
        tab = 'upload';
        render();
        mounts.body.scrollTop = 0;
      },
    });
  } catch (error) {
    demoError = error instanceof Error ? error.message : String(error);
    console.error('[demo]', error);
  }
  render();
}

/** The demo could not load; "Your Map" still can, so say so rather than dying. */
function demoErrorPanel(message: string): HTMLElement {
  const section = el('section', 'panel');
  section.append(el('h2', 'panel-title', 'The demo could not load'));
  section.append(el('p', 'error', message));
  section.append(
    el(
      'p',
      'secondary-hint',
      'The “Your Map” tab does not need the demo data and should still work.',
    ),
  );
  return section;
}
