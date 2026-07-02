# Antipodes Explorer — HTML5

An accessible HTML5 rebuild of the Flash *Antipodes Explorer*, on the shared
KL-UNL foundation. It shows a point on the Earth and its **antipode** (the point
on the exact opposite side of the globe) on both an equirectangular world map and
a transparent 3-D globe.

## It must be served over HTTP — it will NOT run from a double-clicked file

Opening `index.html` directly from disk (a `file://` path) shows an empty or
broken title bar. The KL-UNL masthead component loads its title / Help / About
text with `fetch('foundation/contents.json')`, and browsers block `fetch()` of
local files over `file://` for security (same-origin policy). Served over HTTP
the fetch succeeds and the sim loads normally.

## How to run locally

From **inside this `html5/` folder**, start any static file server:

```
# Python 3
python -m http.server 8123
#   then open  http://localhost:8123/

# Node
npx serve
#   or:  npx http-server
```

VS Code users can instead use the **Live Server** extension.

Because you are serving from inside `html5/`, the sim is at the server root — the
URL is `http://localhost:8123/`, **not** `.../html5/index.html`.

## Production

When deployed to the cloud host (served over HTTP/HTTPS) it just works. The
`file://` limitation only affects local double-clicking.

## Files

```
index.html        KL-UNL scaffold: .app-shell + <kl-unl-masthead> + panels
foundation/       shared KL-UNL files, copied in UNCHANGED
                    kl-unl-masthead.js, kl-unl.css, kl-unl.js, contents.json,
                    (contents.json already contains the "antipodesexplorer" entry)
styles/styles.css sim-specific styles only (foundation never edited)
simulation.js     all sim logic (state, map, globe, controls, a11y)
assets/           worldmap.jpg (reused Flash map bitmap), shoreData.js
                  (continent point-cloud reused from the Flash globe), MathJax
CONVERSION_NOTES.md   behavior model + AS→HTML5 mapping + deviations
ACCESSIBILITY.md      WCAG affordances, keyboard map, screen-reader notes
```

Everything is local; the only runtime fetches are `foundation/contents.json` and
the local MathJax include. Nothing leaves the host.
