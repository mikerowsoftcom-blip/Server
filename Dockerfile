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

# NOTE on instruction set: GGML_NATIVE was tried first (-march=native,
# auto-detecting the *build* machine's ISA) but that caused a SIGILL
# (exit status 132) at runtime -- Render's build fleet and serving fleet
# aren't guaranteed to be the same CPU generation, so a binary compiled
# for whatever extensions the build node happened to expose (possibly
# AVX-512/VNNI/etc.) can crash the instant it hits an unsupported opcode
# on a different serving node. Fix: target an explicit, conservative
# instruction set instead of auto-detecting -- AVX2/FMA/F16C has been
# standard on essentially all cloud x86-64 hardware since ~2013, and
# AVX-512 variants are explicitly disabled so they can never get baked
# in by surprise again.
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
# NOTE, second attempt: AVX2/FMA/F16C *also* SIGILL'd on the actual
# runtime node -- so whatever hardware Render scheduled this container
# onto doesn't have AVX2 either (plausible on a smaller/shared-core
# instance type). Rather than keep guessing ISA levels one crash at a
# time, drop to the safest possible x86-64 baseline (no AVX family at
# all) so the server actually starts. entrypoint.sh now logs the real
# /proc/cpuinfo flags on boot -- once you can see what the instance
# actually supports, bump these back up (AVX2/FMA/F16C, or even
# AVX-512 subsets) to reclaim throughput, and re-test.
ARG BUILD_JOBS=4
RUN cmake -B build \
    -DCMAKE_BUILD_TYPE=Release \
    -DGGML_NATIVE=OFF \
    -DGGML_AVX=OFF \
    -DGGML_AVX2=OFF \
    -DGGML_FMA=OFF \
    -DGGML_F16C=OFF \
    -DGGML_AVX512=OFF \
    -DGGML_AVX512_VBMI=OFF \
    -DGGML_AVX512_VNNI=OFF \
    -DGGML_AVX512_BF16=OFF \
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
# Copy the entire build/bin output, not just the executables: recent
# llama.cpp splits llama-server into a thin binary plus shared libs
# (libllama-server-impl.so, libllama.so, libggml*.so, libmtmd.so, ...)
# that CMake puts in the same bin/ directory and links via $ORIGIN rpath.
# Copying only the named executables left those .so files behind and
# caused "error while loading shared libraries" at startup.
COPY --from=builder /src/build/bin/ /app/
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh /app/llama-server /app/llama-cli /app/llama-quantize /app/llama-bench
# Belt-and-braces in case rpath resolution doesn't cover every lib on
# this base image -- harmless if $ORIGIN rpath already handles it.
ENV LD_LIBRARY_PATH=/app

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
