FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive \
    PORT=10000 \
    MODEL_FILE=qwen2.5-0.5b-instruct-q3_k_m.gguf \
    MODEL_URL=https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q3_k_m.gguf \
    LLAMA_TAG=b10218

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Download the official prebuilt Ubuntu x64 CPU llama.cpp binary.
# This avoids compiling llama-cpp-python on Render.
RUN curl -L --fail --retry 3 \
    "https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_TAG}/llama-${LLAMA_TAG}-bin-ubuntu-x64.tar.gz" \
    -o /tmp/llama.tar.gz \
    && mkdir -p /opt/llama \
    && tar -xzf /tmp/llama.tar.gz -C /opt/llama --strip-components=1 \
    && rm /tmp/llama.tar.gz \
    && test -x /opt/llama/llama-server

COPY index.html /app/index.html
COPY start.py /app/start.py

RUN mkdir -p /models \
    && curl -L --fail --retry 3 \
      "$MODEL_URL" \
      -o "/models/$MODEL_FILE"

EXPOSE 10000

CMD ["python3", "/app/start.py"]
