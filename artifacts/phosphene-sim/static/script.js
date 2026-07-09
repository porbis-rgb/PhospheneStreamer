(function () {
  const canvas = document.getElementById("display");
  const ctx = canvas.getContext("2d");
  const overlay = document.getElementById("overlay");
  const statusText = document.getElementById("status-text");
  const fpsEl = document.getElementById("fps-counter");
  const framesEl = document.getElementById("frame-counter");
  const sourceEl = document.getElementById("source-label");
  const toggleBtn = document.getElementById("toggle-btn");

  const W = 128, H = 128;
  const CANVAS_W = canvas.width;
  const CANVAS_H = canvas.height;
  const CELL = CANVAS_W / W;

  let paused = false;
  let ws = null;
  let totalFrames = 0;
  let fpsCount = 0;
  let lastFpsTime = performance.now();

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

  function colorFn(a) {
    return (COLORS[params.color] || COLORS.cyan)(a);
  }

  function bindSlider(id, valId, key, fmt) {
    const slider = document.getElementById(id);
    const valEl  = document.getElementById(valId);
    slider.addEventListener("input", () => {
      params[key] = parseFloat(slider.value);
      valEl.textContent = fmt(params[key]);
    });
  }

  bindSlider("size-slider",    "size-val",    "sizeMultiplier", v => v.toFixed(1) + "×");
  bindSlider("dropout-slider", "dropout-val", "dropout",        v => Math.round(v) + "%");
  bindSlider("jitter-slider",  "jitter-val",  "jitter",         v => v.toFixed(1) + " px");
  bindSlider("decay-slider",   "decay-val",   "decay",          v => v.toFixed(2));

  document.getElementById("dropout-slider").addEventListener("input", function () {
    params.dropout = parseFloat(this.value) / 100;
  });

  document.getElementById("color-select").addEventListener("change", function () {
    params.color = this.value;
  });

  const offscreen = document.createElement("canvas");
  offscreen.width = W;
  offscreen.height = H;
  const offCtx = offscreen.getContext("2d");

  function extractGray(b64) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        offCtx.drawImage(img, 0, 0, W, H);
        const data = offCtx.getImageData(0, 0, W, H).data;
        const gray = new Uint8Array(W * H);
        for (let i = 0; i < W * H; i++) {
          gray[i] = data[i * 4];
        }
        resolve(gray);
      };
      img.src = "data:image/png;base64," + b64;
    });
  }

  function renderPhosphenes(gray) {
    ctx.fillStyle = `rgba(0,0,0,${(1 - params.decay).toFixed(3)})`;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

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

  function updateStats() {
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

  function getWsUrl() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    return `${proto}://${location.host}/stream`;
  }

  function connect() {
    statusText.textContent = "Connecting…";
    overlay.classList.remove("hidden");
    ws = new WebSocket(getWsUrl());

    ws.onopen = () => {
      overlay.classList.add("hidden");
      sourceEl.textContent = "stream";
    };

    ws.onmessage = async (event) => {
      if (paused) return;
      const gray = await extractGray(event.data);
      renderPhosphenes(gray);
      updateStats();
    };

    ws.onerror = () => {
      statusText.textContent = "Error — retrying…";
      overlay.classList.remove("hidden");
    };

    ws.onclose = () => {
      if (!paused) {
        statusText.textContent = "Disconnected — reconnecting…";
        overlay.classList.remove("hidden");
        setTimeout(connect, 2000);
      }
    };
  }

  toggleBtn.addEventListener("click", () => {
    paused = !paused;
    toggleBtn.textContent = paused ? "Resume" : "Pause";
    if (paused) {
      ws && ws.close();
      statusText.textContent = "Paused";
      overlay.classList.remove("hidden");
    } else {
      connect();
    }
  });

  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  connect();
})();
