# ChromaMap

https://nellchris.github.io/chromamap/

Colour-vision accessibility auditor for web maps.

ChromaMap checks whether the colours on your map are distinguishable by people with colour vision deficiency (colour blindness). It simulates three types of colour blindness, identifies colours that become confusable, and generates an accessible replacement palette you can download and use.

# What it does
Audits map colour palettes — checks every pair of colours on your map for perceptual similarity under normal vision and three types of colour blindness (red-blind, green-blind, blue-yellow blind)
Simulates colour vision deficiency — toggle between normal vision and simulated colour-blind views directly on the map
Generates accessible palettes — produces a remediated colour scheme that reduces or eliminates colour clashes, available as a downloadable MapLibre style
Downloadable technical report — a detailed HTML report with full methodology, every clashing pair, and before/after comparisons

# How to use it

Try a demo — click either demo on the landing page to see real audit results:

Hawaiʻi Geological Map — 97 real USGS geological units, 1,295 colour clashes identified
Manhattan Zoning — 12 NYC zoning categories from the Department of City Planning, 12 clashes identified

# Upload your own map
**drop a MapLibre style JSON or a GeoJSON file onto the upload zone:**
Styles with embedded map data render as an interactive map
Styles referencing external data show a colour scheme audit
GeoJSON files are auto-wrapped in a generated style and displayed as a map
Download a fixed version of your style with accessible colours

# Features
Real-time colour blindness simulation using Machado et al. (2009) matrices
Perceptual colour distance measured with CIEDE2000 (Sharma et al., 2005)
WCAG 2.1 contrast ratio checking
Interactive legend grouped by category
Click-to-inspect popups on map features
Before/after toggle between original and accessible palettes
Export remediated MapLibre style JSON
Export technical audit report (HTML)
Fully client-side — uploaded files never leave your browser
Mobile responsive

# Built with
TypeScript, Vite, MapLibre GL JS, Vitest

# Author
Nelson Christopher.
