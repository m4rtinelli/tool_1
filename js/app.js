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
            : makeBall(x0, y0, cellSize, sample, color);

        if (!shape) continue;
        fragment.appendChild(shape);
        count++;
      }
    }

    el.svg.appendChild(fragment);
    el.statCount.textContent = count.toLocaleString();
  }

  function makeBall(x0, y0, cellSize, sample, color) {
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
    return line;
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
    render();
  });

  el.ctrlScale.addEventListener("input", () => {
    state.scale = parseFloat(el.ctrlScale.value);
    el.valScale.textContent = state.scale.toFixed(2);
    render();
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
  render();
})();
