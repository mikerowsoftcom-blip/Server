# syntax=docker/dockerfile:1

##############################
# Stage 1: build llama.cpp
##############################
FROM ubuntu:22.04 AS build

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    cmake \
    git \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Shallow clone keeps the image build fast. Pin a tag/commit here if you want
# fully reproducible builds instead of always tracking the latest master.
RUN git clone --depth 1 https://github.com/ggml-org/llama.cpp.git

WORKDIR /app/llama.cpp

# CPU-only, statically-linked build (Render web services don't have GPUs).
# BUILD_SHARED_LIBS=OFF avoids a separate libllama-server-impl.so that has to
# be copied and found at runtime - a static llama-server binary is simpler
# and more reliable to deploy. LLAMA_CURL is OFF since we bake the model into
# the image instead of fetching it at runtime.
#
# NOTE: llama-server bundles multimodal (mtmd) support, which compiles in
# parsers for many model architectures (this is why the build log lists so
# many "models/*.cpp" files) - that's just format-recognition code baked
# into one binary, not multiple models being loaded. We still only load the
# single model.gguf file below. Render's build machines have a fixed RAM
# budget regardless of core count, so -j"$(nproc)" (one job per core) can
# OOM there ("Ran out of memory ... while building"). Capping parallelism
# keeps peak memory down at the cost of a slower build.
RUN cmake -B build \
    -DCMAKE_BUILD_TYPE=Release \
    -DGGML_NATIVE=OFF \
    -DBUILD_SHARED_LIBS=OFF \
    -DLLAMA_CURL=OFF \
    -DLLAMA_BUILD_EXAMPLES=OFF \
    -DLLAMA_BUILD_TESTS=OFF \
    && cmake --build build --config Release -j2 --target llama-server

##############################
# Stage 2: runtime image
##############################
FROM ubuntu:22.04

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=build /app/llama.cpp/build/bin/llama-server /app/llama-server

# --- Model ---
# Qwen2.5-0.5B-Instruct, quantized to Q4_K_M (~380MB). Small enough to run
# comfortably on Render's cheapest plans with fast responses on CPU.
# Swap this URL for any other GGUF model if you want something larger/smarter
# (just make sure it fits in your Render plan's RAM).
ARG MODEL_URL="https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf"
RUN mkdir -p /app/models && \
    curl -L --fail --retry 3 -o /app/models/model.gguf "${MODEL_URL}"

COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh /app/llama-server

# Render injects $PORT at runtime; this EXPOSE is just documentation/local-run convenience.
EXPOSE 10000

CMD ["/app/start.sh"]
