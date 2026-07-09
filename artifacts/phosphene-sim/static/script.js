(function () {
  const canvas = document.getElementById("display");
  const ctx = canvas.getContext("2d");
  const overlay = document.getElementById("overlay");
  const statusText = document.getElementById("status-text");
  const fpsCounter = document.getElementById("fps-counter");
  const frameCounter = document.getElementById("frame-counter");
  const sourceLabel = document.getElementById("source-label");
  const toggleBtn = document.getElementById("toggle-btn");
  const scaleSlider = document.getElementById("scale-slider");
  const scaleVal = document.getElementById("scale-val");

  let ws = null;
  let paused = false;
  let frames = 0;
  let lastFpsTime = performance.now();
  let fpsFrames = 0;
  let scale = parseInt(scaleSlider.value, 10);
  let connected = false;

  function getWsUrl() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    return `${proto}://${location.host}/stream`;
  }

  function connect() {
    statusText.textContent = "Connecting…";
    overlay.classList.remove("hidden");

    ws = new WebSocket(getWsUrl());

    ws.onopen = () => {
      connected = true;
      overlay.classList.add("hidden");
      sourceLabel.textContent = "Source: streaming";
    };

    ws.onmessage = (event) => {
      if (paused) return;

      const img = new Image();
      img.onload = () => {
        ctx.imageSmoothingEnabled = false;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      };
      img.src = "data:image/png;base64," + event.data;

      frames++;
      fpsFrames++;
      frameCounter.textContent = `Frames: ${frames}`;

      const now = performance.now();
      if (now - lastFpsTime >= 1000) {
        const fps = (fpsFrames / ((now - lastFpsTime) / 1000)).toFixed(1);
        fpsCounter.textContent = `FPS: ${fps}`;
        fpsFrames = 0;
        lastFpsTime = now;
      }
    };

    ws.onerror = () => {
      statusText.textContent = "Connection error — retrying…";
      overlay.classList.remove("hidden");
    };

    ws.onclose = () => {
      connected = false;
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
    if (paused && ws) {
      ws.close();
      statusText.textContent = "Paused";
      overlay.classList.remove("hidden");
    } else {
      connect();
    }
  });

  scaleSlider.addEventListener("input", () => {
    scale = parseInt(scaleSlider.value, 10);
    scaleVal.textContent = `${scale}×`;
  });

  connect();
})();
