# ChromaMap

A web-map accessibility and colour-vision auditing tool: check map styles for
WCAG contrast, colour-vision-deficiency confusion and legibility problems
before they ship.

## Layout

| Path                 | Package              | Role                                      |
| -------------------- | -------------------- | ----------------------------------------- |
| `packages/core`      | `@carto-a11y/core`   | The auditing engine. Pure, no DOM.        |
| `packages/cli`       | `@carto-a11y/cli`    | `carto-a11y` command line. Uses core.     |
| `packages/adapters`  | `@carto-a11y/adapters` | Loaders for styles, tiles and vectors.  |
| `apps/web`           | `@carto-a11y/web`    | Vite + TypeScript browser UI. Uses core.  |
| `demos/nyc-zoning`   | —                    | Manhattan zoning, from NYC Open Data.     |
| `demos/hawaii`       | —                    | Sample data and styles for demos.         |
| `scripts`            | —                    | Repo maintenance scripts.                 |
| `docs`               | —                    | Design notes and references.              |

## Requirements

- Node 22 or newer
- pnpm 10 (`corepack enable pnpm`, or run commands as `corepack pnpm …`)

## Commands

```bash
pnpm install     # install the workspace
pnpm test        # vitest across every package
pnpm lint        # strict typecheck across every package
pnpm build       # compile packages/* to dist/
pnpm dev         # start the web UI (needs vite, see below)
```

Audit a style:

```bash
pnpm build && node packages/cli/bin/carto-a11y.js audit packages/cli/test/fixtures/test-style.json
```

```
✓ 5 pairs pass (dE ≥ 10 in all modes)
✗ 1 pair FAILS

Failing pairs:
  parks ↔ industrial  protan  dE=0.19  contrast=1.01:1
```

`--format json|html` swaps the summary for a machine-readable report or a
self-contained HTML page with swatches and a vision-mode preview; `--output`
writes it to a file. `--threshold`, `--background` and `--modes` tune the
audit. The command exits 0 when nothing is confusable, 1 when something is,
and 2 when it could not run — so it drops into CI as a check.

## The Hawaiʻi demo

```bash
pnpm install && pnpm dev     # http://localhost:5173
```

The official USGS geological map of Hawaiʻi Island — Scientific Investigations
Map 3143 (Sherrod and others, 2021) — audited live in the browser. 97 map
units, 100 colours, and 1,295 confusable pairs, drawn over a deliberately grey
basemap. Click any unit for its name, age and rock type. Switch the sidebar to
Protanopia and the flow-by-flow distinctions the map depends on disappear.

Then press **Show accessible version**: the same layers and the same
data, repaletted, which takes 1,295 clashes down to 835. It does not reach
zero, and cannot: see [demos/hawaii](demos/hawaii) for why, and for what the
audit found in the published sheet before colour blindness is even considered.

The same style from the command line:

```bash
pnpm build && node packages/cli/bin/carto-a11y.js audit demos/hawaii/styles/baseline.json
```

## State of the scaffold

The colour layer, under `packages/core/src/color/`:

- `wcag.ts` — sRGB linearisation, WCAG 2.1 relative luminance, contrast ratio
- `parse.ts` — hex, `rgb()`/`rgba()` and all 148 CSS Color 4 named colours
- `lab.ts` — sRGB → XYZ (D65) → CIELAB, and CIEDE2000 perceptual distance
- `cvd.ts` — Machado et al. (2009) dichromacy simulation at severity 1.0

The audit pipeline on top of it:

- `style/extract.ts` — `extractClasses`: the colours a MapLibre style paints,
  one `MapClass` per layer or `match` branch
- `audit/composite.ts` — `compositeOver`: source-over blending for translucent
  layers
- `audit/engine.ts` — `runAudit`: composite, simulate each vision mode, then
  compare every class pair by CIEDE2000 and WCAG contrast

```ts
import { extractClasses, runAudit } from '@carto-a11y/core';

const { failing, summary } = runAudit(extractClasses(style));
// summary.byMode.protan === 1 → one pair of classes collapses for protanopia
```

Reference values are checked against published sources where they exist
(Sharma et al. for CIEDE2000, the CSS spec for named colours).

`apps/web` is a Vite + TypeScript app with no framework. A landing page offers
two real maps — the Hawaiʻi geology and Manhattan's zoning — and a drop zone for
a file of the reader's own. Whatever route is taken, the engine runs in the
browser on the very style being drawn, so the panel and the map cannot disagree.

An uploaded file is read with the File API and never leaves the browser. Three
things can arrive:

- **A style carrying its data inline** — drawn as a real map, over the same grey
  basemap the demos use, with its URL-only sources left unfetched.
- **A style naming its data by URL** — the colours themselves become the view:
  one labelled swatch per class, each shown as it reads to normal, protan,
  deutan and tritan vision, with a badge wherever a colour collides.
- **A bare GeoJSON file** — wrapped in a generated style and sent down the first
  path, rather than through a pipeline of its own. The colours audited are the
  file's own simplestyle `fill`/`stroke`/`marker-color` where it has them, a
  palette keyed to a categorical property where it does not, and a single
  default otherwise; the panel says which.

Vision-mode preview is an SVG `feColorMatrix` filter — over the map container
in one case, over the swatches in the other — built from the same Machado
matrices `simulateCVD` uses.

`scripts/fetch-hawaii.ts` runs on Node 24 directly — no loader, no build step —
because Node strips the types itself.

## Licence

MIT — see [LICENSE](LICENSE).
