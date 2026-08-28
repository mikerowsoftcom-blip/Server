#!/bin/sh
set -eu

PORT="${PORT:-10000}"
MODEL="${HF_MODEL:-tensorblock/SmolLM2-135M-Instruct-GGUF:Q4_K_M}"
CTX_SIZE="${CTX_SIZE:-512}"
N_PREDICT="${N_PREDICT:-256}"
THREADS="${THREADS:-1}"
BATCH="${BATCH:-32}"

if command -v llama-server >/dev/null 2>&1; then
    LLAMA_SERVER="$(command -v llama-server)"
elif [ -x /app/llama-server ]; then
    LLAMA_SERVER="/app/llama-server"
else
    echo "ERROR: llama-server executable was not found." >&2
    exit 1
fi

echo "Starting llama.cpp"
echo "Model: $MODEL"
echo "Port: $PORT"
echo "Context: $CTX_SIZE"

exec "$LLAMA_SERVER"     --hf-repo "$MODEL"     --host 0.0.0.0     --port "$PORT"     --ctx-size "$CTX_SIZE"     --n-predict "$N_PREDICT"     --threads "$THREADS"     --threads-batch "$THREADS"     --batch-size "$BATCH"     --parallel 1     --no-warmup
