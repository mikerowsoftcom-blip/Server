import os
import signal
import subprocess
import sys
from pathlib import Path

PORT = os.environ.get("PORT", "10000")
LLAMA = "/opt/llama/llama-server"
MODEL = "/models/qwen2.5-0.5b-instruct-q3_k_m.gguf"

cmd = [
    LLAMA,
    "-m", MODEL,
    "--host", "127.0.0.1",
    "--port", "8080",
    "-c", "1024",
    "-n", "128",
    "-t", "1",
    "-tb", "1",
    "-b", "32",
    "-ub", "32",
    "-np", "1",
    "--cont-batching",
    "--no-webui",
    "--metrics",
]

print("Starting:", " ".join(cmd), flush=True)

# Do not pipe stdout/stderr through Python. Render already captures the
# container's stdout/stderr, and inheriting the descriptors avoids the
# Errno 9 / Bad file descriptor failure seen on Render.
proc = subprocess.Popen(
    cmd,
    stdin=subprocess.DEVNULL,
    stdout=sys.stdout,
    stderr=sys.stderr,
    close_fds=False,
)

def stop(signum, frame):
    try:
        proc.terminate()
    except Exception:
        pass

signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)

rc = proc.wait()
print(f"llama-server exited with code {rc}", flush=True)
raise SystemExit(rc)
