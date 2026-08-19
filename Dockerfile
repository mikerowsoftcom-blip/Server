FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HF_HOME=/tmp/huggingface \
    OMP_NUM_THREADS=1 \
    ORT_NUM_THREADS=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .
COPY index.html .

ENV PORT=10000
CMD ["sh","-c","uvicorn app:app --host 0.0.0.0 --port ${PORT:-10000}"]
