# Conversion Notes — Antipodes Explorer

## Behavior model (one paragraph)

The sim demonstrates **antipodal points** — two points on exactly opposite sides
of the Earth. A red point and its blue antipode are drawn on an equirectangular
world map and on a transparent 3-D globe. Dragging **either** point moves it, and
the other point jumps to the antipode: for a point at longitude `lon`, latitude
`lat`, the antipode is `{ lon: 180 + lon (wrapped to (-180,180]), lat: -lat }`.
The map shows longitude/latitude border labels; the globe shows the two points,
the celestial-equator (equator) circle, and a straight connecting line, and can
be rotated by dragging. Two options affect dragging: **restrict dragging along**
either *longitude meridians* (longitude locked, the point moves only in latitude)
or *latitude parallels* (latitude locked); and **snap to multiples of 5°**
(latitude and longitude are rounded to the nearest 5°). Reset returns the red
point to 42° N, 5° W (blue to 42° S, 175° E).

## Source of truth / recovery of the ActionScript

The decompiled `scripts/*.as` files in the delivered folder were **empty** (only
filenames were exported). The ActionScript was recovered from the bundled
`antipodesExplorer003.swf` with the JPEXS/FFDec CLI and used as the behavioral
ground truth. Key sources: the main frame script (`DefineSprite_187` `DoAction`),
`Flat Map Component 007 modified`, `AntipodeDot` / `AntipodeDotForSphere`,
`Globe Component v2`, and the `CelestialSphere` (`* CS *`) engine.

## AS → HTML5 mapping

| Flash / ActionScript | HTML5 port |
|---|---|
| `setObjectPosition(name,pos)` in main `DoAction` — sets one point, other = antipode, normalises lon, writes the `"n° N/S"`, `"n° E/W"` readouts | `setPoint()` + `latText/lonText/latTeX/lonTeX` (verbatim rounding & sign rules) |
| `AntipodeDot.onMouseMoveFunc` — `getPositionFromScreenPoint`, then snap (`5*round`), then restrict (`latitude`→lock lat, `longitude`→lock lon) | `mapCanvasToGeo` + `applySnapRestrict` (identical order and formulas) |
| Flat Map `getScreenPointFromPosition` / `longitudeOffset` (reset value 100) | `lonToX`/`latToY`; `state.offset` pan; formula `screenX=((lon-offset)/360)·mapW mod mapW` derived from the AS |
| Border labels (`attachBorderLabels`): lon `round(i·45)` → `0°/n° E/180°/n° W`; lat `90..-90` step 30 → `n° N / n° S / 0°` | Built as real HTML spans, **typeset by MathJax**, repositioned on pan |
| Map bitmap symbol *FMC Map Rev 1 modified* (a 1400×350 two-world equirectangular image, exported as `images/155.jpg`) | **reused as-is** → `assets/worldmap.jpg`, drawn one world at 1:1 and tiled for wrap |
| `CelestialSphere` + `Globe Component v2` orthographic engine (`doA/doM/doB`, `CtoSz`, viewer `calculateBConstants`, precession+rotation `q`) | Single clean orthographic projection. The AS tilt+rotation matrix `q` (obliquity 23.5°, rotation 180°, precession 0) reduces exactly to `diag(-1,-1,1)`, so continents and points share one projection: `world=(-x,-y,z)` then orthographic by view `(theta,phi)` |
| Globe continents (`_shoreData` unit-vector polygons in `Globe Component v2`) | **reused verbatim** → `assets/shoreData.js`; projected per point, split front/back |
| Sphere rotation drag (`updateSimpleDragging`) and dot drag (`AntipodeDotForSphere` `StoMH`/`MHtoC`) | `initGlobePointer`: drag rotates the view; grabbing a near-side point moves it via `globeCanvasToGeo` (analytic inverse of the same projection) |
| `onEnterFrame` / `getTimer()` | not needed — the sim has no continuous animation; it renders on interaction |
| FUIComponent radio/checkbox (`onRestrictChanged`, `onSnapChanged`) | native `<input type=radio/checkbox>` with the same handlers |
| Masthead / About / Help / Reset (Flash title bar, `About` sprite) | shared `<kl-unl-masthead>`; `sim-reset` event wired to `reset()` |

