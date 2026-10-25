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
- `apps/web` — MapLibre map, live audit panel, CVD preview over the map, and a
  before/after switch between the baseline and remediated styles.
- `core/remediate/palette.ts` — `generateAccessiblePalette`: respace a palette
  through lightness, nudging hues where pairs still clash. 48 clashes to 4 on
  the Hawaiʻi demo.
- `core/color/lab.ts` — the inverse direction: `labToXyz`, `xyzToSrgb` and
  `labToRgb`, which maps an out-of-gamut colour in by dropping chroma rather
  than clipping channels.
- `MapClass.displayName`, filled in from an inline GeoJSON source.

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
8. **Beyond colour** — four pairs on the Hawaiʻi demo cannot be separated by
   colour at eighteen classes, whatever the palette. Audit and suggest the
   other channels: hatching and pattern fills, outline weight, labels.
9. **Slimmer JSON reports** — `audit-baseline.json` is 450 kB because every
   pair embeds both class objects in full; reference them by id instead.
9b. **Display names in reports** — the web app reads real unit names out of
   the GeoJSON, so it says “Kīlauea historical flows”; the CLI only has the
   style, so its report says “Qkh”. Carry a display name on `MapClass`, read
   from a style `metadata` block, so both read the same.
10. **Code-split the web bundle** — MapLibre makes it 1 MB; load it lazily so
    the audit panel paints first.
11. **Open the style in the app** — the demo hard-codes one style URL; let a
    reader drop in their own.
