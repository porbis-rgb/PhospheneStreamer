(function () {
  const canvas = document.getElementById("display");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const overlay = document.getElementById("overlay");
  const statusText = document.getElementById("status-text");
  const fpsEl = document.getElementById("fps-counter");
  const framesEl = document.getElementById("frame-counter");
  const modeLabelEl = document.getElementById("mode-label");
  const modeDescEl = document.getElementById("mode-desc");
  const toggleBtn = document.getElementById("toggle-btn");
  const modeRawBtn = document.getElementById("mode-raw");
  const modeEdgeBtn = document.getElementById("mode-edge");
  const srcServerBtn = document.getElementById("src-server");
  const srcCameraBtn = document.getElementById("src-camera");
  const cameraSelectorWrap = document.getElementById("camera-selector-wrap");
  const deviceSelect = document.getElementById("device-select");
  const cameraStatusEl = document.getElementById("camera-status");

  const W = 128, H = 128;
  const CW = canvas.width, CH = canvas.height;
  const CELL = CW / W;

  let paused = false;
  let ws = null;
  let currentMode = "raw";
  let currentSource = "server"; // "server" | "camera"
  let cameraStream = null;
  let cameraLoopId = null;
  let totalFrames = 0;
  let fpsCount = 0;
  let lastFpsTime = performance.now();

  const videoEl = document.createElement("video");
  videoEl.setAttribute("playsinline", "");
  videoEl.muted = true;

  const params = {
    sizeMultiplier: 1.0,
    dropout: 0.10,
    jitter: 2,
    decay: 0.85,
    color: "cyan",
  };

  const COLORS = {
    cyan:    (a) => `rgba(0,212,255,${a})`,
    amber:   (a) => `rgba(255,176,0,${a})`,
    white:   (a) => `rgba(220,220,255,${a})`,
    green:   (a) => `rgba(0,255,120,${a})`,
    magenta: (a) => `rgba(220,0,255,${a})`,
  };
  const colorFn = (a) => (COLORS[params.color] || COLORS.cyan)(a);

  function bindSlider(id, valId, key, transform, fmt) {
    const slider = document.getElementById(id);
    const valEl  = document.getElementById(valId);
    slider.addEventListener("input", () => {
      params[key] = transform(parseFloat(slider.value));
      valEl.textContent = fmt(params[key]);
    });
  }
  bindSlider("size-slider",    "size-val",    "sizeMultiplier", v => v,       v => v.toFixed(1) + "×");
  bindSlider("dropout-slider", "dropout-val", "dropout",        v => v / 100, v => Math.round(v * 100) + "%");
  bindSlider("jitter-slider",  "jitter-val",  "jitter",         v => v,       v => v.toFixed(1) + " px");
  bindSlider("decay-slider",   "decay-val",   "decay",          v => v,       v => v.toFixed(2));
  document.getElementById("color-select").addEventListener("change", function () {
    params.color = this.value;
  });

  // ── Phosphene / Edge mode ────────────────────────────────────────────────
  function setMode(mode) {
    currentMode = mode;
    modeLabelEl.textContent = mode;
    modeRawBtn.classList.toggle("active", mode === "raw");
    modeEdgeBtn.classList.toggle("active", mode === "edge");
    modeDescEl.textContent = mode === "edge"
      ? (currentSource === "camera" ? "JS Sobel edge map → phosphenes on contours" : "ONNX Sobel edge map → phosphenes on contours")
      : "Full grayscale intensity → phosphenes";
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(mode);
  }
  modeRawBtn.addEventListener("click", () => setMode("raw"));
  modeEdgeBtn.addEventListener("click", () => setMode("edge"));

  // ── Offscreen canvas for image decoding ─────────────────────────────────
  const offscreen = document.createElement("canvas");
  offscreen.width = W; offscreen.height = H;
  const offCtx = offscreen.getContext("2d", { willReadFrequently: true });

  function extractGrayFromB64(b64) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        offCtx.drawImage(img, 0, 0, W, H);
        const data = offCtx.getImageData(0, 0, W, H).data;
        const gray = new Uint8Array(W * H);
        for (let i = 0; i < W * H; i++) gray[i] = data[i * 4];
        resolve(gray);
      };
      img.src = "data:image/png;base64," + b64;
    });
  }

  function extractGrayFromVideo() {
    offCtx.drawImage(videoEl, 0, 0, W, H);
    const data = offCtx.getImageData(0, 0, W, H).data;
    const gray = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) {
      gray[i] = (0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]) | 0;
    }
    return gray;
  }

  // ── JS Sobel (client-side edge detection for camera mode) ────────────────
  const KX = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
  const KY = [-1, -2, -1, 0, 0, 0, 1, 2, 1];
  function sobelEdge(gray) {
    const edges = new Uint8Array(W * H);
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        let gx = 0, gy = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const p = gray[(y + dy) * W + (x + dx)];
            const ki = (dy + 1) * 3 + (dx + 1);
            gx += KX[ki] * p;
            gy += KY[ki] * p;
          }
        }
        edges[y * W + x] = Math.sqrt(gx * gx + gy * gy) > 30 ? 255 : 0;
      }
    }
    return edges;
  }

  // ── Phosphene renderer ───────────────────────────────────────────────────
  function renderPhosphenes(gray) {
    ctx.fillStyle = `rgba(0,0,0,${(1 - params.decay).toFixed(3)})`;
    ctx.fillRect(0, 0, CW, CH);

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (Math.random() < params.dropout) continue;
        const intensity = gray[y * W + x] / 255;
        if (intensity < 0.04) continue;
        const radius = intensity * CELL * 0.5 * params.sizeMultiplier;
        if (radius < 0.3) continue;
        const jx = (Math.random() * 2 - 1) * params.jitter;
        const jy = (Math.random() * 2 - 1) * params.jitter;
        const cx = x * CELL + CELL / 2 + jx;
        const cy = y * CELL + CELL / 2 + jy;
        const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
        grd.addColorStop(0,   colorFn(intensity));
        grd.addColorStop(0.6, colorFn(intensity * 0.6));
        grd.addColorStop(1,   colorFn(0));
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fillStyle = grd;
        ctx.fill();
      }
    }
  }

  function tickStats() {
    totalFrames++;
    fpsCount++;
    framesEl.textContent = totalFrames;
    const now = performance.now();
    if (now - lastFpsTime >= 1000) {
      fpsEl.textContent = (fpsCount / ((now - lastFpsTime) / 1000)).toFixed(1);
      fpsCount = 0;
      lastFpsTime = now;
    }
  }

  // ── Server / WebSocket path ──────────────────────────────────────────────
  function getWsUrl() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    return `${proto}://${location.host}/stream`;
  }

  function connect() {
    statusText.textContent = "Connecting…";
    overlay.classList.remove("hidden");
    ws = new WebSocket(getWsUrl());
    ws.onopen = () => { overlay.classList.add("hidden"); ws.send(currentMode); };
    ws.onmessage = async (event) => {
      if (paused || currentSource !== "server") return;
      const gray = await extractGrayFromB64(event.data);
      renderPhosphenes(gray);
      tickStats();
    };
    ws.onerror = () => { statusText.textContent = "Error — retrying…"; overlay.classList.remove("hidden"); };
    ws.onclose = () => {
      if (!paused && currentSource === "server") {
        statusText.textContent = "Disconnected — reconnecting…";
        overlay.classList.remove("hidden");
        setTimeout(connect, 2000);
      }
    };
  }

  function disconnectServer() {
    if (ws) { ws.onclose = null; ws.close(); ws = null; }
  }

  // ── Camera / getUserMedia path ───────────────────────────────────────────
  async function populateDevices() {
    try {
      // Trigger permission so labels are populated
      const tmp = await navigator.mediaDevices.getUserMedia({ video: true });
      tmp.getTracks().forEach(t => t.stop());
    } catch (_) {}
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cameras = devices.filter(d => d.kind === "videoinput");
    deviceSelect.innerHTML = "";
    cameras.forEach((d, i) => {
      const opt = document.createElement("option");
      opt.value = d.deviceId;
      opt.textContent = d.label || `Camera ${i + 1}`;
      deviceSelect.appendChild(opt);
    });
    if (cameras.length === 0) {
      const opt = document.createElement("option");
      opt.textContent = "No cameras found";
      deviceSelect.appendChild(opt);
    }
  }

  async function startCamera(deviceId) {
    stopCamera();
    cameraStatusEl.textContent = "Requesting camera…";
    try {
      const constraints = {
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        }
      };
      cameraStream = await navigator.mediaDevices.getUserMedia(constraints);
      videoEl.srcObject = cameraStream;
      await videoEl.play();
      cameraStatusEl.textContent = "";
      overlay.classList.add("hidden");
      runCameraLoop();
    } catch (err) {
      cameraStatusEl.textContent = `Camera error: ${err.message}`;
      overlay.classList.remove("hidden");
      statusText.textContent = "Camera access denied";
    }
  }

  function stopCamera() {
    if (cameraLoopId) { cancelAnimationFrame(cameraLoopId); cameraLoopId = null; }
    if (cameraStream) { cameraStream.getTracks().forEach(t => t.stop()); cameraStream = null; }
    videoEl.srcObject = null;
  }

  function runCameraLoop() {
    function tick() {
      if (currentSource !== "camera" || paused) return;
      if (videoEl.readyState >= 2) {
        let gray = extractGrayFromVideo();
        if (currentMode === "edge") gray = sobelEdge(gray);
        renderPhosphenes(gray);
        tickStats();
      }
      cameraLoopId = requestAnimationFrame(tick);
    }
    cameraLoopId = requestAnimationFrame(tick);
  }

  // ── Source toggle ────────────────────────────────────────────────────────
  function setSource(src) {
    currentSource = src;
    srcServerBtn.classList.toggle("active", src === "server");
    srcCameraBtn.classList.toggle("active", src === "camera");
    cameraSelectorWrap.style.display = src === "camera" ? "flex" : "none";

    if (src === "server") {
      stopCamera();
      cameraStatusEl.textContent = "";
      setMode(currentMode);
      connect();
    } else {
      disconnectServer();
      overlay.classList.remove("hidden");
      statusText.textContent = "Starting camera…";
      populateDevices().then(() => startCamera(deviceSelect.value));
      setMode(currentMode);
    }
  }

  srcServerBtn.addEventListener("click", () => setSource("server"));
  srcCameraBtn.addEventListener("click", () => setSource("camera"));
  deviceSelect.addEventListener("change", () => {
    if (currentSource === "camera") startCamera(deviceSelect.value);
  });

  // ── Pause/Resume ─────────────────────────────────────────────────────────
  toggleBtn.addEventListener("click", () => {
    paused = !paused;
    toggleBtn.textContent = paused ? "Resume" : "Pause";
    if (paused) {
      if (currentSource === "server") { ws && ws.close(); }
      statusText.textContent = "Paused";
      overlay.classList.remove("hidden");
    } else {
      overlay.classList.add("hidden");
      if (currentSource === "server") connect();
      else runCameraLoop();
    }
  });

  // ── Implant button ───────────────────────────────────────────────────────
  const implantBtn   = document.getElementById("implant-btn");
  const implantPanel = document.getElementById("implant-panel");
  const implantClose = document.getElementById("implant-close");
  const implantGrid  = document.getElementById("implant-grid");
  const implantLog   = document.getElementById("implant-log");
  const implantStats = document.getElementById("implant-stats");

  const ELEC = 8; // 8×8 electrode grid
  const BLOCK = W / ELEC; // 128/8 = 16 pixels per electrode cell
  const DURATION_US = 400;

  function frameToPackets(gray) {
    const packets = [];
    for (let er = 0; er < ELEC; er++) {
      for (let ec = 0; ec < ELEC; ec++) {
        let sum = 0;
        for (let py = er * BLOCK; py < (er + 1) * BLOCK; py++) {
          for (let px = ec * BLOCK; px < (ec + 1) * BLOCK; px++) {
            sum += gray[py * W + px];
          }
        }
        const avg = sum / (BLOCK * BLOCK);
        if (avg > 10) {
          packets.push({
            electrode_id: er * ELEC + ec,
            amplitude: Math.round((avg / 255) * 180), // scale to ≤180 (safe)
            duration_us: DURATION_US,
          });
        }
      }
    }
    return packets;
  }

  implantBtn.addEventListener("click", async () => {
    // Capture current frame from canvas
    const imageData = ctx.getImageData(0, 0, CW, CH);
    // Downsample CW×CH → W×H grayscale via offscreen
    offCtx.drawImage(canvas, 0, 0, W, H);
    const small = offCtx.getImageData(0, 0, W, H).data;
    const gray = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) {
      gray[i] = (0.299 * small[i*4] + 0.587 * small[i*4+1] + 0.114 * small[i*4+2]) | 0;
    }

    const packets = frameToPackets(gray);
    implantBtn.textContent = "⚡ Sending…";
    implantBtn.disabled = true;

    try {
      const res = await fetch("/implant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packets }),
      });
      const data = await res.json();

      implantGrid.textContent = data.grid;
      implantStats.textContent =
        `Electrodes fired: ${data.total - data.rejected} / ${ELEC*ELEC}   Rejected: ${data.rejected}`;
      implantLog.textContent = data.logs.join("\n") || "(no log entries)";
      implantPanel.style.display = "block";
    } catch (e) {
      implantLog.textContent = "Error: " + e.message;
      implantPanel.style.display = "block";
    } finally {
      implantBtn.textContent = "⚡ Implant Frame";
      implantBtn.disabled = false;
    }
  });

  implantClose.addEventListener("click", () => {
    implantPanel.style.display = "none";
  });

  // ── Init ─────────────────────────────────────────────────────────────────
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, CW, CH);
  connect();
})();
