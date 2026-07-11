import asyncio
import base64
import os
import cv2
import numpy as np
import onnx
import onnxruntime as ort
from onnx import helper, TensorProto, numpy_helper
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel
from typing import List
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from src.electrodes import reset_array
from src.firmware_sim import simulate_from_streamer, ascii_grid

app = FastAPI()

FRAME_WIDTH = 128
FRAME_HEIGHT = 128
FPS_TARGET = 20
MODEL_PATH = os.path.join(os.path.dirname(__file__), "edge_model.onnx")


def build_edge_model(path: str) -> None:
    kx = np.array([[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]], dtype=np.float32).reshape(1, 1, 3, 3)
    ky = np.array([[-1, -2, -1], [0, 0, 0], [1, 2, 1]], dtype=np.float32).reshape(1, 1, 3, 3)
    div_val = np.array([1440.0], dtype=np.float32)
    thresh = np.array([0.04], dtype=np.float32)

    nodes = [
        helper.make_node("Conv", ["x", "kx"], ["gx"], pads=[1, 1, 1, 1]),
        helper.make_node("Conv", ["x", "ky"], ["gy"], pads=[1, 1, 1, 1]),
        helper.make_node("Mul", ["gx", "gx"], ["gx2"]),
        helper.make_node("Mul", ["gy", "gy"], ["gy2"]),
        helper.make_node("Add", ["gx2", "gy2"], ["mag2"]),
        helper.make_node("Sqrt", ["mag2"], ["mag"]),
        helper.make_node("Div", ["mag", "div_val"], ["mag_norm"]),
        helper.make_node("Greater", ["mag_norm", "thresh"], ["edge_bool"]),
        helper.make_node("Cast", ["edge_bool"], ["edges"], to=TensorProto.FLOAT),
    ]
    initializers = [
        numpy_helper.from_array(kx, "kx"),
        numpy_helper.from_array(ky, "ky"),
        numpy_helper.from_array(div_val, "div_val"),
        numpy_helper.from_array(thresh, "thresh"),
    ]
    input_ = helper.make_tensor_value_info("x", TensorProto.FLOAT, [1, 1, 128, 128])
    output = helper.make_tensor_value_info("edges", TensorProto.FLOAT, [1, 1, 128, 128])
    graph = helper.make_graph(nodes, "sobel_edge", [input_], [output], initializer=initializers)
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 13)])
    model.ir_version = 7
    onnx.checker.check_model(model)
    onnx.save(model, path)


if not os.path.exists(MODEL_PATH):
    build_edge_model(MODEL_PATH)

_ort_session = ort.InferenceSession(MODEL_PATH, providers=["CPUExecutionProvider"])


def run_edge_detection(gray: np.ndarray) -> np.ndarray:
    inp = gray.astype(np.float32)[np.newaxis, np.newaxis, :, :]
    (edges,) = _ort_session.run(None, {"x": inp})
    return (edges[0, 0] * 255).astype(np.uint8)


def get_test_frame(tick: int) -> np.ndarray:
    frame = np.zeros((FRAME_HEIGHT, FRAME_WIDTH), dtype=np.uint8)
    cx = int(FRAME_WIDTH / 2 + (FRAME_WIDTH / 3) * np.sin(tick * 0.07))
    cy = int(FRAME_HEIGHT / 2 + (FRAME_HEIGHT / 3) * np.cos(tick * 0.05))
    cv2.circle(frame, (cx, cy), 22, 220, -1)
    cv2.ellipse(frame, (64, 64), (40, 20), tick * 2, 0, 360, 120, 2)
    cv2.rectangle(frame, (5, 5), (35, 35), 160, 2)
    cv2.line(frame, (0, FRAME_HEIGHT // 2), (FRAME_WIDTH, FRAME_HEIGHT // 2), 80, 1)
    gradient = np.linspace(0, 100, FRAME_WIDTH, dtype=np.uint8)
    frame[FRAME_HEIGHT - 10: FRAME_HEIGHT - 5, :] = gradient
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

    mode = {"value": "raw"}

    async def recv_loop():
        try:
            while True:
                msg = await ws.receive_text()
                if msg in ("edge", "raw"):
                    mode["value"] = msg
        except Exception:
            pass

    recv_task = asyncio.create_task(recv_loop())
    tick = 0
    delay = 1.0 / FPS_TARGET

    try:
        while True:
            start = asyncio.get_event_loop().time()

            if use_webcam and cap and cap.isOpened():
                ret, raw = cap.read()
                gray = cv2.cvtColor(raw, cv2.COLOR_BGR2GRAY) if ret else get_test_frame(tick)
                if ret:
                    gray = cv2.resize(gray, (FRAME_WIDTH, FRAME_HEIGHT))
            else:
                gray = get_test_frame(tick)

            if mode["value"] == "edge":
                output_frame = run_edge_detection(gray)
            else:
                output_frame = gray

            await ws.send_text(encode_frame(output_frame))

            elapsed = asyncio.get_event_loop().time() - start
            await asyncio.sleep(max(0, delay - elapsed))
            tick += 1

    except WebSocketDisconnect:
        pass
    finally:
        recv_task.cancel()
        if cap:
            cap.release()


class ImplantPacket(BaseModel):
    electrode_id: int
    amplitude: int
    duration_us: int

class ImplantRequest(BaseModel):
    packets: List[ImplantPacket]

@app.post("/implant")
async def implant(req: ImplantRequest):
    reset_array()
    logs = []
    rejected = 0
    for pkt in req.packets:
        result = simulate_from_streamer(pkt.model_dump())
        logs.extend(result["log"])
        if not result["ok"]:
            rejected += 1
    return JSONResponse({
        "grid": ascii_grid(),
        "logs": logs,
        "total": len(req.packets),
        "rejected": rejected,
    })


app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/")
async def root():
    return FileResponse("static/index.html")