Constants copied verbatim: dot colors `0xF06060` (red) / `0x8080FF` (blue),
equator `0x309030` @50%, connecting line `0x404040`, map offset 100, reset point
(42° N, 5° W), initial globe view θ=190°, φ=37°.

## contents.json

The sim-id is **`antipodesexplorer`**, and the shared foundation `contents.json`
**already contains** its entry (title "Antipodes Explorer", version 2.0, Help and
About text). No content edit was therefore needed.

Note: the `foundation/contents.json` found at the *root* of the sim collection is
malformed JSON (it contains raw newlines inside string values, which
`JSON.parse` — and therefore the masthead's `fetch().json()` — rejects). The
byte-identical **deployed** copy shipped in the sibling sims' `html5/foundation/`
folders is valid, so that valid copy was used here (the `.js`/`.css` foundation
files are byte-identical between the two). The existing Antipodes Help text in the
shared file has two pre-existing typos ("Drag on of the points", "the other
pont"); these were left as-is to keep the foundation file unmodified.

## Deviations from the original (and why)

- **World-map panel heading.** The Flash map panel had no title bar; a visible
  "World Map" heading was added so the page has a correct, non-skipping heading
  hierarchy and landmark structure (accessibility, priority 2 over the soft
  visual-layout goal).
- **Blue point is derived/read-only in the controls.** Either point is draggable
  with the pointer (exactly as in Flash). For full keyboard operability the
  **red** point is positioned with two native sliders and the blue point is shown
  as its computed antipode. Because the antipode relation is symmetric, every
  configuration reachable in the original is reachable from the keyboard.
- **Globe continents.** The globe reuses the original `_shoreData` and the exact
  orthographic geometry, but fills each continent polygon and classifies it
  front/back by average depth rather than reproducing the AS limb-clipping mask
  pixel-for-pixel. This is a soft (Goal C) visual detail; orientation, the two
  points, the equator, and the connecting line are geometrically faithful.
- **Timing/animation.** The original had no autonomous animation; there is no
  requestAnimationFrame render loop and no Pause control is needed. (Redraws are
  synchronous on each interaction so canvas, DOM and the live region stay in
  sync.)

## Verification performed (no emulator)

Because the automated screenshot tool could not capture this MathJax-SVG-heavy
page, rendering was verified by scripted inspection of the running page (served
over HTTP):

- Map alignment: sampling `worldmap.jpg` pixels at the projected positions of
  nine known places — Sahara, Central Africa, Amazon, Australia, India, Europe
  (all read **land**) and mid-Pacific, mid-Atlantic, North Atlantic (all read
  **ocean**) — confirms continents line up with the coordinate system, so the
  dots sit on the correct geography.
- Globe: at reset the red point is on the front hemisphere (depth +0.98, over
  Iberia/W. Africa), the blue point on the back (−0.98), north-up, antipodal.
- Antipode math, pointer drag (map dot, map pan, globe rotate, globe dot),
  snap-to-5°, restrict (meridians locks the longitude slider, parallels locks
  latitude), the sliders, keyboard (arrows / Page / Home / End), and Reset all
  produce the expected state.
- MathJax typesets all 30 border labels, the four coordinate readouts, and the
  "5°" in the snap label (tex-svg output, so the MathJax context menu works on
  every symbol). No console errors; all assets load over HTTP.
- Responsive: desktop three-column layout (map full-width on top); single-column
  stacked reading order at phone-portrait width with no horizontal scroll.

Human screen-reader QA (NVDA + VoiceOver) is still recommended — see
ACCESSIBILITY.md.
