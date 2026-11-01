# Manhattan zoning demo

New York City's zoning districts for Manhattan, and what an accessibility
audit has to say about the colours they are conventionally drawn in.

| File | What it is |
| ---- | ---------- |
| `data/zones.geojson` | 974 zoning districts, Manhattan only |
| `data/zone-metadata.json` | Per-category name, description and fill colour |
| `styles/baseline.json` | A MapLibre style in the conventional zoning colours |
| `styles/remediated.json` | The same style with an accessible palette |
| `audit-baseline.json` | The audit of the baseline |
| `audit-remediated.json` | The audit of the remediated version |

## Where the data comes from

The **NYC Department of City Planning**'s `nyzd` layer — the zoning districts
of the whole city — read from DCP's own ArcGIS Online organisation. The city's
open-data portal publishes the same layer, but its edge refuses requests that
do not come from a browser, so `scripts/process-nyc-zoning.ts` reads the GIS
service instead. Regenerate with:

```bash
pnpm demo:nyc && pnpm demo:remediate:nyc
```

The script clips to Manhattan — `nyzd` has no borough column, so it fetches the
borough boundary too and tests every polygon against it — then thins the rings
with Ramer-Douglas-Peucker at about two metres, which takes 2,098 districts in
the bounding box down to the 974 on the island and the file to 0.37 MB.

## The categories

`ZONEDIST` is granular to the point of being unmappable: 175 distinct codes in
Manhattan alone, `M1-5/R9X` among them. They are grouped into the dozen
families a zoning map is actually drawn in, of which eleven occur on the
island. R1–R2 does not: there is no single-family detached zoning in Manhattan.

A code carrying a slash is a Special Mixed Use District — manufacturing and
housing on one block — and gets its own category rather than being filed under
whichever half comes first.

## The colours

Residential in yellows, commercial in reds, manufacturing in purples, parkland
in green: the families a zoning map has been drawn in since the 1920s, each a
ramp from light to dark by intensity of use.

These are conventional families rather than a published byte-exact table, and
they are written down here rather than lifted from a legend file — unlike the
Hawaiʻi demo, whose colours are the USGS sheet's own. That is worth knowing
before quoting any single value. The *pattern*, though, is the real one, and
the pattern is the point: a ramp of one hue is exactly what dichromacy
flattens first.

## What the audit found

Judgements that failed, per vision mode, measured over the map's own
background (`#f2efe9`) rather than paper white:

| | Baseline | Remediated |
| --- | --- | --- |
| Normal vision | 1 | 0 |
| Protanopia | 10 | 1 |
| Deuteranopia | 5 | 1 |
| Tritanopia | 2 | 0 |
| **Confusable pairs** | **12** | **1** |

Ten of the eighteen failing judgements are under protanopia: the three reds of
the commercial ramp, which carry most of Midtown and all of Lower Manhattan.
One failure is under **normal vision** — colour blindness is not needed to find
that one; the palette simply puts two districts too close together.

With thirteen colours this palette sits right at the ceiling where remediation
can still do most of its work, and it takes twelve clashes down to one.
