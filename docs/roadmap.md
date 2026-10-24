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

## Next

1. **Retire the CLI's own hex parser** — `packages/cli/src/index.ts` still has
   `parseHexColor`; switch it to `parseColor` so the CLI accepts named colours
   and `rgb()` too.
2. **Remaining colour syntax** — `hsl()`, 4- and 8-digit hex, and the
   space-separated `rgb(r g b / a)` form.
3. **Contrast rules** — WCAG AA/AAA thresholds for text, large text and
   non-text (3:1) contrast, as named, reportable checks.
4. **Palette confusion scoring** — pairwise CIEDE2000 across a palette under
   each dichromacy, flagging pairs that collapse below a threshold.
5. **Partial CVD severities** — the Machado matrices are published at 0.1
   steps; interpolate for severity < 1.0.
6. **Style adapter** — read MapLibre/Mapbox style JSON into a layer/paint model
   the engine can walk.
7. **Audit report** — findings with severity, layer path and suggested fix;
   JSON and human-readable formatters shared by CLI and web.
8. **Web UI** — add vite, render a map alongside live audit findings.
9. **Hawaii demo** — real data and styles under `demos/hawaii` driving an
   end-to-end example.
