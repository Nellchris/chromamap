# Architecture

## Package boundaries

- **`@carto-a11y/core`** — the engine. Pure functions and plain data only: no
  DOM, no filesystem, no network. This is what makes the same audit runnable in
  the CLI, in a browser worker and in CI.
- **`@carto-a11y/adapters`** — everything that reads the outside world. Turns
  style JSON, GeoJSON and tile samples into the structures core audits. Depends
  on nothing in the workspace.
- **`@carto-a11y/cli`** — argument parsing and report formatting. `src/` stays
  Node-global-free so it is testable; `bin/carto-a11y.js` is the only file that
  touches `process` and `node:fs`. Commands that need the filesystem take a
  `CliIo` instead of importing it, which is how `audit` reads a style and
  writes a report while the tests use an in-memory stand-in.
- **`@carto-a11y/web`** — the browser UI. Imports core directly; TypeScript
  resolves it to core's sources through `paths` and Vite through an alias, so
  there is no build step between editing the engine and seeing the map change.
  It serves `demos/hawaii` as its `publicDir`, which means the app, the CLI and
  the repo all read the same style file, and the style's own relative source
  URL keeps working.

Dependency direction is one-way: `cli` and `web` depend on `core`; `core`
depends on nothing.

## Inside core

Core is layered, and each layer only reaches downwards:

- `color/` — the maths. `wcag` (luminance, contrast), `parse` (CSS colour
  strings), `lab` (CIELAB, CIEDE2000) and `cvd` (dichromacy simulation).
- `style/` — reads a MapLibre style and hands back a flat list of `MapClass`
  values, and writes a palette back into one. Static only: it never evaluates a
  data expression, and skips what it cannot resolve rather than guessing.
- `audit/` — `compositeOver` flattens opacity onto a background, and `runAudit`
  walks the class list pairwise under each vision mode.
- `export/` — turns one audit into a JSON document or a self-contained HTML
  page. Both read the same `ReportData`, so they can never disagree.

So a style audit is a pipeline: `extractClasses` → `compositeOver` →
`simulateCVD` → `ciede2000` / `contrastRatio`. Each step is exported on its
own, because the web UI needs the intermediate values (what a swatch looks like
under deuteranopia) and not just the verdict.

## One source for the style walk

`extractClasses` names every colour it finds — `units/Qkh`, `roads:line` — and
everything downstream, the audit and the remediated palette alike, is keyed by
those names. `applyPalette` has to find the same colours again to write new
ones back, so both go through the single walk in `style/slots.ts` rather than
each implementing its own. An id extraction can produce is therefore always an
id the rewriter can place, and `applyPalette`'s `missing` list means what it
says: this style has no such class.

That is what lets the web UI hand a reader their own style file back, rewritten
and otherwise byte-for-byte their own, and `scripts/remediate-hawaii.ts` build
the demo's accessible style the same way.

## One source for the simulation

The dichromacy matrices in `color/cvd.ts` are used three times over: by
`simulateCVD` for the numbers, by `export/report.ts` for the HTML report's
preview filters, and by `apps/web` for the filter laid over the live map. All
three build their `feColorMatrix` from `CVD_MATRICES` rather than hard-coding
the values, and all three set `color-interpolation-filters="linearRGB"` so the
browser applies the matrix in linear light through the real sRGB transfer
function — the same curve `srgbToLinear` uses. An explicit `feComponentTransfer`
gamma of 2.2 would only approximate that curve, and the map would then disagree
with the swatches beside it.

## MapLibre's worker

MapLibre locates its worker with `new URL('./maplibre-gl-worker.mjs',
import.meta.url)`. Any bundler that moves the module breaks that URL, and the
failure is quiet: the map draws its background layer and nothing else. So
`apps/web/src/demo.ts` imports the worker as a Vite asset and names it with
`setWorkerUrl`. Both the dev server and `vite build` have been checked against
a rendered map, not just a clean exit code.

## Two modes, one panel

`apps/web` is one tool with two modes. `demo.ts` draws the Hawaiʻi geology on a
MapLibre map; `upload.ts` audits a style the reader drops in and, having no data
to draw it with, shows the colours themselves as a grid of swatches. Both hand
`app.ts` the same small `ModeView` — a caption, a header, a score, a body, and
what to put over the map area — and neither knows the other exists. The panels
that read an audit live in `audit-view.ts` and are shared, so the two modes
cannot drift into saying different things about the same numbers.

Remediation is the one thing that cannot run inline: `generateAccessiblePalette`
spends trial audits, each quadratic in the class count, and a hundred-class
style takes the better part of a minute. `remediate.worker.ts` runs it off the
main thread, which core's DOM-free rule is what makes possible. The audit a
reader came for is on screen while it works.

## TypeScript setup

`tsconfig.base.json` at the root holds every shared option — ES2022 target,
ESNext modules, `moduleResolution: bundler`, `strict` plus
`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` and
`verbatimModuleSyntax`. Each package extends it:

- `tsconfig.json` — the build: `composite`, `rootDir: src`, `outDir: dist`.
- `tsconfig.spec.json` — the typecheck: `noEmit`, and `test/` included too.

A package that consumes another one resolves it two different ways on purpose.
The *build* goes through the project reference and the dependency's emitted
declarations, so `tsc -b` gets the ordering right. The *typecheck* and the
*tests* resolve it to the dependency's sources instead — via `paths` in
`tsconfig.spec.json` and a `resolve.alias` in `vitest.config.ts` — so
`pnpm lint` and `pnpm test` both work on a clean checkout, before anything has
been built. CI relies on this: it installs, tests and typechecks before it
builds.

Because `moduleResolution` is `bundler`, relative imports still carry explicit
`.js` extensions so the emitted JavaScript runs under plain Node.

`packages/cli` declares a project reference to `packages/core`, so `tsc -b`
builds core first and resolves `@carto-a11y/core` through its emitted
declarations.

## Tool versions

`pnpm-workspace.yaml` defines a `catalog:` for `typescript` and `vitest`. Every
package references `catalog:` rather than a literal range, so versions are
bumped in one place and each package still has its own `node_modules/.bin`.
