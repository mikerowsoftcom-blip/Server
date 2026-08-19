#!/usr/bin/env bash
set -euo pipefail

# Render sets $PORT for web services; default to 10000 for local testing.
PORT="${PORT:-10000}"
THREADS="${THREADS:-$(nproc)}"
CTX_SIZE="${CTX_SIZE:-2048}"

echo "Starting llama-server on 0.0.0.0:${PORT} with ${THREADS} threads..."

exec /app/llama-server \
    --model /app/models/model.gguf \
    --host 0.0.0.0 \
    --port "${PORT}" \
    --ctx-size "${CTX_SIZE}" \
    --threads "${THREADS}" \
    --n-gpu-layers 0 \
    --chat-template chatml \
    ${LLAMA_API_KEY:+--api-key "${LLAMA_API_KEY}"}
