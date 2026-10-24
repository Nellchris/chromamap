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

The engine ships its first real module, `packages/core/src/color/wcag.ts`:
sRGB linearisation, WCAG 2.1 relative luminance and contrast ratio, with tests
in `packages/core/test/color/wcag.test.ts`.

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
