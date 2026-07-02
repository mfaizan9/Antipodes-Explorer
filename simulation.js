/* =============================================================================
   Antipodes Explorer — HTML5 port of the Adobe Flash (AS1) simulation.

   Ground truth for BEHAVIOR is the decompiled ActionScript:
     - main controller  : DefineSprite_187/frame_1/DoAction.as
     - flat map          : "Flat Map Component 007 modified.as"
     - draggable dots    : AntipodeDot.as / AntipodeDotForSphere.as
     - globe / sphere    : "Globe Component v2.as", "CelestialSphere" (CS *.as)

   Core idea: a red point on the Earth and its ANTIPODE (blue) — the point on the
   exact opposite side of the globe. Dragging either point moves the other to the
   antipodal point. An equirectangular world map and a transparent 3-D globe show
   the same two points.

   Antipode of (lon, lat)  ->  (lon + 180 wrapped to [-180,180],  -lat).      */
/* ========================================================================== */

(function () {
  "use strict";

  // --- Constants copied verbatim from the AS source --------------------------
  var RAD = Math.PI / 180;
  var DOT_RED_HEX  = "#f06060";   // AS fillColor 15753312 = 0xF06060
  var DOT_BLUE_HEX = "#8080ff";   // AS fillColor  8421631 = 0x8080FF
  var EQUATOR_RGB  = "48,144,48"; // AS color 3182640 = 0x309030 (dark green)
  var CONNECT_RGB  = "64,64,64";  // AS color 4210752 = 0x404040

  // Flat map internal geometry (Flat Map Component). mapWidth = 2 * mapHeight.
  var MAPH = 350, MAPW = 2 * MAPH, MB = 8;         // MB = border band width
  var N_LON_DIV = 8, N_LAT_DIV = 6;                // border divisions
  var INIT_OFFSET = 100;                           // reset(): longitudeOffset = 100

  // Reset state (main DoAction reset()).
  var RESET_RED  = { lon: -5, lat: 42 };
  var RESET_VIEW = { theta: RESET_RED.lon + 15 + 180,               // 190
                     phi:  (RESET_RED.lat <= 0 ? RESET_RED.lat + 5   // 37
                                               : RESET_RED.lat - 5) };

  // Globe drawing geometry (our pixels; the projection math is unit-sphere).
  var G_SIZE = 300, GC = G_SIZE / 2, GR = 110;

  // --- Single source of truth: one state object ------------------------------
  var state = {
    red:   { lon: RESET_RED.lon, lat: RESET_RED.lat },
    blue:  { lon: 0, lat: 0 },       // always the antipode of red (derived)
    offset: INIT_OFFSET,             // map longitude pan
    restrict: false,                 // "restrict dragging along..."
    restrictMode: "longitude",       // "longitude" = lock lon (meridians)
                                     // "latitude"  = lock lat (parallels)
    snap: false,                     // snap to multiples of 5 degrees
    view: { theta: RESET_VIEW.theta, phi: RESET_VIEW.phi }
  };

  // --- DOM handles -----------------------------------------------------------
  var mapCanvas, mapCtx, globeCanvas, globeCtx, mapLabels, worldImg;
  var el = {};   // filled in on load

  // ===========================================================================
  //  MATH HELPERS  (ported from the AS)
  // ===========================================================================

  // Normalise a longitude into (-180, 180], matching the AS modulo expressions
  //   ((lon + 180) % 360 + 360) % 360 - 180
  function normLon(lon) {
    return ((lon + 180) % 360 + 360) % 360 - 180;
  }

  // Antipode: main DoAction setObjectPosition() computes the "other" point as
  //   { lon: 180 + lon,  lat: -lat }  (both normalised).
  function antipode(p) {
    return { lon: normLon(180 + p.lon), lat: -p.lat };
  }

  // Geographic (lon,lat in degrees) -> unit vector, natural convention.
  function toVec(lon, lat) {
    var cl = Math.cos(lat * RAD);
    return { x: cl * Math.cos(lon * RAD), y: cl * Math.sin(lon * RAD), z: Math.sin(lat * RAD) };
  }

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  // --- Readout formatting (verbatim from setObjectPosition text lines) --------
  function latText(lat) {
    return lat < 0 ? Math.round(-lat) + "° S" : Math.round(lat) + "° N";
  }
  function lonText(lon) {
    return lon < 0 ? Math.round(-lon) + "° W" : Math.round(lon) + "° E";
  }
  function latTeX(lat) {
    return "\\(" + Math.round(Math.abs(lat)) + "^\\circ\\," +
           "\\text{" + (lat < 0 ? "S" : "N") + "}\\)";
  }
  function lonTeX(lon) {
    return "\\(" + Math.round(Math.abs(lon)) + "^\\circ\\," +
           "\\text{" + (lon < 0 ? "W" : "E") + "}\\)";
  }
  function latSpoken(lat) {
    return Math.round(Math.abs(lat)) + " degrees " + (lat < 0 ? "south" : "north");
  }
  function lonSpoken(lon) {
    return Math.round(Math.abs(lon)) + " degrees " + (lon < 0 ? "west" : "east");
  }

  // ===========================================================================
  //  STATE MUTATION  (ported from main DoAction setObjectPosition / handlers)
  // ===========================================================================

  // Move one point (name = "red" | "blue") to pos; the other becomes its
  // antipode. Mirrors setObjectPosition() in the main controller.
  function setPoint(name, pos) {
    var other = name === "red" ? "blue" : "red";
    var p = { lon: normLon(pos.lon), lat: clamp(pos.lat, -90, 90) };
    state[name]  = p;
    state[other] = antipode(p);
  }

  // Apply snap + restrict to a raw dragged position, matching AntipodeDot
  // onMouseMoveFunc: snap first (round lat/lon to 5), then restrict locks the
  // dot's current lat ("latitude") or current lon ("longitude").
  function applySnapRestrict(name, raw) {
    var out = { lon: raw.lon, lat: raw.lat };
    if (state.snap) {
      out.lat = 5 * Math.round(out.lat / 5);
      out.lon = 5 * Math.round(out.lon / 5);
    }
    if (state.restrict) {
      if (state.restrictMode === "latitude")  out.lat = state[name].lat; // lock lat
      else if (state.restrictMode === "longitude") out.lon = state[name].lon; // lock lon
    }
    return out;
  }

  // ===========================================================================
  //  FLAT MAP
  // ===========================================================================

  // Longitude -> content x in [0, MAPW).  (see getScreenPointFromPosition +
  // longitude offset; net formula screenX = ((lon - offset)/360) * MAPW mod W)
  function lonToX(lon) {
    var x = ((lon - state.offset) / 360 * MAPW) % MAPW;
    return (x + MAPW) % MAPW;
  }
  function latToY(lat) { return (90 - lat) / 360 * MAPW; }   // 0..MAPH

  // Canvas pixel <-> geographic (used for pointer hit-testing and dragging).
  function mapCanvasToGeo(cx, cy) {
    var contentX = cx - MB;
    var lon = state.offset + contentX / MAPW * 360;
    var lat = 90 - (cy - MB) / MAPW * 360;
    return { lon: normLon(lon), lat: clamp(lat, -90, 90) };
  }

  function drawMap() {
    var ctx = mapCtx;
    ctx.clearRect(0, 0, mapCanvas.width, mapCanvas.height);

    // Map image (clipped to the map rectangle), tiled to cover the wrap.
    ctx.save();
    ctx.beginPath();
    ctx.rect(MB, MB, MAPW, MAPH);
    ctx.clip();
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(MB, MB, MAPW, MAPH);
    if (worldImg && worldImg.complete && worldImg.naturalWidth) {
      // Image is two identical worlds side by side (1400x350). Draw ONE world
      // (source columns 0..MAPW) at 1:1 and tile it to cover the wrap. The x=0
      // column of the image is longitude -180.
      var start = MB + (((-180 - state.offset) / 360 * MAPW) % MAPW + MAPW) % MAPW;
      for (var k = -2; k <= 1; k++) {
        ctx.drawImage(worldImg, 0, 0, MAPW, worldImg.naturalHeight,
                      start + k * MAPW, MB, MAPW, MAPH);
      }
    }
    // wrapped dot copies live inside the same clip
    drawMapDot(ctx, state.blue, DOT_BLUE_HEX);
    drawMapDot(ctx, state.red,  DOT_RED_HEX);
    ctx.restore();

    drawMapBorder(ctx);
  }

  function drawMapDot(ctx, p, color) {
    var y = MB + latToY(p.lat);
    var xc = MB + lonToX(p.lon);
    for (var k = -1; k <= 1; k++) {   // wrap copies (AS keeps 4 copies)
      var x = xc + k * MAPW;
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = "#000000";
      ctx.stroke();
    }
  }

  // Checkered black/white frame (updateBorder). Cosmetic; panned horizontally.
  function drawMapBorder(ctx) {
    var W = mapCanvas.width, H = mapCanvas.height;
    var cellW = MAPW / (2 * N_LON_DIV);   // 16 cells across
    var cellH = MAPH / N_LAT_DIV;         // 6 cells down
    var panPx = ((MB + (((-180 - state.offset) / 360 * MAPW) % MAPW + MAPW) % MAPW) % (2 * cellW));

    // white base under the whole border band
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, MB);
    ctx.fillRect(0, H - MB, W, MB);
    ctx.fillRect(0, 0, MB, H);
    ctx.fillRect(W - MB, 0, MB, H);

    ctx.fillStyle = "#000000";
    // top + bottom checkers (shift with pan)
    var i, x;
    for (i = -1; ; i++) {
      x = MB + panPx + i * 2 * cellW;
      if (x > W) break;
      if (x + cellW < MB) continue;
      var x0 = Math.max(x, MB), x1 = Math.min(x + cellW, MB + MAPW);
      if (x1 > x0) {
        ctx.fillRect(x0, 0, x1 - x0, MB);
        ctx.fillRect(x0, H - MB, x1 - x0, MB);
      }
    }
    // left + right checkers (fixed)
    for (i = 0; i < N_LAT_DIV; i++) {
      if (i % 2 === 0) {
        ctx.fillRect(0, MB + i * cellH, MB, cellH);
        ctx.fillRect(W - MB, MB + i * cellH, MB, cellH);
      }
    }
    // thin outline around the map rectangle
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 1;
    ctx.strokeRect(MB - 0.5, MB - 0.5, MAPW + 1, MAPH + 1);
  }

  // --- Border degree labels (real HTML, typeset by MathJax) ------------------
  // Built once; longitude labels reposition on pan, latitude labels are fixed.
  var lonLabelEls = [];   // { el, value }
  function buildMapLabels() {
    mapLabels.innerHTML = "";
    lonLabelEls = [];
    var W = mapCanvas.width, H = mapCanvas.height, i, lon, lat, tex, span;

    // longitude labels: values round(i*45), formatted like attachBorderLabels
    for (i = 0; i < N_LON_DIV; i++) {
      lon = Math.round(i * (360 / N_LON_DIV));
      if (lon === 0)        tex = "\\(0^\\circ\\)";
      else if (lon === 180) tex = "\\(180^\\circ\\)";
      else if (lon < 180)   tex = "\\(" + lon + "^\\circ\\,\\text{E}\\)";
      else                  tex = "\\(" + (360 - lon) + "^\\circ\\,\\text{W}\\)";
      // one span top, one bottom
      span = mkLabel("lbl lbl--top", tex);   mapLabels.appendChild(span);
      var span2 = mkLabel("lbl lbl--bottom", tex); mapLabels.appendChild(span2);
      lonLabelEls.push({ value: lon, top: span, bottom: span2 });
    }
    // latitude labels: 90..-90 step 30 (7 values, 6 divisions)
    for (i = 0; i <= N_LAT_DIV; i++) {
      lat = Math.round(90 - i * (180 / N_LAT_DIV));
      if (lat > 0)      tex = "\\(" + lat + "^\\circ\\,\\text{N}\\)";
      else if (lat < 0) tex = "\\(" + (-lat) + "^\\circ\\,\\text{S}\\)";
      else              tex = "\\(0^\\circ\\)";
      var yPct = ((MB + latToY(lat)) / H) * 100;
      var l = mkLabel("lbl lbl--left", tex);  l.style.top = yPct + "%"; mapLabels.appendChild(l);
      var r = mkLabel("lbl lbl--right", tex); r.style.top = yPct + "%"; mapLabels.appendChild(r);
    }
    positionLonLabels();
    typesetStatic(Array.prototype.slice.call(mapLabels.querySelectorAll(".lbl")));
  }

  function mkLabel(cls, tex) {
    var s = document.createElement("span");
    s.className = cls;
    s.textContent = tex;
    return s;
  }

  function positionLonLabels() {
    var W = mapCanvas.width;
    for (var i = 0; i < lonLabelEls.length; i++) {
      var o = lonLabelEls[i];
      var xPct = ((MB + lonToX(o.value)) / W) * 100;
      o.top.style.left = xPct + "%";
      o.bottom.style.left = xPct + "%";
    }
  }

  // ===========================================================================
  //  GLOBE  (orthographic; the AS tilt+rotation matrix q reduces to
  //          diag(-1,-1,1), so continents and points share one projection)
  // ===========================================================================

  // Project a geographic unit vector n to the globe canvas.
  // world w = (-n.x, -n.y, n.z); orthographic basis from (theta, phi).
  function globeProject(n) {
    var th = state.view.theta * RAD, ph = state.view.phi * RAD;
    var st = Math.sin(th), ct = Math.cos(th), sp = Math.sin(ph), cp = Math.cos(ph);
    var wx = -n.x, wy = -n.y, wz = n.z;
    var sx = -st * wx + ct * wy;
    var sy = ct * sp * wx + st * sp * wy - cp * wz;
    var depth = ct * cp * wx + st * cp * wy + sp * wz;
    return { x: GC + GR * sx, y: GC + GR * sy, z: depth };
  }

  // Inverse: globe canvas pixel -> geographic (front hemisphere), mirrors
  // StoMH + MHtoC used by AntipodeDotForSphere.
  function globeCanvasToGeo(cx, cy) {
    var th = state.view.theta * RAD, ph = state.view.phi * RAD;
    var st = Math.sin(th), ct = Math.cos(th), sp = Math.sin(ph), cp = Math.cos(ph);
    var u = (cx - GC) / GR, v = (cy - GC) / GR;
    var rr = u * u + v * v;
    if (rr > 1) { var s = 1 / Math.sqrt(rr); u *= s; v *= s; rr = 1; }
    var d = Math.sqrt(Math.max(0, 1 - rr));
    // basis vectors (columns): e1 screen-x, e2 screen-y, e3 depth
    var wx = u * (-st) + v * (ct * sp) + d * (ct * cp);
    var wy = u * (ct)  + v * (st * sp) + d * (st * cp);
    var wz = u * 0     + v * (-cp)     + d * (sp);
    var nx = -wx, ny = -wy, nz = wz;
    return { lon: normLon(Math.atan2(ny, nx) / RAD), lat: clamp(Math.asin(clamp(nz, -1, 1)) / RAD, -90, 90) };
  }

  var SHORE = (window.SHORE_DATA || []);

  function drawGlobe() {
    var ctx = globeCtx;
    ctx.clearRect(0, 0, G_SIZE, G_SIZE);

    ctx.save();
    ctx.beginPath();
    ctx.arc(GC, GC, GR, 0, 2 * Math.PI);
    ctx.clip();

    // ocean disc
    ctx.fillStyle = "#f2f5f8";
    ctx.fillRect(0, 0, G_SIZE, G_SIZE);

    // split continent polygons into back / front by average depth
    var back = [], front = [], i;
    for (i = 0; i < SHORE.length; i++) {
      var poly = SHORE[i], pts = [], sum = 0;
      for (var j = 0; j < poly.length; j++) {
        var s = globeProject(poly[j]);
        pts.push(s); sum += s.z;
      }
      (sum >= 0 ? front : back).push(pts);
    }

    // back continents (faint, seen through the transparent globe)
    ctx.fillStyle = "#d3d8dc";
    fillPolys(ctx, back);
    // equator back segment
    drawEquator(ctx, false);
    // veil to fade the far side (celestialBowl shading: white inner, dark rim)
    ctx.fillStyle = "rgba(255,255,255,0.42)";
    ctx.fillRect(0, 0, G_SIZE, G_SIZE);
    // front continents (solid)
    ctx.fillStyle = "#a9afb5";
    fillPolys(ctx, front);
    // equator front segment
    drawEquator(ctx, true);

    ctx.restore();

    // connecting line between the two points (straight, screen space)
    var rp = globeProject(toVec(state.red.lon, state.red.lat));
    var bp = globeProject(toVec(state.blue.lon, state.blue.lat));
    ctx.strokeStyle = "rgba(" + CONNECT_RGB + ",0.5)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(rp.x, rp.y); ctx.lineTo(bp.x, bp.y); ctx.stroke();

    // points: far side faded, near side solid & on top
    drawGlobeDot(ctx, bp, DOT_BLUE_HEX);
    drawGlobeDot(ctx, rp, DOT_RED_HEX);

    // rim
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(GC, GC, GR, 0, 2 * Math.PI); ctx.stroke();
  }

  function fillPolys(ctx, polys) {
    for (var i = 0; i < polys.length; i++) {
      var pts = polys[i];
      if (pts.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (var j = 1; j < pts.length; j++) ctx.lineTo(pts[j].x, pts[j].y);
      ctx.closePath();
      ctx.fill();
    }
  }

  function drawEquator(ctx, wantFront) {
    ctx.strokeStyle = "rgba(" + EQUATOR_RGB + "," + (wantFront ? 0.85 : 0.35) + ")";
    ctx.lineWidth = 1.5;
    var started = false;
    ctx.beginPath();
    for (var a = 0; a <= 360; a += 3) {
      var n = { x: Math.cos(a * RAD), y: Math.sin(a * RAD), z: 0 };
      var p = globeProject(n);
      var isFront = p.z >= 0;
      if (isFront === wantFront) {
        if (!started) { ctx.moveTo(p.x, p.y); started = true; }
        else ctx.lineTo(p.x, p.y);
      } else { started = false; }
    }
    ctx.stroke();
  }

  function drawGlobeDot(ctx, p, color) {
    ctx.globalAlpha = p.z >= 0 ? 1 : 0.4;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 6, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "#000000";
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // ===========================================================================
  //  MathJax typesetting (throttled) and readouts / live region
  // ===========================================================================
  // Run fn once MathJax has finished its (asynchronous) startup. Uses setTimeout
  // rather than rAF so it still fires when the tab is backgrounded.
  function whenMathJax(fn) {
    if (window.MathJax && MathJax.startup && MathJax.startup.promise &&
        MathJax.typesetPromise) {
      MathJax.startup.promise.then(fn);
    } else {
      setTimeout(function () { whenMathJax(fn); }, 50);
    }
  }

  // MathJax's tex-svg output makes every <mjx-container> focusable (tabindex=0)
  // so the menu can be opened by keyboard. These are read-only labels/readouts,
  // not controls, so keep them OUT of the Tab order. Right-click still opens the
  // MathJax context menu (that does not require the element to be focusable).
  function stripMathTab() {
    var list = document.querySelectorAll("mjx-container[tabindex]");
    for (var i = 0; i < list.length; i++) list[i].setAttribute("tabindex", "-1");
  }

  // Static math (border labels, the "5 degrees" in the snap label) is typeset
  // exactly once. Disjoint node sets, so separate calls never touch the same
  // node concurrently.
  function typesetStatic(nodes) {
    if (!nodes.length) return;
    whenMathJax(function () {
      MathJax.typesetPromise(nodes).then(stripMathTab).catch(function (e) { console.error(e); });
    });
  }

  // The four coordinate readouts change during a drag. MathJax throws
  // ("replaceChild of null") if a node's DOM is mutated while it is being
  // typeset, so use a single-flight guard: never re-enter while a typeset is in
  // flight; apply the latest values once it resolves.
  var roBusy = false, roDirty = false;
  function applyReadoutMath() {
    el.redLatOut.textContent  = latTeX(state.red.lat);
    el.redLonOut.textContent  = lonTeX(state.red.lon);
    el.blueLatOut.textContent = latTeX(state.blue.lat);
    el.blueLonOut.textContent = lonTeX(state.blue.lon);
    var nodes = [el.redLatOut, el.redLonOut, el.blueLatOut, el.blueLonOut];
    roBusy = true;
    whenMathJax(function () {
      try { if (MathJax.typesetClear) MathJax.typesetClear(nodes); } catch (e) {}
      MathJax.typesetPromise(nodes).then(function () {
        stripMathTab(); finishReadout();
      }, function (e) { console.error(e); finishReadout(); });
    });
  }
  function finishReadout() {
    roBusy = false;
    if (roDirty) { roDirty = false; applyReadoutMath(); }
  }

  function updateReadouts() {
    // Screen-reader text and slider aria are cheap DOM writes, always safe.
    el.blueLatSr.textContent = latSpoken(state.blue.lat);
    el.blueLonSr.textContent = lonSpoken(state.blue.lon);
    // Dynamic MathJax readouts go through the single-flight guard.
    if (roBusy) roDirty = true;
    else applyReadoutMath();
  }

  function syncSliders() {
    el.redLat.value = Math.round(state.red.lat);
    el.redLon.value = Math.round(state.red.lon);
    el.redLat.setAttribute("aria-valuetext", latSpoken(state.red.lat));
    el.redLon.setAttribute("aria-valuetext", lonSpoken(state.red.lon));
  }

  function diagramDescription() {
    return "Red point at latitude " + latSpoken(state.red.lat) +
           ", longitude " + lonSpoken(state.red.lon) +
           ". Blue antipode at latitude " + latSpoken(state.blue.lat) +
           ", longitude " + lonSpoken(state.blue.lon) + ".";
  }

  function announce() {
    el.status.textContent = diagramDescription();
  }

  // ===========================================================================
  //  RENDER  (single function: canvas + DOM + descriptions in sync)
  // ===========================================================================
  function render() {
    drawMap();
    positionLonLabels();
    drawGlobe();
    updateReadouts();
    syncSliders();
    updateHandles();
    var desc = diagramDescription();
    el.mapDesc.textContent = desc;
    el.globeDesc.textContent = desc;
  }

  // Keep the focusable keyboard handles positioned over their points and their
  // accessible names current. Percentage positions track the CSS scaling of the
  // canvas (the handle overlay shares the canvas box).
  function placeHandle(h, fx, fy) {
    h.style.left = (fx * 100) + "%";
    h.style.top  = (fy * 100) + "%";
  }
  function updateHandles() {
    placeHandle(el.mapRed,  (MB + lonToX(state.red.lon))  / mapCanvas.width,
                            (MB + latToY(state.red.lat))  / mapCanvas.height);
    placeHandle(el.mapBlue, (MB + lonToX(state.blue.lon)) / mapCanvas.width,
                            (MB + latToY(state.blue.lat)) / mapCanvas.height);
    el.mapRed.setAttribute("aria-label",
      "Red point on the map. Latitude " + latSpoken(state.red.lat) +
      ", longitude " + lonSpoken(state.red.lon) + ".");
    el.mapBlue.setAttribute("aria-label",
      "Blue point on the map. Latitude " + latSpoken(state.blue.lat) +
      ", longitude " + lonSpoken(state.blue.lon) + ".");

    var rp = globeProject(toVec(state.red.lon, state.red.lat));
    var bp = globeProject(toVec(state.blue.lon, state.blue.lat));
    placeHandle(el.globeRed,  rp.x / G_SIZE, rp.y / G_SIZE);
    placeHandle(el.globeBlue, bp.x / G_SIZE, bp.y / G_SIZE);
    el.globeRed.setAttribute("aria-label",
      "Red point on the globe. Latitude " + latSpoken(state.red.lat) +
      ", longitude " + lonSpoken(state.red.lon) + ". " +
      (rp.z < 0 ? "On the far side." : "On the near side."));
    el.globeBlue.setAttribute("aria-label",
      "Blue point on the globe. Latitude " + latSpoken(state.blue.lat) +
      ", longitude " + lonSpoken(state.blue.lon) + ". " +
      (bp.z < 0 ? "On the far side." : "On the near side."));
  }

  // ===========================================================================
  //  POINTER INTERACTION
  // ===========================================================================

  // Map: pointer maps through the CSS scale back to backing-store coordinates.
  function canvasPoint(canvas, evt) {
    var r = canvas.getBoundingClientRect();
    return {
      x: (evt.clientX - r.left) * (canvas.width / r.width),
      y: (evt.clientY - r.top)  * (canvas.height / r.height)
    };
  }

  function hitDotOnMap(cx, cy, p) {
    var y = MB + latToY(p.lat);
    for (var k = -1; k <= 1; k++) {
      var x = MB + lonToX(p.lon) + k * MAPW;
      if ((cx - x) * (cx - x) + (cy - y) * (cy - y) <= 100) return true; // ~10px
    }
    return false;
  }

  function initMapPointer() {
    var mode = null, dragName = null, panStartX = 0, panStartOffset = 0;

    mapCanvas.addEventListener("pointerdown", function (e) {
      mapCanvas.setPointerCapture(e.pointerId);
      var pt = canvasPoint(mapCanvas, e);
      if (hitDotOnMap(pt.x, pt.y, state.red)) { mode = "dot"; dragName = "red"; }
      else if (hitDotOnMap(pt.x, pt.y, state.blue)) { mode = "dot"; dragName = "blue"; }
      else { mode = "pan"; panStartX = pt.x; panStartOffset = state.offset; }
      e.preventDefault();
    });

    mapCanvas.addEventListener("pointermove", function (e) {
      var pt = canvasPoint(mapCanvas, e);
      if (!mode) {
        // Hover: show a pointing-finger cursor over a draggable point, otherwise
        // fall back to the CSS grab hand.
        mapCanvas.style.cursor =
          (hitDotOnMap(pt.x, pt.y, state.red) || hitDotOnMap(pt.x, pt.y, state.blue))
            ? "pointer" : "";
        return;
      }
      if (mode === "dot") {
        var raw = mapCanvasToGeo(pt.x, pt.y);
        setPoint(dragName, applySnapRestrict(dragName, raw));
      } else {                      // pan the map (dragOnMouseMoveFunc)
        var d = (pt.x - panStartX) * (360 / MAPW);
        state.offset = ((panStartOffset - d) % 360 + 360) % 360;
      }
      render();
      e.preventDefault();
    });

    mapCanvas.addEventListener("pointerleave", function () {
      if (!mode) mapCanvas.style.cursor = "";
    });

    function end(e) {
      if (mode === "dot") announce();
      mode = null; dragName = null;
      try { mapCanvas.releasePointerCapture(e.pointerId); } catch (x) {}
    }
    mapCanvas.addEventListener("pointerup", end);
    mapCanvas.addEventListener("pointercancel", end);
  }

  function initGlobePointer() {
    var mode = null, dragName = null;
    var startX = 0, startY = 0, startTheta = 0, startPhi = 0;

    globeCanvas.addEventListener("pointerdown", function (e) {
      globeCanvas.setPointerCapture(e.pointerId);
      var pt = canvasPoint(globeCanvas, e);
      var rp = globeProject(toVec(state.red.lon, state.red.lat));
      var bp = globeProject(toVec(state.blue.lon, state.blue.lat));
      // only a near-side (front) dot is grabbable, matching AntipodeDotForSphere
      if (rp.z > 0 && near(pt, rp)) { mode = "dot"; dragName = "red"; }
      else if (bp.z > 0 && near(pt, bp)) { mode = "dot"; dragName = "blue"; }
      else {
        mode = "rotate"; startX = pt.x; startY = pt.y;
        startTheta = state.view.theta; startPhi = state.view.phi;
      }
      e.preventDefault();
    });

    globeCanvas.addEventListener("pointermove", function (e) {
      var pt = canvasPoint(globeCanvas, e);
      if (!mode) {
        // Hover: pointing finger over a grabbable near-side point.
        var rh = globeProject(toVec(state.red.lon, state.red.lat));
        var bh = globeProject(toVec(state.blue.lon, state.blue.lat));
        globeCanvas.style.cursor =
          ((rh.z > 0 && near(pt, rh)) || (bh.z > 0 && near(pt, bh))) ? "pointer" : "";
        return;
      }
      if (mode === "dot") {
        var raw = globeCanvasToGeo(pt.x, pt.y);
        setPoint(dragName, applySnapRestrict(dragName, raw));
      } else {
        state.view.theta = startTheta - (pt.x - startX) / GR / RAD;
        state.view.phi   = clamp(startPhi + (pt.y - startY) / GR / RAD, -90, 90);
      }
      render();
      e.preventDefault();
    });

    globeCanvas.addEventListener("pointerleave", function () {
      if (!mode) globeCanvas.style.cursor = "";
    });

    function end(e) {
      if (mode === "dot") announce();
      mode = null; dragName = null;
      try { globeCanvas.releasePointerCapture(e.pointerId); } catch (x) {}
    }
    globeCanvas.addEventListener("pointerup", end);
    globeCanvas.addEventListener("pointercancel", end);

    function near(pt, p) {
      return (pt.x - p.x) * (pt.x - p.x) + (pt.y - p.y) * (pt.y - p.y) <= 144; // 12px
    }
  }

  // ===========================================================================
  //  KEYBOARD (canvas focus)
  // ===========================================================================
  // Arrow-key mover for a named point (red|blue). Used by all four focusable
  // point handles (red/blue on the map and the globe). Same latitude/longitude
  // steps everywhere; the other point follows to the antipode.
  function pointKeydown(name) {
    return function (e) {
      var step = state.snap ? 5 : 1, big = 15;
      var p = { lon: state[name].lon, lat: state[name].lat }, handled = true;
      switch (e.key) {
        case "ArrowLeft":  p.lon -= step; break;
        case "ArrowRight": p.lon += step; break;
        case "ArrowUp":    p.lat += step; break;
        case "ArrowDown":  p.lat -= step; break;
        case "PageUp":     p.lon += big; break;
        case "PageDown":   p.lon -= big; break;
        case "Home":       p.lon = 0; break;
        case "End":        p.lon = 180; break;
        default: handled = false;
      }
      if (!handled) return;
      e.preventDefault();
      setPoint(name, applySnapRestrict(name, p));
      render(); announce();
    };
  }
  function initPointHandles() {
    el.mapRed.addEventListener("keydown",  pointKeydown("red"));
    el.mapBlue.addEventListener("keydown", pointKeydown("blue"));
    el.globeRed.addEventListener("keydown",  pointKeydown("red"));
    el.globeBlue.addEventListener("keydown", pointKeydown("blue"));
  }

  // Map canvas is focusable to SLIDE (pan) the map with the arrow keys — the
  // keyboard equivalent of dragging empty map area. Left/Right shift the
  // longitude offset; Home re-centers to the initial view.
  function initMapPan() {
    mapCanvas.addEventListener("keydown", function (e) {
      var step = 15, big = 45, handled = true;
      switch (e.key) {
        case "ArrowLeft":  state.offset = (state.offset - step) % 360; break;
        case "ArrowRight": state.offset = (state.offset + step) % 360; break;
        case "PageUp":     state.offset = (state.offset + big)  % 360; break;
        case "PageDown":   state.offset = (state.offset - big)  % 360; break;
        case "Home":       state.offset = INIT_OFFSET; break;
        default: handled = false;
      }
      if (!handled) return;
      state.offset = (state.offset + 360) % 360;
      e.preventDefault();
      render();
      var center = normLon(state.offset + 180);
      el.status.textContent =
        "Map slid. Longitude " + lonSpoken(center) + " at the center of the map.";
    });
  }

  function initGlobeKeyboard() {
    globeCanvas.addEventListener("keydown", function (e) {
      var step = 5, handled = true;
      switch (e.key) {
        case "ArrowLeft":  state.view.theta -= step; break;
        case "ArrowRight": state.view.theta += step; break;
        case "ArrowUp":    state.view.phi = clamp(state.view.phi + step, -90, 90); break;
        case "ArrowDown":  state.view.phi = clamp(state.view.phi - step, -90, 90); break;
        default: handled = false;
      }
      if (!handled) return;
      e.preventDefault();
      render();
    });
  }

  // ===========================================================================
  //  CONTROLS (sliders, checkboxes, radios) — onRestrictChanged / onSnapChanged
  // ===========================================================================
  function readSliders() {
    return { lon: parseFloat(el.redLon.value), lat: parseFloat(el.redLat.value) };
  }

  function initControls() {
    // sliders set the red point directly (respecting the locked axis)
    function onSlider() {
      var p = readSliders();
      // the disabled (locked) slider keeps its value, so restrict is honoured
      setPoint("red", { lon: p.lon, lat: p.lat });
      render();
    }
    el.redLat.addEventListener("input", onSlider);
    el.redLon.addEventListener("input", onSlider);
    el.redLat.addEventListener("change", announce);
    el.redLon.addEventListener("change", announce);

    el.restrictCheck.addEventListener("change", function () {
      state.restrict = el.restrictCheck.checked;
      onRestrictChanged();
      render();
    });
    el.restrictLon.addEventListener("change", function () {
      if (el.restrictLon.checked) { state.restrictMode = "longitude"; onRestrictChanged(); render(); }
    });
    el.restrictLat.addEventListener("change", function () {
      if (el.restrictLat.checked) { state.restrictMode = "latitude"; onRestrictChanged(); render(); }
    });

    el.snapCheck.addEventListener("change", function () {
      state.snap = el.snapCheck.checked;
      onSnapChanged();
      render(); announce();
    });
  }

  // restrictGroup enabled only when the master checkbox is checked; the locked
  // axis's slider is disabled so keyboard users cannot change it either.
  function onRestrictChanged() {
    var enabled = state.restrict;
    el.restrictLon.disabled = !enabled;
    el.restrictLat.disabled = !enabled;
    var lockLon = enabled && state.restrictMode === "longitude";
    var lockLat = enabled && state.restrictMode === "latitude";
    el.redLon.disabled = lockLon;
    el.redLat.disabled = lockLat;
    setSliderStep();
  }

  // onSnapChanged: snap the red point immediately (5*round), matching the AS.
  function onSnapChanged() {
    if (state.snap) {
      setPoint("red", { lon: 5 * Math.round(state.red.lon / 5),
                        lat: 5 * Math.round(state.red.lat / 5) });
    }
    setSliderStep();
  }

  function setSliderStep() {
    var s = state.snap ? 5 : 1;
    el.redLat.step = s; el.redLon.step = s;
  }

  // ===========================================================================
  //  RESET  (masthead "sim-reset" event -> exact initial state)
  // ===========================================================================
  function reset() {
    state.offset = INIT_OFFSET;
    state.snap = false;
    state.restrict = false;
    state.restrictMode = "longitude";
    state.view = { theta: RESET_VIEW.theta, phi: RESET_VIEW.phi };
    setPoint("red", { lon: RESET_RED.lon, lat: RESET_RED.lat });

    el.snapCheck.checked = false;
    el.restrictCheck.checked = false;
    el.restrictLon.checked = true;
    el.restrictLat.checked = false;
    onRestrictChanged();
    render();
    announce();
  }

  // ===========================================================================
  //  INIT
  // ===========================================================================
  function grab(id) { return document.getElementById(id); }

  function init() {
    mapCanvas = grab("map-canvas");   mapCtx = mapCanvas.getContext("2d");
    globeCanvas = grab("globe-canvas"); globeCtx = globeCanvas.getContext("2d");
    mapLabels = grab("map-labels");

    el.status   = grab("sr-status");
    el.mapDesc  = grab("map-desc");
    el.globeDesc= grab("globe-desc");
    el.redLat   = grab("red-lat");   el.redLon = grab("red-lon");
    el.redLatOut = grab("red-lat-out"); el.redLonOut = grab("red-lon-out");
    el.blueLatOut = grab("blue-lat-out"); el.blueLonOut = grab("blue-lon-out");
    el.blueLatSr = grab("blue-lat-sr"); el.blueLonSr = grab("blue-lon-sr");
    el.restrictCheck = grab("restrict-check");
    el.restrictLon = grab("restrict-lon"); el.restrictLat = grab("restrict-lat");
    el.snapCheck = grab("snap-check");
    el.mapRed = grab("map-red");     el.mapBlue = grab("map-blue");
    el.globeRed = grab("globe-red"); el.globeBlue = grab("globe-blue");

    // Load the reused world-map bitmap, then redraw the map canvas once it is
    // available (readouts are unaffected, so no re-typeset here).
    worldImg = new Image();
    worldImg.onload = function () { drawMap(); positionLonLabels(); };
    worldImg.src = "assets/worldmap.jpg";

    buildMapLabels();
    initControls();
    initMapPointer();  initGlobePointer();
    initMapPan();      initGlobeKeyboard(); initPointHandles();

    // typeset the static "5 degrees" in the snap label
    var snapDeg = document.querySelector(".snap-deg");
    if (snapDeg) { snapDeg.textContent = "\\(5^\\circ\\)"; typesetStatic([snapDeg]); }

    reset();               // establishes the exact initial state (calls render)

    // reposition labels on resize (percentages already track scale, but keep
    // longitude labels aligned after layout shifts)
    window.addEventListener("resize", positionLonLabels);
  }

  // The masthead dispatches a bubbling "sim-reset" CustomEvent.
  document.addEventListener("sim-reset", reset);

  // klunlInitEqn is called by kl-unl.js on load; redefine it to boot the sim
  // once MathJax/foundation are ready (see foundation/kl-unl.js).
  window.klunlInitEqn = function () { /* sim owns its own typesetting */ };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
