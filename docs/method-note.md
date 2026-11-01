# ChromaMap: auditing web-map styles for colour vision deficiency

**Nelson Christopher, Geospatial Analyst**

Live tool: <https://nellchris.github.io/chromamap/> · Source:
<https://github.com/Nellchris/chromamap>

---

## 1. Motivation

Thematic maps — geological sheets, zoning plans, hazard zones — routinely carry
their entire classification in colour alone. A reader who cannot separate two
fills cannot read the map, and for red–green deficiency that is about 8% of men
and 0.5% of women of Northern European descent (Birch, 2012). On a hazard map
the cost of a misread class is not aesthetic.

Tools for checking this already exist, and most of them work on a picture: you
export a PNG, run a colour vision deficiency (CVD) simulation over it, and look.
That approach has three weaknesses. It inspects one rendered view rather than
the design, so a class absent from that view goes unchecked. It cannot say
*which* classes collide, only that some region looks flat. And it produces
nothing a cartographer can act on except an impression.

ChromaMap works on the style instead of the screenshot. The style file is where
the classification actually lives, so an audit of it covers every class the map
can paint, names the pairs that collide, and can hand back a corrected palette
in the same format it read.

## 2. What ChromaMap does

**Reads the style.** It parses a MapLibre GL style JSON and extracts every
statically resolvable colour: plain values, legacy `stops` functions, and each
branch of a `match` expression, across `fill`, `line`, `text` and `circle`
paint properties. Extraction never evaluates a data expression and never
fetches: a colour that only exists once features are loaded is skipped rather
than guessed at, so the audit only speaks about what it can actually see.

**Composites.** Each class is flattened onto the map's background at its own
opacity before measurement, so a class drawn at 85% is judged as it lands
rather than as it was written.

**Simulates.** Four vision modes are checked: normal trichromacy and the three
dichromacies — protanopia, deuteranopia, tritanopia — using the Machado,
Oliveira and Fernandes (2009) physiologically based model at full severity,
applied in linear light through the sRGB transfer function.

**Measures.** Every pair of classes, under every mode, gets a CIEDE2000 colour
difference (ΔE₀₀) in CIELAB under D65, and a WCAG 2.1 relative-luminance
contrast ratio. A pair is reported as a clash when ΔE₀₀ < 10. That threshold is
far above the ~1.0 just-noticeable difference on purpose: map classes are read
at a glance, in small patches, against varying surroundings, not compared side
by side. Contrast below 3:1 is flagged separately, that being the WCAG 2.1
floor for non-text graphical objects (SC 1.4.11).

**Remediates.** Dichromacy removes hue discrimination but leaves lightness
nearly intact, so the repair stops the palette relying on hue: classes are
ranked by their original lightness and given evenly spaced slots through an L*
band of 25–85, preserving the light-to-dark ordering the author chose. Hues are
then rotated one class at a time, with a trial audit after each move keeping
whichever palette scores best. The output is the author's own style file with
the colours replaced and nothing else touched.

**Reports.** The interface deliberately shows only a score, the worst clashes as
pairs of paint chips, and plain-language mode names. Every number — ΔE₀₀ values,
contrast ratios, Lab coordinates, the methodology, the full clash table — lives
in a downloadable, self-contained HTML report intended for a reviewer.

## 3. Validation

ChromaMap's correctness rests on published reference values where they exist.
**370 tests** pass across the workspace (302 engine, 42 CLI, 26 interface).

- **WCAG contrast.** Black on white is asserted at 21:1 to ten decimal places,
  the ratio is proved never to exceed 21 across a sweep of pairs, and the sRGB
  linearisation is checked against its known value at mid-grey.
- **CIEDE2000.** Six pairs from Sharma, Wu and Dalal (2005), Table 1 — the
  standard verification set for the formula, including the near-neutral and
  high-chroma cases where naive implementations fail — are asserted against the
  published ΔE₀₀ figures to the four decimals the paper quotes.
- **CVD simulation.** The matrices are transcribed from Machado et al. (2009)
  at severity 1.0. The tests verify their structural properties rather than an
  independent output dataset: rows sum to unity (which is what preserves
  neutrals), the full 8-bit grey ramp survives unchanged, black and white map to
  themselves, outputs stay in range, and red and green converge more under
  deuteranopia than protanopia while staying distinct under tritanopia. This
  establishes that the model is applied correctly; it does not independently
  re-derive the model.
- **Style round-trip.** The palette writer is tested against the reader: every
  class the extractor names can be written back and read again as the colour
  intended, across plain values, `match` branches and stop functions.

