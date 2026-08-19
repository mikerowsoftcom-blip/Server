# Fantastic Happiness — prebuilt llama.cpp deployment

This version is designed for Render Free's constrained environment.

## Important

The Dockerfile installs `llama-cpp-python` from the official prebuilt CPU wheel index and uses `--only-binary=llama-cpp-python` so pip cannot fall back to compiling llama.cpp from source.

The project keeps the small Qwen 2.5 0.5B Q4_K_M model and uses a 256-token context, 32 batch size, and one thread by default.

## Render

Use the Docker runtime. No Build Command is needed for a Docker service; Render builds the Dockerfile.
