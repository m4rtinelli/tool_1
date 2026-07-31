(() => {
  "use strict";

  const RATIOS = {
    "1:1": { w: 1200, h: 1200 },
    "16:9": { w: 1200, h: 675 },
    "9:16": { w: 675, h: 1200 },
  };

  const state = {
    ratio: "1:1",
    shape: "balls", // 'balls' | 'lines'
    scale: 1,
    density: 48,
    threshold: 0.04,
    lineScale: 1,
    lineThickness: 0.12,
    lineAngle: 45,
    lineAngleJitter: 0,
    linePositionJitter: 0,
    colorMode: "sample", // 'sample' | 'solid'
    solidColor: "#3d5afe",
    bgMode: "transparent", // 'transparent' | 'white' | 'solid'
    bgColor: "#0e0e12",
    hasImage: false,
    imageData: null, // cached ImageData of the work canvas
    workW: 0,
    workH: 0,
    lineNodes: [], // {el, cx, cy, angleRad, cellSize, rnd} — rebuilt every render() when shape === 'lines'
    motionEnabled: false,
    motionShape: "circular", // 'circular' | 'square' | 'triangular' | 'star'
    motionPosX: 0.5, // fraction of canvas width/height, 0-1
    motionPosY: 0.5,
    motionSpeed: 1,
    motionWaveCount: 3, // how many concentric ripples span the canvas at once
    motionAmplitude: 0.6,
    motionRandomness: false,
    motionRandomnessAmount: 0.4,
    ballNodes: [], // {el, cx, cy, cellSize, rnd} — rebuilt every render() when shape === 'balls'
  };

  // Elements
  const el = {
    fileInput: document.getElementById("file-input"),
    btnImport: document.getElementById("btn-import"),
    btnImportEmpty: document.getElementById("btn-import-empty"),
    btnExportSvg: document.getElementById("btn-export-svg"),
    btnExportPng: document.getElementById("btn-export-png"),
    ratioSelect: document.getElementById("ratio-select"),
    stageFrame: document.getElementById("stage-frame"),
    stage: document.querySelector(".stage"),
    svg: document.getElementById("output-svg"),
    emptyState: document.getElementById("empty-state"),
    shapeModeGroup: document.getElementById("shape-mode"),
    ballSettings: document.getElementById("ball-settings"),
    lineSettings: document.getElementById("line-settings"),
    labelDensity: document.getElementById("label-density"),
    labelStatCount: document.getElementById("label-stat-count"),
    ctrlScale: document.getElementById("ctrl-scale"),
    valScale: document.getElementById("val-scale"),
    ctrlMotionEnabled: document.getElementById("ctrl-motion-enabled"),
    motionControls: document.getElementById("motion-controls"),
    motionHint: document.getElementById("motion-hint"),
    labelMotionRandomness: document.getElementById("label-motion-randomness"),
    motionShapeGroup: document.getElementById("motion-shape"),
    motionPosPad: document.getElementById("motion-pos-pad"),
    motionPosDot: document.getElementById("motion-pos-dot"),
    valMotionPosition: document.getElementById("val-motion-position"),
    ctrlMotionSpeed: document.getElementById("ctrl-motion-speed"),
    valMotionSpeed: document.getElementById("val-motion-speed"),
    ctrlMotionWaves: document.getElementById("ctrl-motion-waves"),
    valMotionWaves: document.getElementById("val-motion-waves"),
    ctrlMotionAmplitude: document.getElementById("ctrl-motion-amplitude"),
    valMotionAmplitude: document.getElementById("val-motion-amplitude"),
    ctrlMotionRandomness: document.getElementById("ctrl-motion-randomness"),
    motionRandomnessAmountField: document.getElementById("motion-randomness-amount-field"),
    ctrlMotionRandomnessAmount: document.getElementById("ctrl-motion-randomness-amount"),
    valMotionRandomnessAmount: document.getElementById("val-motion-randomness-amount"),
    ctrlDensity: document.getElementById("ctrl-density"),
    valDensity: document.getElementById("val-density"),
    ctrlThreshold: document.getElementById("ctrl-threshold"),
    valThreshold: document.getElementById("val-threshold"),
    ctrlLineScale: document.getElementById("ctrl-line-scale"),
    valLineScale: document.getElementById("val-line-scale"),
    ctrlLineThickness: document.getElementById("ctrl-line-thickness"),
    valLineThickness: document.getElementById("val-line-thickness"),
    ctrlLineAngle: document.getElementById("ctrl-line-angle"),
    valLineAngle: document.getElementById("val-line-angle"),
    ctrlLineAngleJitter: document.getElementById("ctrl-line-angle-jitter"),
    valLineAngleJitter: document.getElementById("val-line-angle-jitter"),
    ctrlLinePositionJitter: document.getElementById("ctrl-line-position-jitter"),
    valLinePositionJitter: document.getElementById("val-line-position-jitter"),
    colorModeGroup: document.getElementById("color-mode"),
    solidColorField: document.getElementById("solid-color-field"),
    ctrlColor: document.getElementById("ctrl-color"),
    bgModeGroup: document.getElementById("bg-mode"),
    bgColorField: document.getElementById("bg-color-field"),
    ctrlBgColor: document.getElementById("ctrl-bg-color"),
    statCount: document.getElementById("stat-count"),
  };

  const workCanvas = document.createElement("canvas");
  const workCtx = workCanvas.getContext("2d", { willReadFrequently: true });

  // ---------- Layout ----------

  function fitFrame() {
    const dims = RATIOS[state.ratio];
    const padding = 64; // .stage has 32px padding on each side
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
    el.svg.setAttribute("viewBox", `0 0 ${dims.w} ${dims.h}`);
  }

  window.addEventListener("resize", () => {
    requestAnimationFrame(fitFrame);
  });

  // ---------- File import ----------

  function isSvgFile(file) {
    return file.type === "image/svg+xml" || /\.svg$/i.test(file.name);
  }

  function parseSvgIntrinsicSize(svgText) {
    try {
      const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
      const svgEl = doc.documentElement;
      const wAttr = parseFloat(svgEl.getAttribute("width"));
      const hAttr = parseFloat(svgEl.getAttribute("height"));
      if (wAttr > 0 && hAttr > 0) return { w: wAttr, h: hAttr };

      const viewBox = svgEl.getAttribute("viewBox");
      if (viewBox) {
        const parts = viewBox.trim().split(/[\s,]+/).map(Number);
        if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
          return { w: parts[2], h: parts[3] };
        }
      }
    } catch (e) {
      /* fall through to default */
    }
    return { w: 512, h: 512 };
  }

  function loadFile(file) {
    if (!file) return;

    if (isSvgFile(file)) {
      const reader = new FileReader();
      reader.onload = () => {
        const svgText = reader.result;
        const intrinsic = parseSvgIntrinsicSize(svgText);
        const blob = new Blob([svgText], { type: "image/svg+xml" });
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
          const w = img.naturalWidth || intrinsic.w;
          const h = img.naturalHeight || intrinsic.h;
          onImageReady(img, w, h);
          URL.revokeObjectURL(url);
        };
        img.onerror = () => {
          alert("Could not load this SVG file.");
          URL.revokeObjectURL(url);
        };
        img.src = url;
      };
      reader.readAsText(file);
    } else {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        onImageReady(img, img.naturalWidth, img.naturalHeight);
        URL.revokeObjectURL(url);
      };
      img.onerror = () => {
        alert("Could not load this image file.");
        URL.revokeObjectURL(url);
      };
      img.src = url;
    }
  }

  function onImageReady(img, naturalW, naturalH) {
    state.hasImage = true;
    el.stageFrame.classList.add("has-image");
    el.btnExportSvg.disabled = false;
    el.btnExportPng.disabled = false;
    drawToWorkCanvas(img, naturalW, naturalH);
    render();
    startMotionLoop();
  }

  function drawToWorkCanvas(img, naturalW, naturalH) {
    const dims = RATIOS[state.ratio];
    workCanvas.width = dims.w;
    workCanvas.height = dims.h;
    state.workW = dims.w;
    state.workH = dims.h;

    workCtx.clearRect(0, 0, dims.w, dims.h);

    const scale = Math.min(dims.w / naturalW, dims.h / naturalH);
    const drawW = naturalW * scale;
    const drawH = naturalH * scale;
    const dx = (dims.w - drawW) / 2;
    const dy = (dims.h - drawH) / 2;

    workCtx.drawImage(img, dx, dy, drawW, drawH);
    state.imageData = workCtx.getImageData(0, 0, dims.w, dims.h);
    state.lastImg = img;
    state.lastNaturalW = naturalW;
    state.lastNaturalH = naturalH;
  }

  // ---------- Shape rendering ----------

  // Deterministic per-cell pseudo-random in [0, 1), stable across re-renders
  // unless the grid itself (row/col count) changes.
  function cellRandom(row, col, salt) {
    let h = (row * 92821 + col * 51749 + salt * 12841) | 0;
    h = (h ^ (h >>> 15)) * 2246822519;
    h = (h ^ (h >>> 13)) * 3266489917;
    h = h ^ (h >>> 16);
    return (h >>> 0) / 4294967295;
  }

  // Relative radius (vs. a circle) of a regular polygon's boundary at angle theta.
  // Level sets of actualDistance / regularPolygonRadius(...) trace scaled copies
  // of the polygon, which is what turns a circular wavefront into a polygonal one.
  function regularPolygonRadius(theta, sides, rotation) {
    const a = (2 * Math.PI) / sides;
    const angle = theta - rotation;
    const segment = Math.round(angle / a);
    const phi = angle - segment * a;
    return Math.cos(a / 2) / Math.cos(phi);
  }

  function motionShapeFactor(theta, shape) {
    switch (shape) {
      case "square":
        return regularPolygonRadius(theta, 4, 0);
      case "triangular":
        return regularPolygonRadius(theta, 3, -Math.PI / 2);
      case "star":
        return 1 + 0.35 * Math.cos(5 * theta);
      case "circular":
      default:
        return 1;
    }
  }

  function sampleCell(x0, y0, x1, y1) {
    const { data, width } = state.imageData;
    const sub = 3; // subsample grid per cell for average color/alpha
    let rSum = 0, gSum = 0, bSum = 0, aSum = 0, n = 0;

    for (let sy = 0; sy < sub; sy++) {
      const py = Math.min(state.workH - 1, Math.floor(y0 + ((sy + 0.5) / sub) * (y1 - y0)));
      for (let sx = 0; sx < sub; sx++) {
        const px = Math.min(state.workW - 1, Math.floor(x0 + ((sx + 0.5) / sub) * (x1 - x0)));
        const idx = (py * width + px) * 4;
        const a = data[idx + 3] / 255;
        rSum += data[idx] * a;
        gSum += data[idx + 1] * a;
        bSum += data[idx + 2] * a;
        aSum += a;
        n++;
      }
    }

    if (aSum <= 0) return { r: 0, g: 0, b: 0, a: 0 };
    return {
      r: Math.round(rSum / aSum),
      g: Math.round(gSum / aSum),
      b: Math.round(bSum / aSum),
      a: aSum / n,
    };
  }

  function render() {
    while (el.svg.firstChild) el.svg.removeChild(el.svg.firstChild);

    if (!state.hasImage) {
      el.statCount.textContent = "0";
      return;
    }

    const dims = RATIOS[state.ratio];

    if (state.bgMode !== "transparent") {
      const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      rect.setAttribute("x", "0");
      rect.setAttribute("y", "0");
      rect.setAttribute("width", String(dims.w));
      rect.setAttribute("height", String(dims.h));
      rect.setAttribute("fill", state.bgMode === "white" ? "#ffffff" : state.bgColor);
      el.svg.appendChild(rect);
    }

    const cols = state.density;
    const cellSize = dims.w / cols;
    const rows = Math.max(1, Math.round(dims.h / cellSize));

    const fragment = document.createDocumentFragment();
    let count = 0;
    state.ballNodes = [];
    state.lineNodes = [];

    for (let row = 0; row < rows; row++) {
      const y0 = row * cellSize;
      const y1 = y0 + cellSize;
      for (let col = 0; col < cols; col++) {
        const x0 = col * cellSize;
        const x1 = x0 + cellSize;
        const sample = sampleCell(x0, y0, x1, y1);
        if (sample.a < state.threshold) continue;

        const color =
          state.colorMode === "sample"
            ? `rgb(${sample.r},${sample.g},${sample.b})`
            : state.solidColor;

        const shape =
          state.shape === "lines"
            ? makeLine(row, col, x0, y0, cellSize, sample, color)
            : makeBall(row, col, x0, y0, cellSize, sample, color);

        if (!shape) continue;
        fragment.appendChild(shape);
        count++;
      }
    }

    el.svg.appendChild(fragment);
    el.statCount.textContent = count.toLocaleString();
  }

  function makeBall(row, col, x0, y0, cellSize, sample, color) {
    const radius = (cellSize / 2) * state.scale;
    if (radius <= 0) return null;

    const cx = x0 + cellSize / 2;
    const cy = y0 + cellSize / 2;

    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", cx.toFixed(2));
    circle.setAttribute("cy", cy.toFixed(2));
    circle.setAttribute("r", radius.toFixed(2));
    circle.setAttribute("fill", color);
    circle.setAttribute("fill-opacity", sample.a.toFixed(2));

    state.ballNodes.push({
      el: circle,
      cx,
      cy,
      cellSize,
      rnd: cellRandom(row, col, 7),
    });

    return circle;
  }

  function makeLine(row, col, x0, y0, cellSize, sample, color) {
    const length = cellSize * state.lineScale;
    const thickness = cellSize * state.lineThickness;
    if (length <= 0 || thickness <= 0) return null;

    const posJitterAmount = (state.linePositionJitter / 100) * (cellSize / 2);
    const jx = (cellRandom(row, col, 1) * 2 - 1) * posJitterAmount;
    const jy = (cellRandom(row, col, 2) * 2 - 1) * posJitterAmount;
    const cx = x0 + cellSize / 2 + jx;
    const cy = y0 + cellSize / 2 + jy;

    const angleJitter = (cellRandom(row, col, 3) * 2 - 1) * state.lineAngleJitter;
    const angleRad = ((state.lineAngle + angleJitter) * Math.PI) / 180;
    const dx = (Math.cos(angleRad) * length) / 2;
    const dy = (Math.sin(angleRad) * length) / 2;

    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", (cx - dx).toFixed(2));
    line.setAttribute("y1", (cy - dy).toFixed(2));
    line.setAttribute("x2", (cx + dx).toFixed(2));
    line.setAttribute("y2", (cy + dy).toFixed(2));
    line.setAttribute("stroke", color);
    line.setAttribute("stroke-width", thickness.toFixed(2));
    line.setAttribute("stroke-opacity", sample.a.toFixed(2));
    line.setAttribute("stroke-linecap", "round");

    state.lineNodes.push({
      el: line,
      cx,
      cy,
      angleRad,
      cellSize,
      rnd: cellRandom(row, col, 7),
    });

    return line;
  }

  // ---------- Motion ----------

  let motionRafId = null;
  let motionStartTime = null;
  const MOTION_PERIOD = 4; // seconds for a ripple to travel one full wavelength at speed = 1

  // Farthest a point at (cx, cy) can be from any corner of a w x h rect —
  // used so the wave still reaches every edge even when the emission point is off-center.
  function maxCornerDistance(cx, cy, w, h) {
    let max = 0;
    for (const [x, y] of [[0, 0], [w, 0], [0, h], [w, h]]) {
      const d = Math.hypot(x - cx, y - cy);
      if (d > max) max = d;
    }
    return max;
  }

  function motionApplicable() {
    return (
      state.motionEnabled &&
      state.hasImage &&
      (state.shape === "balls" || state.shape === "lines")
    );
  }

  function pulseAt(cx, cy, centerX, centerY, k, offsetDist) {
    const dx = cx - centerX;
    const dy = cy - centerY;
    const theta = Math.atan2(dy, dx);
    const actualDist = Math.sqrt(dx * dx + dy * dy);
    const effDist = actualDist / motionShapeFactor(theta, state.motionShape);
    // Continuous outward-traveling sine wave: every shape is always oscillating,
    // with `motionWaveCount` ripples visible across the canvas at any moment.
    return (Math.cos(k * (effDist - offsetDist)) + 1) / 2;
  }

  function motionTick(timestamp) {
    if (!motionApplicable()) {
      motionRafId = null;
      return;
    }
    if (motionStartTime === null) motionStartTime = timestamp;

    const dims = RATIOS[state.ratio];
    const centerX = dims.w * state.motionPosX;
    const centerY = dims.h * state.motionPosY;
    // Generous buffer over the corner distance so polygonal/star wavefronts
    // (which can reach beyond a circle in some directions) still fully clear the canvas.
    const maxDist = maxCornerDistance(centerX, centerY, dims.w, dims.h) * 1.5;
    const wavelength = maxDist / state.motionWaveCount;

    const elapsed = (timestamp - motionStartTime) / 1000;
    const offsetDist = (elapsed * state.motionSpeed * wavelength) / MOTION_PERIOD;
    const k = (2 * Math.PI) / wavelength;

    if (state.shape === "balls") {
      for (const b of state.ballNodes) {
        const pulse = pulseAt(b.cx, b.cy, centerX, centerY, k, offsetDist);
        let amp = state.motionAmplitude * pulse;
        if (state.motionRandomness) {
          amp *= 1 + (b.rnd * 2 - 1) * state.motionRandomnessAmount;
        }
        const finalScale = state.scale * (1 + amp);
        const radius = Math.max(0, (b.cellSize / 2) * finalScale);
        b.el.setAttribute("r", radius.toFixed(2));
      }
    } else {
      for (const l of state.lineNodes) {
        const pulse = pulseAt(l.cx, l.cy, centerX, centerY, k, offsetDist);
        let amp = state.motionAmplitude * pulse;
        if (state.motionRandomness) {
          amp *= 1 + (l.rnd * 2 - 1) * state.motionRandomnessAmount;
        }
        const length = Math.max(0, l.cellSize * state.lineScale * (1 + amp));
        const thickness = Math.max(0, l.cellSize * state.lineThickness * (1 + amp));
        const half = length / 2;
        const dx = Math.cos(l.angleRad) * half;
        const dy = Math.sin(l.angleRad) * half;
        l.el.setAttribute("x1", (l.cx - dx).toFixed(2));
        l.el.setAttribute("y1", (l.cy - dy).toFixed(2));
        l.el.setAttribute("x2", (l.cx + dx).toFixed(2));
        l.el.setAttribute("y2", (l.cy + dy).toFixed(2));
        l.el.setAttribute("stroke-width", thickness.toFixed(2));
      }
    }

    motionRafId = requestAnimationFrame(motionTick);
  }

  function startMotionLoop() {
    if (motionRafId !== null) return;
    if (!motionApplicable()) return;
    motionStartTime = null;
    motionRafId = requestAnimationFrame(motionTick);
  }

  function stopMotionLoop() {
    if (motionRafId !== null) {
      cancelAnimationFrame(motionRafId);
      motionRafId = null;
    }
  }

  // ---------- Controls wiring ----------

  el.btnImport.addEventListener("click", () => el.fileInput.click());
  el.btnImportEmpty.addEventListener("click", () => el.fileInput.click());
  el.fileInput.addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    loadFile(file);
    el.fileInput.value = "";
  });

  ["dragover", "dragenter"].forEach((evt) => {
    el.stageFrame.addEventListener(evt, (e) => {
      e.preventDefault();
      el.stageFrame.classList.add("drag-over");
    });
  });
  ["dragleave", "dragend"].forEach((evt) => {
    el.stageFrame.addEventListener(evt, () => {
      el.stageFrame.classList.remove("drag-over");
    });
  });
  el.stageFrame.addEventListener("drop", (e) => {
    e.preventDefault();
    el.stageFrame.classList.remove("drag-over");
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    loadFile(file);
  });

  el.ratioSelect.addEventListener("click", (e) => {
    const btn = e.target.closest(".ratio-btn");
    if (!btn) return;
    state.ratio = btn.dataset.ratio;
    [...el.ratioSelect.children].forEach((b) => b.classList.toggle("active", b === btn));
    fitFrame();
    if (state.hasImage) {
      drawToWorkCanvas(state.lastImg, state.lastNaturalW, state.lastNaturalH);
    }
    render();
  });

  el.shapeModeGroup.addEventListener("click", (e) => {
    const btn = e.target.closest(".segmented-btn");
    if (!btn) return;
    state.shape = btn.dataset.mode;
    [...el.shapeModeGroup.children].forEach((b) => b.classList.toggle("active", b === btn));

    const isLines = state.shape === "lines";
    el.ballSettings.hidden = isLines;
    el.lineSettings.hidden = !isLines;
    el.labelDensity.textContent = isLines ? "Line density" : "Ball density";
    el.labelStatCount.textContent = isLines ? "Lines rendered" : "Balls rendered";
    el.motionHint.textContent = isLines
      ? "Waves change the line width and thickness as the effector passes through them."
      : "Waves scale the balls as the effector passes through them.";
    el.labelMotionRandomness.textContent = isLines ? "Randomize line scale" : "Randomize ball scale";
    render();
    startMotionLoop();
  });

  el.ctrlScale.addEventListener("input", () => {
    state.scale = parseFloat(el.ctrlScale.value);
    el.valScale.textContent = state.scale.toFixed(2);
    render();
  });

  el.ctrlMotionEnabled.addEventListener("change", () => {
    state.motionEnabled = el.ctrlMotionEnabled.checked;
    el.motionControls.hidden = !state.motionEnabled;
    if (state.motionEnabled) {
      startMotionLoop();
    } else {
      stopMotionLoop();
      render(); // restore static scale/thickness immediately
    }
  });

  el.motionShapeGroup.addEventListener("click", (e) => {
    const btn = e.target.closest(".segmented-btn");
    if (!btn) return;
    state.motionShape = btn.dataset.shape;
    [...el.motionShapeGroup.children].forEach((b) => b.classList.toggle("active", b === btn));
  });

  function updateMotionPosUI() {
    el.motionPosDot.style.left = `${(state.motionPosX * 100).toFixed(1)}%`;
    el.motionPosDot.style.top = `${(state.motionPosY * 100).toFixed(1)}%`;
    el.valMotionPosition.textContent = `${Math.round(state.motionPosX * 100)}%, ${Math.round(
      state.motionPosY * 100
    )}%`;
  }

  function setMotionPosFromPointer(e) {
    const rect = el.motionPosPad.getBoundingClientRect();
    state.motionPosX = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    state.motionPosY = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    updateMotionPosUI();
  }

  let draggingMotionPos = false;
  el.motionPosPad.addEventListener("pointerdown", (e) => {
    draggingMotionPos = true;
    el.motionPosPad.setPointerCapture(e.pointerId);
    setMotionPosFromPointer(e);
  });
  el.motionPosPad.addEventListener("pointermove", (e) => {
    if (!draggingMotionPos) return;
    setMotionPosFromPointer(e);
  });
  el.motionPosPad.addEventListener("pointerup", () => {
    draggingMotionPos = false;
  });
  el.motionPosPad.addEventListener("pointercancel", () => {
    draggingMotionPos = false;
  });
  el.motionPosPad.addEventListener("dblclick", () => {
    state.motionPosX = 0.5;
    state.motionPosY = 0.5;
    updateMotionPosUI();
  });

  el.ctrlMotionSpeed.addEventListener("input", () => {
    state.motionSpeed = parseFloat(el.ctrlMotionSpeed.value);
    el.valMotionSpeed.textContent = state.motionSpeed.toFixed(2);
  });

  el.ctrlMotionWaves.addEventListener("input", () => {
    state.motionWaveCount = parseInt(el.ctrlMotionWaves.value, 10);
    el.valMotionWaves.textContent = String(state.motionWaveCount);
  });

  el.ctrlMotionAmplitude.addEventListener("input", () => {
    const pct = parseInt(el.ctrlMotionAmplitude.value, 10);
    state.motionAmplitude = pct / 100;
    el.valMotionAmplitude.textContent = `${pct}%`;
  });

  el.ctrlMotionRandomness.addEventListener("change", () => {
    state.motionRandomness = el.ctrlMotionRandomness.checked;
    el.motionRandomnessAmountField.hidden = !state.motionRandomness;
  });

  el.ctrlMotionRandomnessAmount.addEventListener("input", () => {
    const pct = parseInt(el.ctrlMotionRandomnessAmount.value, 10);
    state.motionRandomnessAmount = pct / 100;
    el.valMotionRandomnessAmount.textContent = `${pct}%`;
  });

  el.ctrlDensity.addEventListener("input", () => {
    state.density = parseInt(el.ctrlDensity.value, 10);
    el.valDensity.textContent = String(state.density);
    render();
  });

  el.ctrlThreshold.addEventListener("input", () => {
    const pct = parseInt(el.ctrlThreshold.value, 10);
    state.threshold = pct / 100;
    el.valThreshold.textContent = `${pct}%`;
    render();
  });

  el.ctrlLineScale.addEventListener("input", () => {
    state.lineScale = parseFloat(el.ctrlLineScale.value);
    el.valLineScale.textContent = state.lineScale.toFixed(2);
    render();
  });

  el.ctrlLineThickness.addEventListener("input", () => {
    state.lineThickness = parseFloat(el.ctrlLineThickness.value);
    el.valLineThickness.textContent = state.lineThickness.toFixed(2);
    render();
  });

  el.ctrlLineAngle.addEventListener("input", () => {
    state.lineAngle = parseFloat(el.ctrlLineAngle.value);
    el.valLineAngle.textContent = `${state.lineAngle}°`;
    render();
  });

  el.ctrlLineAngleJitter.addEventListener("input", () => {
    state.lineAngleJitter = parseFloat(el.ctrlLineAngleJitter.value);
    el.valLineAngleJitter.textContent = `${state.lineAngleJitter}°`;
    render();
  });

  el.ctrlLinePositionJitter.addEventListener("input", () => {
    state.linePositionJitter = parseFloat(el.ctrlLinePositionJitter.value);
    el.valLinePositionJitter.textContent = `${state.linePositionJitter}%`;
    render();
  });

  el.colorModeGroup.addEventListener("click", (e) => {
    const btn = e.target.closest(".segmented-btn");
    if (!btn) return;
    state.colorMode = btn.dataset.mode;
    [...el.colorModeGroup.children].forEach((b) => b.classList.toggle("active", b === btn));
    el.solidColorField.hidden = state.colorMode !== "solid";
    render();
  });

  el.ctrlColor.addEventListener("input", () => {
    state.solidColor = el.ctrlColor.value;
    render();
  });

  el.bgModeGroup.addEventListener("click", (e) => {
    const btn = e.target.closest(".segmented-btn");
    if (!btn) return;
    state.bgMode = btn.dataset.mode;
    [...el.bgModeGroup.children].forEach((b) => b.classList.toggle("active", b === btn));
    el.bgColorField.hidden = state.bgMode !== "solid";
    render();
  });

  el.ctrlBgColor.addEventListener("input", () => {
    state.bgColor = el.ctrlBgColor.value;
    render();
  });

  // ---------- Export ----------

  function serializeSvg() {
    const dims = RATIOS[state.ratio];
    const clone = el.svg.cloneNode(true);
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", dims.w);
    clone.setAttribute("height", dims.h);
    clone.setAttribute("viewBox", `0 0 ${dims.w} ${dims.h}`);
    return new XMLSerializer().serializeToString(clone);
  }

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  el.btnExportSvg.addEventListener("click", () => {
    if (!state.hasImage) return;
    const svgString = serializeSvg();
    download(new Blob([svgString], { type: "image/svg+xml" }), `${state.shape}-svg.svg`);
  });

  el.btnExportPng.addEventListener("click", () => {
    if (!state.hasImage) return;
    const dims = RATIOS[state.ratio];
    const exportScale = 2;
    const svgString = serializeSvg();
    const svgBlob = new Blob([svgString], { type: "image/svg+xml" });
    const url = URL.createObjectURL(svgBlob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = dims.w * exportScale;
      canvas.height = dims.h * exportScale;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        download(blob, `${state.shape}-svg.png`);
        URL.revokeObjectURL(url);
      }, "image/png");
    };
    img.onerror = () => {
      alert("Could not export PNG.");
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });

  // ---------- Init ----------

  fitFrame();
  updateMotionPosUI();
  render();
})();