## 4. Demonstrations

Both demos use real published data and are audited live in the browser, over
the map's own background (`#f2efe9`) rather than paper white.

### Hawaiʻi geology — USGS SIM 3143

97 map units from the published geological map of Hawaiʻi Island (Sherrod and
others, 2021); 100 colour classes in total, counting unit contacts, labels and
the fallback. Of 4,950 class pairs, **1,295 are confusable** under at least one
vision mode. Remediation takes that to **835**.

The striking figure is the 258 failing judgements under **normal vision**: a
colour-blindness audit was not needed to find those, because the published
sheet gives different units the same or near-identical fills. That is the
audit's most useful property — it reports what is there, including problems
that have nothing to do with colour vision.

It does not reach zero, and cannot. Even spacing across a 60 L* band gives
adjacent classes 60/(n−1) of separation, and since ΔE₀₀ between two colours of
similar hue approximates their lightness difference, a palette of more than
about twelve classes cannot put every pair 10 ΔE₀₀ apart however the hues are
arranged. The ceiling is arithmetic. Past that point a map needs texture,
labels, direct annotation or fewer classes; ChromaMap reports how far colour
alone got, which is the honest answer.

### Manhattan zoning — NYC Department of City Planning

974 zoning districts clipped to Manhattan, with the city's 175 distinct
`ZONEDIST` codes grouped into the 11 families present on the island (13 colour
classes including outlines and the fallback). Drawn in the conventional zoning
palette — residential yellows, commercial reds, manufacturing purples, a ramp
per family by intensity of use.

**12 confusable pairs** before, **1** after. Ten of the eighteen failing
judgements fall under protanopia: the three commercial reds, which carry most of
Midtown and all of Lower Manhattan. One falls under normal vision. At thirteen
classes this palette sits right at the ceiling described above, which is why
remediation can still do nearly all of its work here.

## 5. Limitations

**The simulation is a model, not a diagnosis.** Machado et al. describe
dichromacy at full severity. Real colour vision deficiency is a spectrum:
anomalous trichromacy (protanomaly, deuteranomaly, tritanomaly) is more common
than dichromacy and is not simulated here. A palette that passes this audit has
not been shown to work for every reader, only to survive three specific and
severe transformations.

**The thresholds are defaults, not findings.** ΔE₀₀ < 10 is a considered choice
for small patches read at a glance, but it is a choice; 3:1 comes from WCAG,
which was written for interface graphics rather than maps. Neither has been
calibrated against map-reading performance.

**No user study.** Nothing here has been tested with colour-blind readers. The
claim is that these pairs are close in a perceptual metric under a published
simulation — not that a particular reader will or will not confuse them.

**The basemap is approximated.** Classes are composited over the style's flat
background colour, not over the actual basemap tiles beneath them. Where a
translucent class sits over varying terrain or labels, the real composited
colour varies and the audit uses a single representative value.

**Projection is not validated on upload.** Uploaded GeoJSON is assumed to be in
WGS84, as the format specifies. A file in a projected coordinate system will
still be audited correctly — colour does not depend on position — but it will
be framed nonsensically on the map.

**Extraction is static.** Colours produced by `interpolate` or `step`
expressions over feature data, or by a data-driven style whose values only exist
at runtime, are skipped. The audit reports on what it can resolve, and says so.

---

### References

Birch, J. (2012). Worldwide prevalence of red-green color deficiency. *Journal
of the Optical Society of America A*, 29(3), 313–320.
<https://doi.org/10.1364/JOSAA.29.000313>

Machado, G. M., Oliveira, M. M., & Fernandes, L. A. F. (2009). A
physiologically-based model for simulation of color vision deficiency. *IEEE
Transactions on Visualization and Computer Graphics*, 15(6), 1291–1298.
<https://doi.org/10.1109/TVCG.2009.113>

Sharma, G., Wu, W., & Dalal, E. N. (2005). The CIEDE2000 color-difference
formula: implementation notes, supplementary test data, and mathematical
observations. *Color Research & Application*, 30(1), 21–30.
<https://doi.org/10.1002/col.20070>

Sherrod, D. R., Sinton, J. M., Watkins, S. E., & Brunt, K. M. (2021).
*Geologic map of the State of Hawaiʻi*. U.S. Geological Survey Scientific
Investigations Map 3143. <https://doi.org/10.3133/sim3143>

W3C (2018). *Web Content Accessibility Guidelines (WCAG) 2.1*, SC 1.4.11
Non-text Contrast. <https://www.w3.org/TR/WCAG21/#non-text-contrast>
