# Hawaiʻi demo

The official USGS geological map of Hawaiʻi Island, and what an accessibility
audit has to say about it.

| File | What it is |
| ---- | ---------- |
| `data/units.geojson` | 5,681 polygons in 97 map units, Big Island only |
| `data/unit-metadata.json` | Per-unit name, age, volcano and official USGS fill colour |
| `styles/baseline.json` | A MapLibre style using the published USGS colours |
| `styles/remediated.json` | The same style with an accessible palette |
| `audit-baseline.json` | The audit of the baseline |
| `audit-remediated.json` | The audit of the remediated version |

## Where the data comes from

USGS **Scientific Investigations Map 3143**, *Geologic Map of the State of
Hawaiʻi* (Sherrod, Sinton, Watkins and Brunt, 2021), as published in GeoJSON.
This is the real survey, not a stand-in.

`scripts/process-hawaii.ts` turns the archive into what the demo needs:

- **Reprojects** from EPSG:26904 (NAD83 / UTM zone 4N, in metres) to longitude
  and latitude. The archive is *not* in lon/lat; the inverse transverse
  Mercator is implemented in the script rather than pulled in as a dependency.
  Checked against the island's real extent: the output bounding box lands
  within 0.001° and the mapped area comes out at 10,411 km² against the
  island's 10,430 km².
- **Filters** 9,997 statewide features down to the 5,851 on Hawaiʻi Island.
- **Simplifies** with Ramer-Douglas-Peucker at a tolerance of 0.0005° (~55 m),
  keeping 15% of the 837,617 vertices. That is the finest thinning that stays
  under the 5 MB budget; it drops 170 of the smallest flows, which collapse to
  nothing at that tolerance, and leaves all 97 units represented. The result is
  3.9 MB and is for display, not for survey work.
- **Merges** each unit's `FullName`, `Age` and official `AreaFillRGB` from
  `DescriptionOfMapUnits.json`, so the baseline style really is the USGS
  palette rather than an approximation of it.

```bash
pnpm demo:data -- /path/to/HawaiiStateGeologicMap_GeoJSON
```

Five units carry no `AreaFillRGB` in the source — `Qk3`, `Qka3`, `Qkc3`,
`Qkld3` and `ow` — and are drawn in a neutral `#cccccc`. That is this project's
fallback rather than anything the USGS published, and it has a consequence
worth naming: those five share a colour with each other, which accounts for
**15 of the 1,101 clashes below**. The other 1,086 are real.

## The finding

| Vision mode | Baseline | Remediated |
| ----------- | -------: | ---------: |
| Normal | 213 | 129 |
| Protanopia | 641 | 424 |
| Deuteranopia | 686 | 431 |
| Tritanopia | 509 | 305 |
| **Confusable pairs** | **1,101** | **683** |

Of 4,950 pairs of map colours, **1,101 are confusable** under at least one
vision mode, and 99 of the 100 colours are caught up in at least one.

The striking number is the 213 in the **normal vision** row. A colour-blindness
audit was not needed to find those: the published sheet gives different units
the *same* fill colour. Twelve pairs are byte-for-byte identical —

| Pair | Fill | Separated by |
| ---- | ---- | ------------ |
| `Qkc1`/`Qkld1`, `Qkc2`/`Qkld2`, `Qkc4`/`Qkld4`, `Qkc5`/`Qkld5` | identical | label only |
| `Qpc3`/`Qpld3`, `Qpc4o`/`Qpld4o`, `Qpc5`/`Qpld5`, `Qp1o`/`Qp1y` | identical | label only |
| `Qpa4o`/`Qpa4y`, `Qw`/`Qwc`, `Qlbc`/`Qlc`, `Qpl`/`Qpld` | identical | an overprint stipple |

— and that is not a mistake in the map. A geological sheet separates units by
label, by overprint pattern and by context as well as by fill. Four of those
twelve pairs do carry a stipple pattern, which this tool cannot see at all,
because it only reads colour. That is the honest limit of a colour audit, and
it is the clearest argument for the next thing on the roadmap: auditing the
channels besides colour.

## The remediation, and its limit

`generateAccessiblePalette` keeps each unit's hue and respaces the palette
through lightness, then nudges hues where pairs still clash. It takes 1,101
clashes down to **683** — a real improvement, and nowhere near a clean sheet.

The arithmetic says why. Ninety-seven units spread across a 60 L\* band sit
**0.6 L\* apart**, and CIEDE2000 between similar hues is close to the lightness
difference. Measured against this method, the band carries about twelve classes
cleanly. Ninety-seven is an order of magnitude past that.

So the conclusion the demo actually supports is not "here is the fixed map".
It is: **a 97-unit geological map cannot be made distinguishable by colour
alone, for anyone.** It needs pattern, labelling and interaction — which is
what the real sheet already does, and what this tool should learn to audit.

## Regenerating

```bash
pnpm demo:data -- /path/to/HawaiiStateGeologicMap_GeoJSON   # data + baseline style
pnpm build
pnpm demo:remediate                                          # remediated style
node --max-old-space-size=4096 packages/cli/bin/carto-a11y.js \
  audit demos/hawaii/styles/baseline.json --format json \
  --background '#a8cbe0' --output demos/hawaii/audit-baseline.json
node --max-old-space-size=4096 packages/cli/bin/carto-a11y.js \
  audit demos/hawaii/styles/remediated.json --format json \
  --background '#a8cbe0' --output demos/hawaii/audit-remediated.json
```

The source archive is not committed: it is 26 MB zipped and freely available
from the USGS.
