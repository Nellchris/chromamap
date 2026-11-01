/**
 * The shell: a landing page, and an audit view behind it.
 *
 * A visitor lands on an explanation and two ways in - their own style, or one
 * of two real maps. Choosing any of them swaps to the audit view, which is the
 * same panel over the same engine whichever route got there: a map for the
 * demos, a grid of swatches for a style we have colours for but no data.
 *
 * The two screens are sections of one document rather than two pages, and the
 * back button is wired through `history.pushState` so leaving the audit view
 * works the way a reader expects. The URL itself does not change: a direct
 * load is always the landing page, which is what someone arriving at a link
 * should see.
 */

import { VISION_MODE_LABELS, type VisionMode } from '@carto-a11y/core';

import { visionPanel, type ModeView } from './audit-view.js';
import { createDemo, DEMOS, type Demo, type DemoKey } from './demo.js';
import { isSheetLayout } from './map.js';
import { el, installFilters } from './dom.js';
import { renderLanding } from './landing.js';
import { createUpload, type Upload } from './upload.js';

/** What the audit view is currently showing. */
type Target = DemoKey | 'upload';

/** The history entry an audit view pushes. */
interface AuditHistoryState {
  readonly carto: 'audit';
  readonly target: Target;
}

function isAuditState(value: unknown): value is AuditHistoryState {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { carto?: unknown }).carto === 'audit'
  );
}

/** Where the audit panel renders: a fixed header, a body, and the map area. */
interface Mounts {
  landing: HTMLElement;
  audit: HTMLElement;
  back: HTMLElement;
  variant: HTMLElement;
  score: HTMLElement;
  body: HTMLElement;
  captionTitle: HTMLElement;
  captionMode: HTMLElement;
  cover: HTMLElement;
}

