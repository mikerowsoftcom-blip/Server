# Qwen 2.5 0.5B — Render CPU / ONNX Runtime GenAI

This version removes llama.cpp entirely.

It uses the prebuilt CPU INT4 Qwen2.5-0.5B ONNX GenAI package:
`xiaoyao9184/Qwen2.5-0.5B-Instruct-onnx-genai`
subdirectory:
`cpu_and_mobile/cpu-int4-rtn-block-32`

Render only installs Python wheels and downloads the already-converted model at startup. It does NOT compile llama.cpp.

## Render

Create a Web Service from this repository and choose Docker. No build command is needed.

Start command is defined by the Dockerfile.

Recommended environment variables:
- `MAX_NEW_TOKENS=160`
- `MAX_HISTORY=8`
- `OMP_NUM_THREADS=1`
- `ORT_NUM_THREADS=1`

The service exposes:
- `GET /`
- `GET /health`
- `POST /generate`
- `POST /v1/chat/completions`

The frontend streams `/v1/chat/completions`.

## Important

The ONNX Runtime GenAI CPU INT4 route is a benchmark experiment, not a guaranteed speed win over llama.cpp. The reason for trying it is to eliminate the llama.cpp compilation problem and test a dedicated CPU INT4 runtime/model package. If it is slower on Render, the next step should be a prebuilt llama.cpp wheel or a different CPU runtime rather than increasing model size.
