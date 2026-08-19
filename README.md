# Qwen 2.5 0.5B — prebuilt llama.cpp for Render Free

This is the low-memory version.

It does NOT install `llama-cpp-python`, does NOT compile llama.cpp, and does NOT use ONNX Runtime.

It downloads:
1. an official prebuilt Ubuntu x64 CPU llama.cpp binary
2. the official Qwen2.5-0.5B-Instruct Q3_K_M GGUF

The Q3_K_M model is about 432 MB in the official Qwen GGUF repository. Q4_K_M is about 491 MB. Q3_K_M is intentionally used here to leave more headroom under Render Free's 512 MB RAM limit.

## Render

Create a Docker Web Service from this repository.

No build command and no start command are needed; the Dockerfile supplies both.

The service exposes:
- `/`
- `/health`
- `/generate`
- `/v1/chat/completions`

## Tunable environment variables

Defaults are intentionally conservative:
- `CTX=1024`
- `MAX_TOKENS=128`
- `THREADS=1`
- `THREADS_BATCH=1`
- `BATCH=32`
- `UBATCH=32`

Do not increase these on the 512 MB instance unless testing shows there is enough memory.

## Why this should be different

The previous deployment spent RAM loading ONNX Runtime and was killed with exit 137. This version uses the small standalone llama.cpp server binary and a smaller GGUF quantization, with a 1024-token context and one inference slot.

It is still CPU-limited by Render Free, so this is intended to minimize memory and startup overhead rather than promise a specific token/sec rate.
