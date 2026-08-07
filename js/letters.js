(() => {
  "use strict";

  const { Engine, Bodies, Body, Composite, Mouse, MouseConstraint, Sleeping } =
    Matter;

  const RATIOS = {
    "1:1": { w: 1200, h: 1200 },
    "16:9": { w: 1200, h: 675 },
    "9:16": { w: 675, h: 1200 },
  };

  const WALL_THICKNESS = 200;
  // Much thicker than the side walls: a letter stacked far above the frame
  // (big scale + "Drop from outside") can build up enough fall speed to
  // tunnel straight through a thin floor in a single physics step and
  // vanish below it forever. Kept separate from WALL_THICKNESS because
  // widening the side walls the same way would extend them far enough
  // inward to overlap letters that spawn off to the sides at big scale.
  const FLOOR_THICKNESS = 4000;
  const RASTER_TARGET = 1400; // px used when rasterizing the source SVG for splitting

  const state = {
    ratio: "1:1",
    gravity: 1,
    bounce: 0.4,
    friction: 0.3,
    air: 0.01,
    logoScale: 0.8, // fraction of canvas width the logo layout occupies
    scatter: false, // ignore original layout, drop letters at random spots/angles
    mouseEnabled: true,
    colorMode: "original", // 'original' | 'solid'
    letterColor: "#3d5afe",
    bgMode: "dark", // 'dark' | 'white' | 'solid'
    bgColor: "#0e0e12",
    videoFps: 60, // 30 | 60
    turbulence: false, // zero-G drift through a flow field instead of falling
    turbulenceStrength: 0.5, // 0..1
    turbulenceScale: 0.5, // 0..1 — how large the swirls are
    // Letters extracted from the imported SVG(s). Layout coords are relative to
    // the logo bounding box (0..1) so they can be re-fit to any canvas/scale.
    letters: [], // {img: canvas, w, h, relX, relY, relW, relH}
    bodies: [], // matter bodies, parallel to letters
  };

  const el = {
    fileInput: document.getElementById("file-input"),
    fileInputMulti: document.getElementById("file-input-multi"),
    btnImport: document.getElementById("btn-import"),
    btnImportMulti: document.getElementById("btn-import-multi"),
    btnImportEmpty: document.getElementById("btn-import-empty"),
    btnDrop: document.getElementById("btn-drop"),
    ratioSelect: document.getElementById("ratio-select"),
    stageFrame: document.getElementById("stage-frame"),
    stage: document.querySelector(".stage"),
    canvas: document.getElementById("physics-canvas"),
    emptyState: document.getElementById("empty-state"),
    ctrlGravity: document.getElementById("ctrl-gravity"),
    valGravity: document.getElementById("val-gravity"),
    ctrlBounce: document.getElementById("ctrl-bounce"),
    valBounce: document.getElementById("val-bounce"),
    ctrlFriction: document.getElementById("ctrl-friction"),
    valFriction: document.getElementById("val-friction"),
    ctrlAir: document.getElementById("ctrl-air"),
    valAir: document.getElementById("val-air"),
    ctrlLogoScale: document.getElementById("ctrl-logo-scale"),
    valLogoScale: document.getElementById("val-logo-scale"),
    ctrlMouse: document.getElementById("ctrl-mouse"),
    btnDropOutside: document.getElementById("btn-drop-outside"),
    ctrlTurbulence: document.getElementById("ctrl-turbulence"),
    turbulenceField: document.getElementById("turbulence-field"),
    ctrlTurbulenceStrength: document.getElementById("ctrl-turbulence-strength"),
    valTurbulence: document.getElementById("val-turbulence"),
    turbulenceScaleField: document.getElementById("turbulence-scale-field"),
    ctrlTurbulenceScale: document.getElementById("ctrl-turbulence-scale"),
    valTurbulenceScale: document.getElementById("val-turbulence-scale"),
    ctrlScatter: document.getElementById("ctrl-scatter"),
    ctrlAlignBaseline: document.getElementById("ctrl-align-baseline"),
    fpsModeGroup: document.getElementById("fps-mode"),
    btnExportVideo: document.getElementById("btn-export-video"),
    exportStatus: document.getElementById("export-status"),
    letterColorModeGroup: document.getElementById("letter-color-mode"),
    letterColorField: document.getElementById("letter-color-field"),
    ctrlLetterColor: document.getElementById("ctrl-letter-color"),
    bgModeGroup: document.getElementById("bg-mode"),
    bgColorField: document.getElementById("bg-color-field"),
    ctrlBgColor: document.getElementById("ctrl-bg-color"),
    statCount: document.getElementById("stat-count"),
  };

  const ctx = el.canvas.getContext("2d");

  // ---------- Matter setup ----------

  const engine = Engine.create({ enableSleeping: true });
  let walls = [];
  let mouseConstraint = null;
  const tintCache = new Map(); // letter index -> {color, canvas}

  function rebuildWalls() {
    for (const w of walls) Composite.remove(engine.world, w);
    const dims = RATIOS[state.ratio];
    const opts = { isStatic: true, friction: 0.6 };
    const ft = FLOOR_THICKNESS;
    // Side walls sit just outside the frame edges and grow outward, so their
    // thickness never intrudes on the canvas. They stay thin in normal mode
    // because letters can legitimately spawn far out to the sides at big
    // "Logo scale" — a thick wall would swallow them. Zero-G always spawns
    // inside the frame, so there they can be thick enough that a fast
    // drifting letter can't tunnel through and escape.
    const t = state.turbulence ? ft : WALL_THICKNESS;
    // "Logo scale" is unclamped, so at high values letters can spawn far
    // outside the canvas horizontally — the floor has to reach well past
    // the side walls or those letters just fall through open space beside
    // it and never land.
    walls = [
      Bodies.rectangle(dims.w / 2, dims.h + ft / 2, dims.w * 12, ft, opts), // floor
      Bodies.rectangle(-t / 2, dims.h / 2, t, dims.h * 6, opts), // left
      Bodies.rectangle(dims.w + t / 2, dims.h / 2, t, dims.h * 6, opts), // right
    ];
    // Only in zero-G: without gravity holding them down, letters would drift
    // straight up and out of frame forever. Deliberately absent otherwise,
    // since "Drop from outside" starts letters above the frame and a lid
    // would block them from ever entering.
    if (state.turbulence) {
      walls.push(
        Bodies.rectangle(dims.w / 2, -ft / 2, dims.w * 12, ft, opts), // ceiling
      );
    }
    Composite.add(engine.world, walls);
  }

  function rebuildMouse() {
    if (mouseConstraint) {
      Composite.remove(engine.world, mouseConstraint);
      mouseConstraint = null;
    }
    if (!state.mouseEnabled) return;

    const mouse = Mouse.create(el.canvas);
    syncMouseScale(mouse);
    mouseConstraint = MouseConstraint.create(engine, {
      mouse,
      constraint: { stiffness: 0.15, damping: 0.1 },
    });
    Composite.add(engine.world, mouseConstraint);

    // Matter hijacks the wheel to zoom its (unused) render — give scrolling back.
    mouse.element.removeEventListener("wheel", mouse.mousewheel);
    mouse.element.removeEventListener("DOMMouseScroll", mouse.mousewheel);
  }

  function syncMouseScale(mouse) {
    const dims = RATIOS[state.ratio];
    const rect = el.canvas.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      Mouse.setScale(mouse, {
        x: dims.w / rect.width,
        y: dims.h / rect.height,
      });
    }
  }

  // ---------- Layout ----------

  function fitFrame() {
    const dims = RATIOS[state.ratio];
    const padding = 64;
    const availW = Math.max(120, el.stage.clientWidth - padding);
    const availH = Math.max(120, el.stage.clientHeight - padding);
    const ratioValue = dims.w / dims.h;

    let w = availW;
    let h = w / ratioValue;
    if (h > availH) {
      h = availH;
      w = h * ratioValue;
    }

    el.stageFrame.style.width = `${Math.round(w)}px`;
    el.stageFrame.style.height = `${Math.round(h)}px`;
    el.canvas.width = dims.w;
    el.canvas.height = dims.h;

    if (mouseConstraint) syncMouseScale(mouseConstraint.mouse);
  }

  window.addEventListener("resize", () => requestAnimationFrame(fitFrame));

  // ---------- SVG import & splitting ----------

  function parseSvgSize(svgEl) {
    const wAttr = parseFloat(svgEl.getAttribute("width"));
    const hAttr = parseFloat(svgEl.getAttribute("height"));
    if (wAttr > 0 && hAttr > 0) return { w: wAttr, h: hAttr };
    const viewBox = svgEl.getAttribute("viewBox");
    if (viewBox) {
      const p = viewBox
        .trim()
        .split(/[\s,]+/)
        .map(Number);
      if (p.length === 4 && p[2] > 0 && p[3] > 0) return { w: p[2], h: p[3] };
    }
    return { w: 512, h: 512 };
  }

  function loadSvgAsImage(svgMarkup) {
    return new Promise((resolve, reject) => {
      const blob = new Blob([svgMarkup], { type: "image/svg+xml" });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("SVG failed to load"));
      };
      img.src = url;
    });
  }

  // Rasterize svg markup at a working resolution and return {canvas, alphaBBox}
  // where alphaBBox is the tight pixel bounding box of visible content (or null).
  async function rasterizeAndCrop(svgMarkup, rasterW, rasterH) {
    const img = await loadSvgAsImage(svgMarkup);
    const canvas = document.createElement("canvas");
    canvas.width = rasterW;
    canvas.height = rasterH;
    const c = canvas.getContext("2d", { willReadFrequently: true });
    c.drawImage(img, 0, 0, rasterW, rasterH);

    const data = c.getImageData(0, 0, rasterW, rasterH).data;
    let minX = rasterW,
      minY = rasterH,
      maxX = -1,
      maxY = -1;
    for (let y = 0; y < rasterH; y++) {
      for (let x = 0; x < rasterW; x++) {
        if (data[(y * rasterW + x) * 4 + 3] > 8) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < minX) return null; // empty

    const w = maxX - minX + 1;
    const h = maxY - minY + 1;
    const cropped = document.createElement("canvas");
    cropped.width = w;
    cropped.height = h;
    cropped.getContext("2d").drawImage(canvas, minX, minY, w, h, 0, 0, w, h);
    return { canvas: cropped, x: minX, y: minY, w, h };
  }

  // Find the elements that most likely represent individual letters:
  // the direct graphic children of the root svg, descending through
  // single-child wrapper groups.
  function findLetterCandidates(svgEl) {
    const SKIP = new Set([
      "defs",
      "style",
      "title",
      "desc",
      "metadata",
      "clipPath",
      "mask",
      "linearGradient",
      "radialGradient",
      "pattern",
      "symbol",
      "filter",
    ]);
    let container = svgEl;
    for (;;) {
      const kids = [...container.children].filter(
        (k) =>
          !SKIP.has(k.tagName.toLowerCase()) &&
          k.tagName.toLowerCase() !== "script",
      );
      if (kids.length === 1 && kids[0].tagName.toLowerCase() === "g") {
        container = kids[0];
        continue;
      }
      return kids;
    }
  }

  // Everything that isn't a direct graphic candidate but might be referenced
  // (defs, styles, gradients) must ride along with each isolated letter.
  function collectSharedDefs(svgEl) {
    const KEEP = new Set([
      "defs",
      "style",
      "linearGradient",
      "radialGradient",
      "pattern",
      "clipPath",
      "mask",
      "symbol",
      "filter",
    ]);
    const serializer = new XMLSerializer();
    let out = "";
    const walk = (node) => {
      for (const child of node.children) {
        const tag = child.tagName.toLowerCase();
        if (KEEP.has(tag)) out += serializer.serializeToString(child);
        else if (tag === "g" || tag === "svg") walk(child);
      }
    };
    walk(svgEl);
    return out;
  }

  async function importSingleSvg(svgText) {
    const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
    const svgEl = doc.documentElement;
    if (svgEl.tagName.toLowerCase() !== "svg") {
      alert("This file does not look like a valid SVG.");
      return;
    }

    const size = parseSvgSize(svgEl);
    const viewBox = svgEl.getAttribute("viewBox") || `0 0 ${size.w} ${size.h}`;
    const scale = RASTER_TARGET / Math.max(size.w, size.h);
    const rasterW = Math.max(2, Math.round(size.w * scale));
    const rasterH = Math.max(2, Math.round(size.h * scale));

    const candidates = findLetterCandidates(svgEl);
    const sharedDefs = collectSharedDefs(svgEl);
    const serializer = new XMLSerializer();

    const letters = [];
    for (const cand of candidates) {
      const markup =
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${rasterW}" height="${rasterH}">` +
        sharedDefs +
        serializer.serializeToString(cand) +
        `</svg>`;
      try {
        const crop = await rasterizeAndCrop(markup, rasterW, rasterH);
        if (crop) letters.push(crop);
      } catch (err) {
        /* skip letters that fail to rasterize */
      }
    }

    if (letters.length === 0) {
      alert("Could not extract any letters from this SVG.");
      return;
    }
    setLetters(letters);
  }

  async function importMultipleSvgs(files) {
    const letters = [];
    let xCursor = 0;
    const alignBaseline = el.ctrlAlignBaseline.checked;
    for (const file of files) {
      const text = await file.text();
      const doc = new DOMParser().parseFromString(text, "image/svg+xml");
      const svgEl = doc.documentElement;
      if (svgEl.tagName.toLowerCase() !== "svg") continue;
      const size = parseSvgSize(svgEl);
      const scale = 600 / Math.max(size.w, size.h);
      const rasterW = Math.max(2, Math.round(size.w * scale));
      const rasterH = Math.max(2, Math.round(size.h * scale));
      svgEl.setAttribute("width", rasterW);
      svgEl.setAttribute("height", rasterH);
      if (!svgEl.getAttribute("viewBox"))
        svgEl.setAttribute("viewBox", `0 0 ${size.w} ${size.h}`);
      const markup = new XMLSerializer().serializeToString(svgEl);
      try {
        const crop = await rasterizeAndCrop(markup, rasterW, rasterH);
        if (crop) {
          // Lay the individual files out side by side. When alignment is off,
          // scatter each one vertically instead of pinning it to one line.
          const y = alignBaseline ? 0 : (Math.random() - 0.5) * crop.h * 0.6;
          letters.push({
            canvas: crop.canvas,
            x: xCursor,
            y,
            w: crop.w,
            h: crop.h,
          });
          xCursor += crop.w + crop.w * 0.12;
        }
      } catch (err) {
        /* skip unreadable files */
      }
    }

    if (letters.length === 0) {
      alert("None of the selected files could be read as SVG.");
      return;
    }
    setLetters(letters);
  }

  // Normalize crops into layout-relative coordinates and hand off to the sim.
  function setLetters(crops) {
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const c of crops) {
      minX = Math.min(minX, c.x);
      minY = Math.min(minY, c.y);
      maxX = Math.max(maxX, c.x + c.w);
      maxY = Math.max(maxY, c.y + c.h);
    }
    const unionW = Math.max(1, maxX - minX);

    // All coordinates relative to the union WIDTH so multiplying by the target
    // logo width scales the layout uniformly without distortion.
    state.letters = crops.map((c) => ({
      img: c.canvas,
      relX: (c.x - minX) / unionW,
      relY: (c.y - minY) / unionW,
      relW: c.w / unionW,
      relH: c.h / unionW,
    }));

    tintCache.clear();
    el.stageFrame.classList.add("has-image");
    el.btnDrop.disabled = false;
    el.btnDropOutside.disabled = false;
    el.btnExportVideo.disabled = false;
    el.statCount.textContent = String(state.letters.length);
    spawnBodies();
  }

  // ---------- Bodies ----------

  // "Logo scale" always maps directly to pixel size — no clamping — so it's
  // never capped short of the canvas edge. Shared by the physics spawn and
  // the render loop so drawn size never drifts from body size.
  function computeLayout(dims) {
    const logoW = dims.w * state.logoScale;
    return { logoW, offsetX: (dims.w - logoW) / 2, offsetY: dims.h * 0.08 };
  }

  // Position (and rotation) for one letter, independent of whether it's
  // ending up inside the frame or getting overridden for an "outside" start.
  function computeLetterPlacement(letter, dims, layout) {
    const { logoW, offsetX, offsetY } = layout;
    const w = Math.max(6, letter.relW * logoW);
    const h = Math.max(6, letter.relH * logoW);

    let cx, cy, jitterAngle, jitterX;
    if (state.scatter) {
      // Ignore the original word layout entirely: drop each letter at a
      // random spot and a wide random angle so big letters overlap and
      // bleed past the frame instead of sitting in one aligned row.
      cx = Math.random() * dims.w;
      cy = Math.random() * dims.h;
      jitterAngle = (Math.random() - 0.5) * Math.PI * 0.6; // up to ~±54°
      jitterX = 0;
    } else {
      cx = offsetX + letter.relX * logoW + w / 2;
      cy = offsetY + letter.relY * logoW + h / 2;
      // Neighboring letters' bounding boxes often touch or overlap
      // (kerning), so spawning them at full size, perfectly level, lets the
      // collision solver lock them into a stable horizontal arch that never
      // topples. A small nudge to position/angle breaks that symmetry so
      // the row actually falls apart.
      jitterAngle = (Math.random() - 0.5) * 0.12;
      jitterX = (Math.random() - 0.5) * w * 0.1;
    }

    return { w, h, cx, cy, jitterAngle, jitterX };
  }

  // Rotated-bounding-box half-height: a wide letter spun to a steep angle is
  // effectively "taller" than its raw h, so anything sizing clearance above
  // the frame needs this instead of h/2.
  function rotatedHalfHeight(w, h, angle) {
    return (
      (w / 2) * Math.abs(Math.sin(angle)) + (h / 2) * Math.abs(Math.cos(angle))
    );
  }

  function rotatedHalfWidth(w, h, angle) {
    return (
      (w / 2) * Math.abs(Math.cos(angle)) + (h / 2) * Math.abs(Math.sin(angle))
    );
  }

  // Keep v within [lo, hi]; if the span is inverted (letter bigger than the
  // frame) fall back to the midpoint rather than returning nonsense.
  function clampRange(v, lo, hi) {
    if (lo > hi) return (lo + hi) / 2;
    return Math.min(hi, Math.max(lo, v));
  }

  function makeLetterBody(cx, cy, jitterAngle, w, h) {
    const physW = w * 0.92;
    const physH = h * 0.92;
    const body = Bodies.rectangle(cx, cy, physW, physH, {
      restitution: state.bounce,
      friction: state.friction,
      frictionAir: state.air,
      density: 0.0015,
    });
    Body.setAngle(body, jitterAngle);
    return body;
  }

  function spawnBodies({ fromOutside = false } = {}) {
    for (const b of state.bodies) Composite.remove(engine.world, b);
    state.bodies = [];

    const dims = RATIOS[state.ratio];
    const layout = computeLayout(dims);
    // Zero-G puts a lid on the frame, so letters started above it could never
    // get in — always place them inside while turbulence is running.
    if (state.turbulence) fromOutside = false;

    // When dropping from outside, letters need a start height above the
    // frame. Scatter mode gives every letter a random X, so with big scale
    // settings huge letters could otherwise land on top of each other above
    // the frame — and Matter's collision solver resolves that overlap with
    // a hard shove that can launch a letter straight into view on the very
    // first physics step. So scatter stacks letters into non-overlapping
    // vertical bands. Row layout already keeps letters horizontally
    // separate (same as a normal "Drop again"), so it doesn't need that —
    // stacking there just meant the last letter fell from much farther away
    // than the first for no reason, taking noticeably longer to arrive.
    let outsideBottom = -dims.h * 0.04;
    // However many/big the letters, never let the stack climb past this —
    // otherwise a letter falling from that far up can build enough speed to
    // tunnel through the floor in one physics step and vanish for good.
    // Past this point letters start compressing (slight overlap) instead.
    const maxOutsideReach = -dims.h * 3;

    for (const letter of state.letters) {
      const placement = computeLetterPlacement(letter, dims, layout);
      const { w, h, cx, jitterAngle, jitterX } = placement;
      let { cy } = placement;

      if (fromOutside) {
        if (state.scatter) {
          const effHalfH = rotatedHalfHeight(w, h, jitterAngle);
          const gap = dims.h * 0.015;
          cy = Math.max(outsideBottom - effHalfH, maxOutsideReach);
          outsideBottom = Math.max(
            outsideBottom - (effHalfH * 2 + gap),
            maxOutsideReach,
          );
        } else {
          cy = -dims.h * 0.06;
        }
      }

      let bodyX = cx + jitterX;
      if (state.turbulence) {
        // Zero-G seals the frame with thick walls on all four sides, so a
        // letter placed outside one (which big "Logo scale" layouts do)
        // would start embedded in it and get flung out by the solver.
        const halfW = rotatedHalfWidth(w, h, jitterAngle);
        const halfH = rotatedHalfHeight(w, h, jitterAngle);
        bodyX = clampRange(bodyX, halfW, dims.w - halfW);
        cy = clampRange(cy, halfH, dims.h - halfH);
      }

      const body = makeLetterBody(bodyX, cy, jitterAngle, w, h);
      if (state.turbulence) {
        // Nudge each one so the drift reads as already in motion rather than
        // waiting for the flow field to overcome a dead stop.
        Body.setVelocity(body, {
          x: (Math.random() - 0.5) * 4,
          y: (Math.random() - 0.5) * 4,
        });
        Body.setAngularVelocity(body, (Math.random() - 0.5) * 0.06);
      }
      state.bodies.push(body);
    }

    Composite.add(engine.world, state.bodies);
  }

  function applyMaterialToBodies() {
    for (const b of state.bodies) {
      b.restitution = state.bounce;
      b.friction = state.friction;
      b.frictionAir = state.air;
      Sleeping.set(b, false);
    }
  }

  // ---------- Zero-G turbulence ----------

  // Direction (radians) of the flow at a point, layered sines standing in for
  // curl noise: cheap, tileless, and smooth in both space and time, so
  // neighbouring letters get related — not identical — pushes and the whole
  // field keeps churning instead of settling into a steady current.
  function flowAngle(x, y, t, seed) {
    const s = 0.0022 * (1.6 - state.turbulenceScale * 1.2); // bigger scale = wider swirls
    return (
      Math.sin(x * s + t * 0.35 + seed) * 1.6 +
      Math.cos(y * s * 1.27 - t * 0.28) * 1.6 +
      Math.sin((x + y) * s * 0.63 + t * 0.19) * 1.2
    );
  }

  function applyTurbulence(timestamp) {
    const t = timestamp * 0.001;
    const dims = RATIOS[state.ratio];
    // Matter applies gravity as mass * gravity.y * 0.001, so scaling the push
    // by mass too gives every letter the same acceleration regardless of size
    // — otherwise the big ones would barely budge while small ones shot off.
    const accel = 0.001 * 0.55 * state.turbulenceStrength;

    for (let i = 0; i < state.bodies.length; i++) {
      const body = state.bodies[i];
      // Bodies that drift slowly would otherwise be put to sleep by the
      // engine and stop responding to forces entirely.
      Sleeping.set(body, false);

      const angle = flowAngle(body.position.x, body.position.y, t, i * 1.7);
      const mag = body.mass * accel;
      Body.applyForce(body, body.position, {
        x: Math.cos(angle) * mag,
        y: Math.sin(angle) * mag,
      });

      // Gentle, per-letter tumble. Scaled by inertia so big and small letters
      // spin at comparable rates.
      body.torque =
        Math.sin(t * 0.6 + i * 2.3) *
        body.inertia *
        0.000018 *
        state.turbulenceStrength;

      // Safety net: the walls should contain everything, but a letter that
      // gets past one (solver squeeze between two colliding letters, a
      // mid-flight toggle) has no gravity to bring it back, so it would
      // drift away forever. Pull grows with how far out it is and saturates,
      // and its ceiling is well above the strongest flow push so it always
      // wins the tug-of-war.
      let overX = 0;
      let overY = 0;
      if (body.position.x < 0) overX = -body.position.x;
      else if (body.position.x > dims.w) overX = dims.w - body.position.x;
      if (body.position.y < 0) overY = -body.position.y;
      else if (body.position.y > dims.h) overY = dims.h - body.position.y;

      if (overX || overY) {
        const pull = body.mass * 0.001 * 2.2;
        const sat = (over, span) =>
          Math.max(-1, Math.min(1, (over / span) * 6));
        Body.applyForce(body, body.position, {
          x: sat(overX, dims.w) * pull,
          y: sat(overY, dims.h) * pull,
        });
      }
    }
  }

  // ---------- Rendering ----------

  function letterDrawable(index) {
    const letter = state.letters[index];
    if (state.colorMode === "original") return letter.img;

    const cached = tintCache.get(index);
    if (cached && cached.color === state.letterColor) return cached.canvas;

    const tinted = document.createElement("canvas");
    tinted.width = letter.img.width;
    tinted.height = letter.img.height;
    const c = tinted.getContext("2d");
    c.drawImage(letter.img, 0, 0);
    c.globalCompositeOperation = "source-in";
    c.fillStyle = state.letterColor;
    c.fillRect(0, 0, tinted.width, tinted.height);
    tintCache.set(index, { color: state.letterColor, canvas: tinted });
    return tinted;
  }

  function backgroundFill() {
    if (state.bgMode === "white") return "#ffffff";
    if (state.bgMode === "solid") return state.bgColor;
    return "#101014";
  }

  let lastTime = null;
  function tick(timestamp) {
    if (lastTime === null) lastTime = timestamp;
    // Clamp so a backgrounded tab doesn't explode the simulation on return.
    const delta = Math.min(1000 / 30, timestamp - lastTime);
    lastTime = timestamp;

    if (state.turbulence) {
      engine.gravity.y = 0;
      applyTurbulence(timestamp);
    } else {
      engine.gravity.y = state.gravity;
    }
    Engine.update(engine, delta);

    const dims = RATIOS[state.ratio];
    ctx.fillStyle = backgroundFill();
    ctx.fillRect(0, 0, dims.w, dims.h);

    const { logoW } = computeLayout(dims);
    for (let i = 0; i < state.bodies.length; i++) {
      const body = state.bodies[i];
      const letter = state.letters[i];
      const w = Math.max(6, letter.relW * logoW);
      const h = Math.max(6, letter.relH * logoW);

      ctx.save();
      ctx.translate(body.position.x, body.position.y);
      ctx.rotate(body.angle);
      ctx.drawImage(letterDrawable(i), -w / 2, -h / 2, w, h);
      ctx.restore();
    }

    requestAnimationFrame(tick);
  }

  // ---------- Controls ----------

  el.btnImport.addEventListener("click", () => el.fileInput.click());
  el.btnImportEmpty.addEventListener("click", () => el.fileInput.click());
  el.btnImportMulti.addEventListener("click", () => el.fileInputMulti.click());

  el.fileInput.addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) await importSingleSvg(await file.text());
    el.fileInput.value = "";
  });

  el.fileInputMulti.addEventListener("change", async (e) => {
    const files = [...(e.target.files || [])];
    if (files.length) await importMultipleSvgs(files);
    el.fileInputMulti.value = "";
  });

  ["dragover", "dragenter"].forEach((evt) => {
    el.stageFrame.addEventListener(evt, (e) => {
      e.preventDefault();
      el.stageFrame.classList.add("drag-over");
    });
  });
  ["dragleave", "dragend"].forEach((evt) => {
    el.stageFrame.addEventListener(evt, () =>
      el.stageFrame.classList.remove("drag-over"),
    );
  });
  el.stageFrame.addEventListener("drop", async (e) => {
    e.preventDefault();
    el.stageFrame.classList.remove("drag-over");
    const files = [...(e.dataTransfer.files || [])].filter(
      (f) => f.type === "image/svg+xml" || /\.svg$/i.test(f.name),
    );
    if (files.length === 1) await importSingleSvg(await files[0].text());
    else if (files.length > 1) await importMultipleSvgs(files);
  });

  el.ratioSelect.addEventListener("click", (e) => {
    const btn = e.target.closest(".ratio-btn");
    if (!btn) return;
    state.ratio = btn.dataset.ratio;
    [...el.ratioSelect.children].forEach((b) =>
      b.classList.toggle("active", b === btn),
    );
    fitFrame();
    rebuildWalls();
    rebuildMouse();
    if (state.letters.length) spawnBodies();
  });

  el.btnDrop.addEventListener("click", () => spawnBodies());
  el.btnDropOutside.addEventListener("click", () => spawnBodies({ fromOutside: true }));

  // ---------- Video export ----------

  const VIDEO_DURATION_MS = 10000;

  function exportButtonLabel() {
    return `Export 10s video (${state.videoFps}fps)`;
  }

  function pickVideoMimeType() {
    const candidates = [
      "video/mp4;codecs=avc1",
      "video/mp4",
      "video/webm;codecs=vp9",
      "video/webm;codecs=vp8",
      "video/webm",
    ];
    for (const type of candidates) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported(type))
        return type;
    }
    return "";
  }

  function exportVideo() {
    if (!state.letters.length || el.btnExportVideo.disabled) return;

    const mimeType = pickVideoMimeType();
    if (!mimeType || !el.canvas.captureStream) {
      alert(
        "This browser can't record video from the canvas. Try a recent Chrome or Edge.",
      );
      return;
    }

    const stream = el.canvas.captureStream(state.videoFps);
    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 12_000_000,
    });
    const chunks = [];
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size) chunks.push(e.data);
    };

    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunks, { type: mimeType });
      const isMp4 = mimeType.startsWith("video/mp4");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `letters.${isMp4 ? "mp4" : "webm"}`;
      a.click();
      URL.revokeObjectURL(url);

      el.btnExportVideo.disabled = false;
      el.btnExportVideo.textContent = exportButtonLabel();
      el.exportStatus.textContent = isMp4
        ? ""
        : "Saved as .webm — this browser can't record MP4 directly.";
    };

    // Re-drop so the recording captures the full entrance from outside the frame.
    spawnBodies();

    el.btnExportVideo.disabled = true;
    el.exportStatus.textContent = "";
    const startedAt = performance.now();
    const tickStatus = () => {
      if (recorder.state !== "recording") return;
      const remaining = Math.max(
        0,
        VIDEO_DURATION_MS - (performance.now() - startedAt),
      );
      el.btnExportVideo.textContent = `Recording… ${Math.ceil(remaining / 1000)}s`;
      if (remaining > 0) requestAnimationFrame(tickStatus);
    };
    requestAnimationFrame(tickStatus);

    recorder.start();
    setTimeout(() => recorder.stop(), VIDEO_DURATION_MS);
  }

  el.btnExportVideo.addEventListener("click", exportVideo);

  el.fpsModeGroup.addEventListener("click", (e) => {
    const btn = e.target.closest(".segmented-btn");
    if (!btn) return;
    state.videoFps = parseInt(btn.dataset.fps, 10);
    [...el.fpsModeGroup.children].forEach((b) =>
      b.classList.toggle("active", b === btn),
    );
    el.btnExportVideo.textContent = exportButtonLabel();
  });

  el.ctrlGravity.addEventListener("input", () => {
    state.gravity = parseFloat(el.ctrlGravity.value);
    el.valGravity.textContent = state.gravity.toFixed(2);
    for (const b of state.bodies) Sleeping.set(b, false);
  });

  el.ctrlBounce.addEventListener("input", () => {
    state.bounce = parseInt(el.ctrlBounce.value, 10) / 100;
    el.valBounce.textContent = `${el.ctrlBounce.value}%`;
    applyMaterialToBodies();
  });

  el.ctrlFriction.addEventListener("input", () => {
    state.friction = parseInt(el.ctrlFriction.value, 10) / 100;
    el.valFriction.textContent = `${el.ctrlFriction.value}%`;
    applyMaterialToBodies();
  });

  el.ctrlAir.addEventListener("input", () => {
    state.air = parseFloat(el.ctrlAir.value) / 100;
    el.valAir.textContent = `${parseFloat(el.ctrlAir.value).toFixed(1)}%`;
    applyMaterialToBodies();
  });

  el.ctrlLogoScale.addEventListener("input", () => {
    state.logoScale = parseInt(el.ctrlLogoScale.value, 10) / 100;
    el.valLogoScale.textContent = `${el.ctrlLogoScale.value}%`;
    if (state.letters.length) spawnBodies();
  });

  el.ctrlMouse.addEventListener("change", () => {
    state.mouseEnabled = el.ctrlMouse.checked;
    rebuildMouse();
  });

  el.ctrlScatter.addEventListener("change", () => {
    state.scatter = el.ctrlScatter.checked;
    if (state.letters.length) spawnBodies();
  });

  el.ctrlTurbulence.addEventListener("change", () => {
    state.turbulence = el.ctrlTurbulence.checked;
    el.turbulenceField.hidden = !state.turbulence;
    el.turbulenceScaleField.hidden = !state.turbulence;
    // The ceiling only exists in zero-G, and letters left mid-air from a
    // previous drop need re-placing inside the now-closed box.
    rebuildWalls();
    if (state.letters.length) spawnBodies();
  });

  el.ctrlTurbulenceStrength.addEventListener("input", () => {
    state.turbulenceStrength =
      parseInt(el.ctrlTurbulenceStrength.value, 10) / 100;
    el.valTurbulence.textContent = `${el.ctrlTurbulenceStrength.value}%`;
  });

  el.ctrlTurbulenceScale.addEventListener("input", () => {
    state.turbulenceScale = parseInt(el.ctrlTurbulenceScale.value, 10) / 100;
    el.valTurbulenceScale.textContent = `${el.ctrlTurbulenceScale.value}%`;
  });

  el.letterColorModeGroup.addEventListener("click", (e) => {
    const btn = e.target.closest(".segmented-btn");
    if (!btn) return;
    state.colorMode = btn.dataset.mode;
    [...el.letterColorModeGroup.children].forEach((b) =>
      b.classList.toggle("active", b === btn),
    );
    el.letterColorField.hidden = state.colorMode !== "solid";
  });

  el.ctrlLetterColor.addEventListener("input", () => {
    state.letterColor = el.ctrlLetterColor.value;
  });

  el.bgModeGroup.addEventListener("click", (e) => {
    const btn = e.target.closest(".segmented-btn");
    if (!btn) return;
    state.bgMode = btn.dataset.mode;
    [...el.bgModeGroup.children].forEach((b) =>
      b.classList.toggle("active", b === btn),
    );
    el.bgColorField.hidden = state.bgMode !== "solid";
  });

  el.ctrlBgColor.addEventListener("input", () => {
    state.bgColor = el.ctrlBgColor.value;
  });

  // ---------- Init ----------

  fitFrame();
  rebuildWalls();
  rebuildMouse();
  requestAnimationFrame(tick);
})();
