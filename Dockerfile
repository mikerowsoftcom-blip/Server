FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install only prebuilt Python wheels. In particular, llama-cpp-python is
# pulled from its official CPU wheel index and is forbidden from source build.
COPY requirements.txt .
RUN python -m pip install --no-cache-dir --upgrade pip && \
    python -m pip install --no-cache-dir -r requirements.txt && \
    python -m pip install --no-cache-dir \
      --only-binary=llama-cpp-python \
      --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cpu \
      "llama-cpp-python==0.3.34"

# Download the small Qwen 2.5 0.5B Q4_K_M model into the image so cold starts
# do not have to download it again.
RUN mkdir -p /app/models && \
    curl -L --fail --retry 3 -o /app/models/model.gguf \
    "https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf"

COPY app.py .
COPY index.html .

ENV MODEL_PATH=/app/models/model.gguf
ENV N_CTX=256
ENV N_THREADS=1
ENV N_BATCH=32
ENV PYTHONUNBUFFERED=1

EXPOSE 10000

CMD ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port ${PORT:-10000}"]
