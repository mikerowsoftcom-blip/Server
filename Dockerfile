FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY start.py .
COPY proxy.py .
COPY index.html .

RUN mkdir -p /opt/llama /models

# The Dockerfile downloads a prebuilt llama.cpp Linux x64 archive.
# The archive is unpacked into /opt/llama.
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates tar && \
    curl -L --fail --retry 3 \
      -o /tmp/llama.tar.gz \
      https://github.com/ggml-org/llama.cpp/releases/latest/download/llama-b8120-bin-ubuntu-x64.tar.gz && \
    tar -xzf /tmp/llama.tar.gz -C /opt/llama --strip-components=1 && \
    test -x /opt/llama/llama-server && \
    rm -rf /var/lib/apt/lists/* /tmp/llama.tar.gz

# Download the small Q3_K_M GGUF during image build so startup does not
# spend time downloading the model and the model is not counted as a
# runtime download.
RUN curl -L --fail --retry 3 \
      -o /models/qwen2.5-0.5b-instruct-q3_k_m.gguf \
      https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q3_k_m.gguf

ENV PORT=10000

CMD ["sh", "-c", "python start.py & python proxy.py"]
