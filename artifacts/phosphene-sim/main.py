import asyncio
import base64
import cv2
import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

app = FastAPI()

FRAME_WIDTH = 128
FRAME_HEIGHT = 128
FPS_TARGET = 20


def get_test_frame(tick: int) -> np.ndarray:
    frame = np.zeros((FRAME_HEIGHT, FRAME_WIDTH), dtype=np.uint8)
    cx = int(FRAME_WIDTH / 2 + (FRAME_WIDTH / 3) * np.sin(tick * 0.07))
    cy = int(FRAME_HEIGHT / 2 + (FRAME_HEIGHT / 3) * np.cos(tick * 0.05))
    cv2.circle(frame, (cx, cy), 22, 220, -1)
    cv2.ellipse(frame, (64, 64), (40, 20), tick * 2, 0, 360, 120, 2)
    cv2.rectangle(frame, (5, 5), (35, 35), 160, 2)
    cv2.line(frame, (0, FRAME_HEIGHT // 2), (FRAME_WIDTH, FRAME_HEIGHT // 2), 80, 1)
    gradient = np.linspace(0, 100, FRAME_WIDTH, dtype=np.uint8)
    frame[FRAME_HEIGHT - 10 : FRAME_HEIGHT - 5, :] = gradient
    return frame


def encode_frame(frame: np.ndarray) -> str:
    success, buf = cv2.imencode(".png", frame)
    if not success:
        raise RuntimeError("Failed to encode frame")
    return base64.b64encode(buf.tobytes()).decode("utf-8")


@app.websocket("/stream")
async def stream(ws: WebSocket):
    await ws.accept()
    cap = None
    use_webcam = False

    try:
        cap = cv2.VideoCapture(0)
        if cap.isOpened():
            use_webcam = True
    except Exception:
        pass

    tick = 0
    delay = 1.0 / FPS_TARGET

    try:
        while True:
            start = asyncio.get_event_loop().time()

            if use_webcam and cap and cap.isOpened():
                ret, raw = cap.read()
                if ret:
                    gray = cv2.cvtColor(raw, cv2.COLOR_BGR2GRAY)
                    gray = cv2.resize(gray, (FRAME_WIDTH, FRAME_HEIGHT))
                else:
                    gray = get_test_frame(tick)
            else:
                gray = get_test_frame(tick)

            b64 = encode_frame(gray)
            await ws.send_text(b64)

            elapsed = asyncio.get_event_loop().time() - start
            await asyncio.sleep(max(0, delay - elapsed))
            tick += 1

    except WebSocketDisconnect:
        pass
    finally:
        if cap:
            cap.release()


app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/")
async def root():
    return FileResponse("static/index.html")
