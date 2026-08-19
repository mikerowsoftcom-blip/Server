FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential cmake curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Safe x86 baseline. SSE4.2 is enabled, while AVX/AVX2/AVX512 are left off
# because this Render service previously hit illegal-instruction crashes.
RUN CMAKE_ARGS="-DGGML_NATIVE=OFF -DGGML_SSE42=ON -DGGML_AVX=OFF -DGGML_AVX2=OFF -DGGML_AVX512=OFF -DGGML_FMA=OFF -DGGML_F16C=OFF -DGGML_BLAS=OFF" \
    pip install --no-cache-dir --force-reinstall --no-binary llama-cpp-python "llama-cpp-python==0.3.34"

RUN mkdir -p /app/models && \
    curl -L --fail --retry 3 -o /app/models/model.gguf \
    "https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf"

COPY app.py index.html .

ENV MODEL_PATH=/app/models/model.gguf
ENV N_CTX=256
ENV N_THREADS=1
ENV N_BATCH=32

EXPOSE 10000
CMD ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port ${PORT:-10000}"]
