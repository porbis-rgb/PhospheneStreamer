import asyncio
import base64
import cv2
import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import os

app = FastAPI()

FRAME_WIDTH = 128
FRAME_HEIGHT = 128
FPS_TARGET = 20


def apply_phosphene_effect(frame_gray: np.ndarray) -> np.ndarray:
    blurred = cv2.GaussianBlur(frame_gray, (5, 5), 0)
    _, threshed = cv2.threshold(blurred, 60, 255, cv2.THRESH_BINARY)
    dot_map = np.zeros_like(threshed)
    spacing = 4
    for y in range(0, threshed.shape[0], spacing):
        for x in range(0, threshed.shape[1], spacing):
            if threshed[y, x] > 0:
                cv2.circle(dot_map, (x, y), 1, 255, -1)
    glow = cv2.GaussianBlur(dot_map, (3, 3), 0)
    result = cv2.addWeighted(dot_map, 0.8, glow, 0.4, 0)
    return result


def encode_frame(frame: np.ndarray) -> str:
    success, buf = cv2.imencode(".png", frame)
    if not success:
        raise RuntimeError("Failed to encode frame")
    return base64.b64encode(buf.tobytes()).decode("utf-8")


def get_test_frame(tick: int) -> np.ndarray:
    frame = np.zeros((FRAME_HEIGHT, FRAME_WIDTH), dtype=np.uint8)
    cx = int(FRAME_WIDTH / 2 + (FRAME_WIDTH / 3) * np.sin(tick * 0.07))
    cy = int(FRAME_HEIGHT / 2 + (FRAME_HEIGHT / 3) * np.cos(tick * 0.05))
    cv2.circle(frame, (cx, cy), 18, 200, -1)
    cv2.rectangle(frame, (5, 5), (30, 30), 180, 2)
    cv2.line(frame, (0, FRAME_HEIGHT // 2), (FRAME_WIDTH, FRAME_HEIGHT // 2), 100, 1)
    return frame


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

            phosphene = apply_phosphene_effect(gray)
            colored = cv2.applyColorMap(phosphene, cv2.COLORMAP_COOL)
            b64 = encode_frame(colored)

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
