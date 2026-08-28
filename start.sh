#!/bin/sh
set -eu

PORT="${PORT:-10000}"
MODEL_PATH="${MODEL_PATH:-/models/model.gguf}"
CTX_SIZE="${CTX_SIZE:-4096}"
N_PREDICT="${N_PREDICT:-512}"

# Find llama-server regardless of whether the image exposes it via PATH.
if command -v llama-server >/dev/null 2>&1; then
    LLAMA_SERVER="$(command -v llama-server)"
elif [ -x /app/llama-server ]; then
    LLAMA_SERVER="/app/llama-server"
else
    echo "ERROR: llama-server executable was not found in the container." >&2
    exit 1
fi

exec "$LLAMA_SERVER"     --model "$MODEL_PATH"     --host 0.0.0.0     --port "$PORT"     --ctx-size "$CTX_SIZE"     --n-predict "$N_PREDICT"
