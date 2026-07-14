Phosphene Streamer README
Link
July 2026-Present

Introduction
Phosphene Streamer is a project where I combined my technical abilities with my commitment to reducing human suffering. I used Replit Agent to generate a system that processes real‑world images and translates them into a tactile, perceivable “language for the blind.”
The backend is built with Python and FastAPI, enabling real‑time webcam capture and frame processing. On the frontend, vanilla JavaScript and the Canvas API transform those frames into structured visual‑to‑tactile patterns that can help visually impaired users better understand what’s in front of them.
While Phosphene Streamer isn’t a standalone “virtual eye,” it’s designed to interface with implant firmware and real camera hardware to support next‑generation assistive vision technologies.
This project allowed me to explore how software can meaningfully improve lives, and it strengthened my belief that engineering can be a tool for compassion.
More Technical + Engineering‑Driven
Phosphene Streamer is an assistive‑technology project focused on converting visual input into a structured sensory language for blind users. My contribution centered on building a Python/FastAPI backend capable of capturing webcam streams, segmenting them into frames, and preparing them for real‑time processing.
On the client side, I implemented a JavaScript + Canvas API pipeline that transforms each frame into a pattern representation interpretable by tactile or neural‑implant systems. The system is intentionally modular, allowing future integration with implant firmware and external camera hardware.
Although not a standalone vision device, Phosphene Streamer serves as a critical bridge between raw visual data and the sensory interfaces that can make that data meaningful.
This project deepened my experience in real‑time systems, image processing, and human‑centered engineering.
 Mission‑Driven + Storytelling (Strong Personal Branding)
Phosphene Streamer is one of the projects that reminded me why I chose to work in technology. I helped build a system that takes live images from a webcam and converts them into a structured sensory language designed for blind individuals.
Using Python/FastAPI on the backend and vanilla JavaScript/Canvas API on the frontend, the project translates visual information into patterns that can be interpreted through assistive implants. It isn’t a virtual eye on its own, but it’s a meaningful step toward technologies that can restore or enhance perception.
Limitations: This project cannot function as a virtual eye by itself because it needs to interact with implant firmware and a real camera to work as a virtual eye

Tools
Replit Agent was used to generate the project
Working on Phosphene Streamer allowed me to merge my desire to reduce suffering with my engineering skills. It reinforced my belief that software can be more than code — it can be a pathway to dignity, independence, and hope.




Real-Time Phosphene Vision Simulator — Link

What it is
A browser-based simulation of bionic/cortical vision — the kind of artificial sight experienced by recipients of visual prosthetics (like the Orion or Argus II implants). It converts live video frames into a grid of glowing dots called phosphenes, mimicking how electrical stimulation of the visual cortex produces perceived light.

Architecture
Backend — Python / FastAPI
Captures frames from a webcam (or animated test pattern as fallback) using OpenCV
Resizes each frame to 128×128 grayscale — matching the resolution of real bionic vision devices
Runs an ONNX Runtime inference session on every frame using a programmatically built Sobel edge-detection model
Streams raw grayscale or binary edge maps over a WebSocket endpoint (/stream) at ~20 FPS
The ONNX model is constructed at startup using ONNX graph primitives (Conv → Sqrt → Div → Greater → Cast), requiring no external model download
Frontend — Vanilla JavaScript / Canvas API
Connects to the WebSocket and receives base64-encoded PNG frames
Decodes pixel intensity values from each 128×128 frame using an offscreen canvas
Renders phosphenes as radial gradient circles on an HTML canvas, where circle radius scales with pixel intensity
Applies four real-time effects:
Dropout — randomly skips a percentage of phosphenes (simulates electrode failure)
Jitter — shifts each dot by a random pixel offset (simulates spatial uncertainty)
Temporal persistence — fades previous frames with a decay factor (simulates neural afterglow)
Glow — radial gradient from bright core to transparent edge

Key Design Decisions
Decision
Rationale
128×128 resolution
Matches real bionic vision implant electrode counts
ONNX Runtime on CPU
Portable, no GPU required, runs in cloud/edge environments
Programmatic ONNX model
No external model file — Sobel kernels baked as ONNX initializers at startup
WebSocket streaming
Low-latency bidirectional channel; client sends mode changes ("raw"/"edge") without reconnecting
Frontend-side rendering
Offloads all visual effects from server; sliders update in real time without server round-trips


Modes
Raw mode — phosphene brightness maps to full grayscale intensity; every bright region produces dots
Edge-Only mode — ONNX Sobel inference runs server-side; only contour pixels produce phosphenes, matching how bionic implants emphasize edges for object recognition

Stack
Python · FastAPI · ONNX Runtime · OpenCV · WebSocket · HTML Canvas API · Vanilla JS














































The main.py in artifacts manages the backend and process images from the web cam.

The javascript file in artifacts -> static helps manage the front end and computes gradients and a tactile language that can be transferred to an external implant firmware that can help the blind process their surroundings. 

The tactile language can then be used for the blind
