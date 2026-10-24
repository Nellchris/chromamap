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

## Next

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
9. **Web UI** — add vite, render a map alongside live audit findings.
10. **Hawaii demo** — real data and styles under `demos/hawaii` driving an
    end-to-end example.
