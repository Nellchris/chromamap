# Hawaiʻi demo

A geological map of Hawaiʻi Island in traditional USGS colours, and what an
accessibility audit has to say about it.

| File | What it is |
| ---- | ---------- |
| `data/units.geojson` | 29 polygons in 15 geological units, tiling the island |
| `styles/baseline.json` | A MapLibre style colouring those units the way a USGS sheet would |
| `audit-baseline.json` | The audit of that style, as written by `carto-a11y audit` |

## The finding

The baseline style is readable to normal colour vision and falls apart for
everyone else. Of its 153 class pairs, **48 are confusable** under at least one
vision mode:

| Vision mode | Failing judgements |
| ----------- | -----------------: |
| Normal | 9 |
| Protanopia | 29 |
| Deuteranopia | 40 |
| Tritanopia | 21 |

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

## Regenerating

```bash
pnpm demo:data        # rewrites data/units.geojson
pnpm build && node packages/cli/bin/carto-a11y.js \
  audit demos/hawaii/styles/baseline.json --format json \
  --output demos/hawaii/audit-baseline.json
```
