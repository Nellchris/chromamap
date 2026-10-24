# CartoAccessibility-Studio

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

Try the engine through the CLI:

```bash
pnpm build && node packages/cli/bin/carto-a11y.js contrast '#767676' '#ffffff'
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

`apps/web` is scaffolded (entry HTML, `src/main.ts`, `vite.config.ts`) but
**vite is not installed yet** — the dependency list is deliberately limited to
`typescript` and `vitest`. `pnpm dev` and `pnpm build` inside `apps/web` start
working after:

```bash
corepack pnpm add -D vite --filter @carto-a11y/web
```

Root `pnpm build` only builds `packages/*`, so it is unaffected.

## Licence

MIT — see [LICENSE](LICENSE).