export async function startApp(root: HTMLElement): Promise<void> {
  const find = (id: string): HTMLElement | null => root.querySelector<HTMLElement>(id);
  const mounts: Mounts | undefined = (() => {
    const parts = {
      landing: find('#landing'),
      audit: find('#audit'),
      back: find('#back'),
      variant: find('#variant-mount'),
      score: find('#score-mount'),
      body: find('#sidebar-scroll'),
      captionTitle: find('#map-caption-title'),
      captionMode: find('#map-caption-mode'),
      cover: find('#cover'),
    };
    return Object.values(parts).every((part) => part !== null)
      ? (parts as Mounts)
      : undefined;
  })();
  const mapEl = find('#map');
  const sidebar = find('#sidebar');
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

  let view: 'landing' | 'audit' = 'landing';
  let target: Target = 'hawaii';
  let mode: VisionMode = 'normal';
  /** The demo whose map currently owns the container, if any. */
  let active: { key: DemoKey; demo: Demo } | undefined;
  /** Which of the three things is holding the map container. */
  let held: Target | undefined;
  let loading: DemoKey | undefined;
  let demoError: string | undefined;

  const renderAudit = (): void => {
    const source: ModeView | undefined =
      target === 'upload'
        ? upload.view(mode)
        : active?.key === target
          ? active.demo.view(mode)
          : undefined;

    if (source === undefined) {
      mounts.variant.replaceChildren();
      mounts.score.replaceChildren();
      mounts.body.replaceChildren(
        demoError === undefined
          ? el('p', 'loading', 'Loading the map…')
          : errorPanel(demoError),
      );
      mounts.captionTitle.textContent =
        target === 'upload' ? 'Your map' : DEMOS[target].title;
      mounts.captionMode.hidden = true;
      mounts.cover.replaceChildren();
      mounts.cover.hidden = true;
      mapEl.style.filter = '';
      return;
    }

    mounts.variant.replaceChildren(...source.header);
    mounts.score.replaceChildren(...source.score);
    mounts.body.replaceChildren(
      ...(source.vision
        ? [
            visionPanel(mode, (next) => {
              mode = next;
              renderAudit();
            }),
          ]
        : []),
      ...source.body,
    );

    mounts.captionTitle.textContent = source.caption;
    // The caption only speaks up when what is shown is not normal vision.
    if (mode === 'normal') {
      mounts.captionMode.textContent = '';
      mounts.captionMode.hidden = true;
    } else {
      mounts.captionMode.textContent = `Previewing: ${VISION_MODE_LABELS[mode]}`;
      mounts.captionMode.hidden = false;
    }

    mounts.cover.replaceChildren(...source.cover);
    mounts.cover.hidden = source.cover.length === 0;
    // The swatch grid is simulated by the same filters the map is, so the two
    // cannot disagree about what a dichromatic reader sees.
    mounts.cover.dataset['vision'] = mode;
    mapEl.style.filter =
      source.cover.length === 0 && mode !== 'normal' ? `url(#cvd-${mode})` : '';
  };

  const upload: Upload = createUpload({
    mapEl,
    sidebar,
    rerender: renderAudit,
    onLeave: () => {
      goHome(true);
    },
  });

  /**
   * Hand the map container to whoever is about to use it.
   *
   * There is one `#map` on the page and three things that might want it - two
   * demos and an uploaded style that carries its own data. Whoever had it
   * last gives it up first: two live maps on one element leaves a canvas
   * neither of them owns.
   */
  const claimMapFor = (next: Target): void => {
    if (held === next) {
      return;
    }
    if (held === 'upload') {
      upload.releaseMap();
    } else if (held !== undefined) {
      active?.demo.destroy();
      active = undefined;
    }
    held = next;
    if (next === 'upload') {
      upload.claimMap();
    }
  };

  /** Show whichever screen `view` names, and nothing of the other. */
  const paint = (): void => {
    root.dataset['view'] = view;
    mounts.landing.hidden = view !== 'landing';
    mounts.audit.hidden = view !== 'audit';
    if (view === 'audit') {
      renderAudit();
    }
  };

  /** Load a demo the first time it is opened; afterwards it is already here. */
  const openDemo = (key: DemoKey): void => {
    if (active?.key === key || loading === key) {
      return;
    }
    claimMapFor(key);
    loading = key;
    demoError = undefined;
    void createDemo({ spec: DEMOS[key], mapEl, sidebar, rerender: renderAudit })
      .then((demo) => {
        active = { key, demo };
      })
      .catch((error: unknown) => {
        demoError = error instanceof Error ? error.message : String(error);
        console.error('[demo]', error);
      })
      .finally(() => {
        loading = undefined;
        if (view === 'audit') {
          renderAudit();
        }
      });
  };

  /**
   * Move to the audit view.
   *
   * The history entry carries the target but leaves the URL alone, so Back
   * returns to the landing page and a fresh load of the same address starts
   * there too.
   */
  const show = (next: Target): void => {
    target = next;
    mode = 'normal';
    view = 'audit';
    const state: AuditHistoryState = { carto: 'audit', target: next };
    history.pushState(state, '');
    if (next === 'upload') {
      claimMapFor('upload');
    } else {
      openDemo(next);
    }
    paint();
    mounts.body.scrollTop = 0;
    // A sheet starts at its resting height, showing the score with the map
    // still in view; a column beside the map costs the map nothing, so it
    // starts open.
    root.dataset['sidebar'] = isSheetLayout() ? 'closed' : 'open';
    for (const button of [collapse, handle]) {
      button.setAttribute('aria-expanded', String(!isSheetLayout()));
    }
  };

  const goHome = (push: boolean): void => {
    view = 'landing';
    if (push) {
      history.pushState(null, '');
    }
    paint();
  };

  mounts.back.addEventListener('click', (event) => {
    event.preventDefault();
    // Prefer the real history entry, so Back and the link agree.
    if (isAuditState(history.state)) {
      history.back();
    } else {
      goHome(false);
    }
  });

  window.addEventListener('popstate', (event) => {
    if (isAuditState(event.state)) {
      target = event.state.target;
      view = 'audit';
      if (target === 'upload') {
        claimMapFor('upload');
      } else {
        openDemo(target);
      }
      paint();
      return;
    }
    goHome(false);
  });

  renderLanding(mounts.landing, {
    onDemo: (key) => {
      show(key);
    },
    onFile: (file) => {
      upload.openFile(file);
      show('upload');
    },
  });

  paint();
  return Promise.resolve();
}

/** A demo could not load; the rest of the tool still works. */
function errorPanel(message: string): HTMLElement {
  const section = el('section', 'panel');
  section.append(el('h2', 'panel-title', 'This map could not load'));
  section.append(el('p', 'error', message));
  section.append(
    el('p', 'secondary-hint', 'Go back and try the other demo, or audit a style of your own.'),
  );
  return section;
}
