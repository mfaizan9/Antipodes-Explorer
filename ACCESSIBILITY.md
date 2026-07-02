# Accessibility Notes — Antipodes Explorer

Target: WCAG 2.1 AA (AAA where reasonable). Built on the KL-UNL foundation; all
sim-specific affordances live in `index.html`, `styles/styles.css`,
`simulation.js`. Human screen-reader QA on **both NVDA (Windows) and VoiceOver
(macOS)** is still required.

## Structure & landmarks
- One `<h1>` — rendered by `<kl-unl-masthead>` (the sim adds no competing h1).
- `<main class="app-shell">`; each panel is a `<section>` with an `<h2>` heading
  ("World Map", "Transparent Globe View", "Point Locations", "Options") in a
  non-skipping order.
- `<html lang="en">`.

## Text alternatives for the canvases (1.1.1)
Each `<canvas>` is `role="application"` with `aria-describedby` pointing at:
- a live description (`#map-desc` / `#globe-desc`) updated from the single
  `render()` with the current state, e.g. *"Red point at latitude 42 degrees
  north, longitude 5 degrees west. Blue antipode at latitude 42 degrees south,
  longitude 175 degrees east."*; and
- a static help string describing the controls (drag / arrow keys).

## Units are always spoken with numbers (supervisor requirement)
Every value is announced with its **quantity name and unit spelled as words**,
never a bare number:
- The red-point sliders carry `aria-valuetext` like `"42 degrees north"` /
  `"5 degrees west"` (updated on every change) so screen readers speak the full
  value even though the visible readout is a degree glyph.
- The blue (antipode) readouts are MathJax visually (`aria-hidden`) with an
  adjacent `.sr-only` companion (`"42 degrees south"`, `"175 degrees east"`).
- The `aria-live="polite"` status region (`#sr-status`) announces the full
  red + blue coordinates **on commit** (drag release, slider change, keyboard
  move, reset) — not on every tick — to avoid flooding.

## Color & contrast (1.4.1 / 1.4.3 / 1.4.11)
- Palette via KL-UNL CSS variables. Text ≥ 4.5:1.
- The two points keep the original hues (red `#F06060`, blue `#8080FF`) but color
  is **never the only signal**: each has a labelled swatch ("Red point", "Blue
  point (antipode)"), a black outline, and its own coordinate readout, and the
  points are on opposite sides of the diagram.

## Keyboard (2.1.1 / 2.1.2 / 2.4.7)
- Everything operable by keyboard; visible focus ring from `kl-unl.css`; no traps
  (the masthead dialog manages its own focus).
- **Sliders are native `<input type="range">`** — full keyboard support for free
  (Arrow keys step; Page Up/Down larger; Home/End min/max), each with a real
  `<label>` and units in `aria-valuetext`. Step is 1° normally, 5° when *snap* is
  on. When *restrict dragging* locks an axis, that axis's slider is `disabled` so
  keyboard users cannot change the locked quantity either.
- **The Red and Blue points are keyboard tab stops on both the map and the
  globe.** Because the points are drawn on the `<canvas>`, each is backed by a
  transparent, focusable handle (`role="application"`) positioned over the dot
  (`pointer-events:none`, so mouse dragging on the canvas is unaffected). When a
  handle is focused: Left/Right change that point's longitude, Up/Down its
  latitude; Page Up/Down change longitude by 15°; Home/End jump to the prime
  meridian / date line — honoring snap and restrict. Moving one point moves the
  other to the antipode. A visible focus ring appears around the focused point.
- **Map canvas** (focusable): arrow keys slide (pan) the map — Left/Right by 15°,
  Page Up/Down by 45°, Home re-centers — the keyboard equivalent of dragging empty
  map area. The new center longitude is announced.
- **Globe canvas** (focusable): arrow keys rotate the view.
- The red point's latitude/longitude sliders in the Point Locations panel remain
  as an alternative, fully-labelled way to set the red point.
- MathJax readouts and the map's degree labels are **removed from the tab order**
  (`tabindex="-1"` on each `mjx-container`) so tabbing lands only on real
  controls; the right-click "Show Math As" menu still works.
- Pointer and keyboard mutate the **same** state object, so they stay in sync.

## Pointer / touch (2.5, iOS Safari)
- Pointer Events (`pointerdown/move/up`) — one path for mouse and touch.
- `touch-action: none` on both canvases so dragging a point or rotating the globe
  does not scroll/zoom the page; pointer coordinates are mapped back through the
  CSS scale so hit-testing and the snapping math run in the original stage
  coordinates at any display size.
- No hover-only affordances. Interactive controls meet the ≥ 44 px target size
  (sliders and choice rows are ≥ 2.75 rem tall).

## Timing / motion (2.2.2 / 2.3.3)
- No autonomous animation, so nothing moves > 5 s and nothing flashes; no Pause
  control is required. Reset is provided by the masthead (`sim-reset`).

## Math (MathJax)
- Every mathematical symbol in the UI — the degree glyphs and N/S/E/W in the
  border labels and coordinate readouts, and the "5°" in the snap option — is
  typeset by MathJax (tex-svg) via LaTeX, not drawn on the canvas or written as
  plain text. Right-clicking any of them opens the MathJax context menu
  ("Show Math As → TeX / MathML"); the menu is not disabled or overridden.
- Border labels live in HTML overlays (not baked into the canvas) so they are
  spoken, zoomable, and MathJax-typeset. No math is painted on the `<canvas>`.

## Text size / zoom (1.4.4 / 1.4.10)
- Body ≥ 1.125 rem; sizing in rem/em. The layout reflows without clipping at
  200% zoom and down to phone-portrait width (single column, no horizontal
  scroll); the canvases scale via CSS while keeping their internal coordinates.

## Known items for human QA
- Confirm NVDA and VoiceOver both read a clear *name + value + unit* when tabbing
  through the sliders and that the live-region announcements are not duplicated or
  cut off.
- Confirm the map/globe `role="application"` description is announced usefully on
  focus in both screen readers.
