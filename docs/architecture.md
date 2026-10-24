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
  touches `process`.
- **`@carto-a11y/web`** — the browser UI. Imports core directly; during
  development TypeScript resolves it to core's sources through `paths`, and
  Vite resolves the workspace link.

Dependency direction is one-way: `cli` and `web` depend on `core`; `core`
depends on nothing.

## Inside core

Core is layered, and each layer only reaches downwards:

- `color/` — the maths. `wcag` (luminance, contrast), `parse` (CSS colour
  strings), `lab` (CIELAB, CIEDE2000) and `cvd` (dichromacy simulation).
- `style/` — reads a MapLibre style and hands back a flat list of `MapClass`
  values. Static only: it never evaluates a data expression, and skips what it
  cannot resolve rather than guessing.
- `audit/` — `compositeOver` flattens opacity onto a background, and `runAudit`
  walks the class list pairwise under each vision mode.

So a style audit is a pipeline: `extractClasses` → `compositeOver` →
`simulateCVD` → `ciede2000` / `contrastRatio`. Each step is exported on its
own, because the web UI needs the intermediate values (what a swatch looks like
under deuteranopia) and not just the verdict.

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
