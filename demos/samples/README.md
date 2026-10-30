# Sample styles

Two MapLibre styles to try the **Your Map** tab with, for anyone who does not
have a style of their own to hand. Both are linked from the upload panel and
bundled into the app, so they load without a network round trip.

| File | What it is |
| ---- | ---------- |
| `nlcd-landcover.json` | The published USGS National Land Cover Database palette |
| `urban-zoning.json` | A city zoning palette of the kind planning departments publish |

Each is a valid v8 style whose fill colour is a `match` on a feature property.
The source holds its GeoJSON inline — one placeholder feature per class,
carrying the class code and its name — because that is how `extractClasses`
learns what to call a colour. A style that names its data by URL audits
perfectly well, but the panel can then only show class ids.

Neither style is meant to be rendered: the geometry is a scatter of points and
the audit never needs it.

## NLCD land cover

The twenty classes of the National Land Cover Database, in the colours MRLC
publishes. The RGB values are the NLCD 2021 raster attribute table as served by
`kyraster.ky.gov`, checked class by class against Google Earth Engine's
`USGS/NLCD_RELEASES` catalogue; the four Alaska-only classes (51 Dwarf Scrub,
72 Sedge/Herbaceous, 73 Lichens, 74 Moss) come from the same Earth Engine
table. Class names follow the MRLC legend.

This is a real, widely used scheme, and it audits at **46 clashes** — the
developed-intensity ramp and the wetland blues are the worst of it.

## Urban zoning

Invented, but typical: one hue ramped per district family, which is exactly the
pattern dichromacy flattens. R-1 to R-4 run through yellows, C-1 and C-2 through
reds, I-1 and I-2 through purples. **16 clashes**, and because the palette is
small enough to sit under the twelve-class ceiling, remediation takes it to
zero — which makes it a good demonstration of the before/after switch.
