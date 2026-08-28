# syntax=docker/dockerfile:1.6
# ---------------------------------------------------------------------------
# llama.cpp server image tuned for CPU inference on Render.
#
# Render's standard compute plans are CPU-only (no NVIDIA GPU), so
# "optimized" here means:
#   - build llama.cpp with native CPU vectorization (AVX2/AVX-512/FMA,
#     whatever the build host supports) instead of the generic fallback
#   - link OpenBLAS for faster prompt processing (matmul-heavy prefill)
#   - use LTO + Release flags
#   - run llama-server with thread counts pinned to the container's
#     actual CPU allocation and continuous batching enabled
#
# It does NOT make a 13B model answer in one minute on a CPU — no amount
# of build flags does that. Model choice is what actually controls
# latency; see README.md for guidance and realistic numbers.
# ---------------------------------------------------------------------------

FROM ubuntu:22.04 AS builder

ARG LLAMA_CPP_REF=master
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    cmake \
    git \
    ca-certificates \
    libopenblas-dev \
    libcurl4-openssl-dev \
    pkg-config \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src
RUN git clone --depth 1 --branch ${LLAMA_CPP_REF} https://github.com/ggerganov/llama.cpp . \
    || (git clone --depth 1 https://github.com/ggerganov/llama.cpp . && git checkout ${LLAMA_CPP_REF})

# GGML_NATIVE=ON makes the compiler auto-detect the *build machine's* ISA
# (AVX2/AVX-512/FMA/etc) and compile for it specifically, which is faster
# than the portable default -- but it means the image should be built on
# hardware of the same CPU family as what it will run on. Render's build
# fleet and its runtime fleet are the same family, so this is safe there.
# If you're building elsewhere and deploying to Render, pin flags manually
# instead (see README.md).
#
# NOTE on GGML_LTO: deliberately left OFF. llama-server now pulls in
# tools/mtmd (multimodal support, e.g. siglip.cpp), which is a large,
# template-heavy translation unit. With LTO on, each parallel compile job
# for files like that holds substantial IR in memory, and running several
# of them at once (-j$(nproc)) is enough to OOM-kill Render's build
# container. LTO's runtime win here is marginal next to that risk, so it's
# not worth it for this build.
#
# NOTE on -j: capped instead of using $(nproc) directly. Job count that
# matters for avoiding OOM is memory-bound, not core-bound -- a build
# machine can have many cores but limited RAM. BUILD_JOBS defaults to 4;
# lower it (build-arg) if you still see OOM on a smaller build plan.
ARG BUILD_JOBS=4
RUN cmake -B build \
    -DCMAKE_BUILD_TYPE=Release \
    -DGGML_NATIVE=ON \
    -DGGML_OPENBLAS=ON \
    -DGGML_LTO=OFF \
    -DLLAMA_CURL=ON \
    -DLLAMA_BUILD_TESTS=OFF \
    -DLLAMA_BUILD_EXAMPLES=ON \
    -DLLAMA_BUILD_SERVER=ON \
    && cmake --build build --config Release -j"${BUILD_JOBS}" --target llama-server llama-cli llama-quantize llama-bench

# ---------------------------------------------------------------------------
FROM ubuntu:22.04 AS runtime
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    libopenblas0 \
    libgomp1 \
    libcurl4 \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /src/build/bin/llama-server /app/llama-server
COPY --from=builder /src/build/bin/llama-cli /app/llama-cli
COPY --from=builder /src/build/bin/llama-quantize /app/llama-quantize
COPY --from=builder /src/build/bin/llama-bench /app/llama-bench
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

RUN mkdir -p /models

# Render injects $PORT at runtime; the container must bind to it.
ENV PORT=10000
ENV MODEL_DIR=/models
ENV MODEL_FILE=model.gguf
# Default is a small, fast, instruction-tuned model. Override MODEL_URL
# to point at whatever GGUF you actually want to serve.
ENV MODEL_URL="https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf"
ENV CTX_SIZE=4096
ENV N_PREDICT_DEFAULT=512
ENV BATCH_SIZE=1024
ENV UBATCH_SIZE=256
ENV PARALLEL_SLOTS=1

EXPOSE 10000

HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
    CMD curl -fs http://127.0.0.1:${PORT}/health || exit 1

ENTRYPOINT ["/app/entrypoint.sh"]
