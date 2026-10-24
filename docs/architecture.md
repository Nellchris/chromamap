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

## TypeScript setup

`tsconfig.base.json` at the root holds every shared option — ES2022 target,
ESNext modules, `moduleResolution: bundler`, `strict` plus
`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` and
`verbatimModuleSyntax`. Each package extends it:

- `tsconfig.json` — the build: `composite`, `rootDir: src`, `outDir: dist`.
- `tsconfig.spec.json` — the typecheck: `noEmit`, and `test/` included too.

Because `moduleResolution` is `bundler`, relative imports still carry explicit
`.js` extensions so the emitted JavaScript runs under plain Node.

`packages/cli` declares a project reference to `packages/core`, so `tsc -b`
builds core first and resolves `@carto-a11y/core` through its emitted
declarations.

## Tool versions

`pnpm-workspace.yaml` defines a `catalog:` for `typescript` and `vitest`. Every
package references `catalog:` rather than a literal range, so versions are
bumped in one place and each package still has its own `node_modules/.bin`.
