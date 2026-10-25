# Hawaiʻi demo

A geological map of Hawaiʻi Island in traditional USGS colours, and what an
accessibility audit has to say about it.

| File | What it is |
| ---- | ---------- |
| `data/units.geojson` | 29 polygons in 15 geological units, tiling the island |
| `styles/baseline.json` | A MapLibre style colouring those units the way a USGS sheet would |
| `styles/remediated.json` | The same style with an accessible palette |
| `audit-baseline.json` | The audit of the baseline |
| `audit-remediated.json` | The audit of the remediated version |

## The finding

The baseline style is readable to normal colour vision and falls apart for
everyone else. Of its 153 class pairs, **48 are confusable** under at least one
vision mode:

| Vision mode | Baseline | Remediated |
| ----------- | -------: | ---------: |
| Normal | 8 | 1 |
| Protanopia | 29 | 3 |
| Deuteranopia | 40 | 3 |
| Tritanopia | 20 | 2 |
| **Confusable pairs** | **48** | **4** |

(Both audited over the style's own ocean background, `#a8cbe0`, which is what
`carto-a11y audit --background '#a8cbe0'` does and what the web app uses.)

The worst offenders are the ones a geologist would care most about: the
historical flows of Kīlauea (`Qkh`, `#e8232a`) and Mauna Loa (`Qmlh`,
`#d62f2a`) sit 1.1 ΔE apart under protanopia — and only 3.2 ΔE apart under
*normal* vision, which is a problem the palette has before colour vision
deficiency enters into it at all.

Open the web app and switch to Protanopia to see it: the reds, oranges and
browns that separate 10 ka lavas from historical flows collapse into a single
band of olive.

## Where the data comes from

`units.geojson` is **representative, not real**. `scripts/fetch-hawaii.ts`
tries two USGS sources first and synthesises only when they fail, which as of
October 2026 they do:

- `ngmdb.usgs.gov/mapview/rest/services` redirects to a 404 page.
- ScienceBase returns 403 to anything that is not a browser.
- The one USGS geology service that answers, the State Geologic Map
  Compilation at `mrdata.usgs.gov`, speaks WMS only — raster tiles, not the
  polygons an audit needs.

So the polygons are generated: the island outline is traced from the real
coastline, the five shield volcanoes sit at their real summits, and each one's
territory is a Voronoi cell clipped to the coast, subdivided by flow age and by
rift-zone sectors. Unit labels, names and ages follow USGS usage for the island
— `Qku` for Kaʻū Basalt, `Qhw` for the Hāwī Volcanics, and so on — and the
total mapped area comes out at about 10,700 km² against the island's real
10,430 km².

That is enough to exercise an audit honestly, and the file says so in its own
`metadata`. To swap in the real map, point `fetch-hawaii.ts` at a source that
serves SIM 3143 as vectors; nothing downstream cares how the polygons were
made.

## The remediation, and its limit

`styles/remediated.json` is the same style with one thing changed: the
palette. `generateAccessiblePalette` keeps each unit's hue and moves its
lightness to an evenly spaced slot between L\* 25 and 85, then nudges hues
where pairs still clash. Dichromacy takes away hue discrimination but leaves
lightness nearly intact, so spacing by lightness is the repair that survives
it. **48 clashes become 4.**

It does not reach zero, and that is the interesting part. Eighteen classes
spread over 60 L\* sit 3.5 L\* apart, and CIEDE2000 between two colours of
similar hue is close to their lightness difference — so most of the separation
has to come from hue, which is exactly what protanopia and deuteranopia
remove. Measured against this method, a 60 L\* band carries **up to twelve
classes** with no clashes at all; at fourteen it starts to fail, and at
eighteen four pairs remain. A geological map with this many units cannot be
made safe by colour alone. It needs texture, labels or fewer units — which is
a finding worth having, not a failure of the tool.

The four that remain are `Qkp`/`Qhv` and `Qhm`/`Qhw`, both separated by under
5 ΔE.

## Regenerating

```bash
pnpm demo:data        # rewrites data/units.geojson
pnpm build
pnpm demo:remediate   # rewrites styles/remediated.json from the baseline
node packages/cli/bin/carto-a11y.js audit demos/hawaii/styles/baseline.json \
  --format json --background '#a8cbe0' --output demos/hawaii/audit-baseline.json
node packages/cli/bin/carto-a11y.js audit demos/hawaii/styles/remediated.json \
  --format json --background '#a8cbe0' --output demos/hawaii/audit-remediated.json
```
