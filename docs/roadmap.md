# Roadmap

## Done

- Workspace scaffold: core / cli / adapters / web, strict TypeScript, vitest, CI.
- `core/color/wcag.ts` — sRGB linearisation, WCAG 2.1 relative luminance,
  contrast ratio.
- `core/color/parse.ts` — hex and `rgb()`/`rgba()` parsing plus all 148 CSS
  Color 4 named colours, into normalised sRGB.
- `core/color/lab.ts` — sRGB → XYZ (D65) → CIELAB, and CIEDE2000 checked
  against Sharma et al. (2005).
- `core/color/cvd.ts` — Machado et al. (2009) dichromacy simulation at
  severity 1.0.
- `core/style/extract.ts` — static colour extraction from MapLibre style JSON:
  plain strings, legacy stop functions and `match` branches.
- `core/audit/composite.ts` — source-over compositing for translucent layers.
- `core/audit/engine.ts` — `runAudit`: pairwise CIEDE2000 and WCAG contrast
  per vision mode, with failure counts.
- CLI uses core's `parseColor`, so `carto-a11y contrast` takes names and
  `rgb()` as well as hex.
- `core/export/report.ts` — `generateJsonReport` and `generateHtmlReport`; the
  HTML page is self-contained, with swatches and a CSS-only vision-mode
  preview built on inline `feColorMatrix` filters.
- `carto-a11y audit <style.json>` — the whole pipeline from the command line,
  in summary, JSON or HTML, exiting 1 when a pair is confusable.
- Hawaiʻi demo — `scripts/fetch-hawaii.ts`, 15 geological units, a USGS-style
  baseline style, and its audit. See [../demos/hawaii](../demos/hawaii).
- `apps/web` — MapLibre map, live audit panel, CVD preview over the map.

## Next

0. **Real USGS polygons.** The demo data is synthesised because no USGS
   service reachable from a plain HTTP client serves SIM 3143 as vectors.
   Replace it when one does, or by converting the published shapefiles.

1. **More style syntax** — `case`, `step` and `interpolate` expressions, which
   extraction currently skips because they have no single static value;
   `background-color` and `fill-outline-color` as classes.
2. **Layer stacking** — classes are composited over one flat background, not
   over the layers beneath them, so a translucent fill above water is judged
   against white rather than against the water.
3. **Remaining colour syntax** — `hsl()`, 4- and 8-digit hex, and the
   space-separated `rgb(r g b / a)` form.
4. **Contrast rules** — WCAG AA/AAA thresholds for text, large text and
   non-text (3:1) contrast, as named, reportable checks; fold the contrast
   number the engine already computes into a pass/fail of its own.
5. **Partial CVD severities** — the Machado matrices are published at 0.1
   steps; interpolate for severity < 1.0.
6. **Suggested fixes** — the report says which pairs collapse, not what to do
   about them; propose a nearby colour that clears the threshold in every mode.
7. **Adapters** — load styles from a URL as well as a path, so the CLI and web
   share one loader (`packages/adapters` is still interfaces only).
8. **An accessible counterpart style** — `demos/hawaii/styles/accessible.json`,
   a repalette of the baseline that clears the threshold in every mode, so the
   demo shows a before *and* an after. This is the obvious next demo step.
9. **Slimmer JSON reports** — `audit-baseline.json` is 450 kB because every
   pair embeds both class objects in full; reference them by id instead.
10. **Code-split the web bundle** — MapLibre makes it 1 MB; load it lazily so
    the audit panel paints first.
11. **Open the style in the app** — the demo hard-codes one style URL; let a
    reader drop in their own.
