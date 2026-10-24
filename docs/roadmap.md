# Roadmap

## Done

- Workspace scaffold: core / cli / adapters / web, strict TypeScript, vitest, CI.
- `core/color/wcag.ts` — sRGB linearisation, WCAG 2.1 relative luminance,
  contrast ratio.

## Next

1. **Colour parsing** — hex, `rgb()`, `hsl()` and named CSS colours into sRGB
   channels; move `parseHexColor` out of the CLI into core.
2. **Contrast rules** — WCAG AA/AAA thresholds for text, large text and
   non-text (3:1) contrast, as named, reportable checks.
3. **Colour-vision deficiency simulation** — protanopia, deuteranopia and
   tritanopia transforms, plus pairwise confusion scoring for a palette.
4. **Style adapter** — read MapLibre/Mapbox style JSON into a layer/paint model
   the engine can walk.
5. **Audit report** — findings with severity, layer path and suggested fix;
   JSON and human-readable formatters shared by CLI and web.
6. **Web UI** — add vite, render a map alongside live audit findings.
7. **Hawaii demo** — real data and styles under `demos/hawaii` driving an
   end-to-end example.
