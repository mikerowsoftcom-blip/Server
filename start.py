import os, subprocess, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.request import Request, urlopen

PORT=int(os.environ.get("PORT","10000"))
LLAMA_PORT=8080
MODEL="/models/"+os.environ.get("MODEL_FILE","qwen2.5-0.5b-instruct-q3_k_m.gguf")

# Extremely conservative settings for Render Free's 512 MB RAM / 0.1 CPU.
# One request at a time avoids multiple KV caches consuming memory.
cmd=[
    "/opt/llama/llama-server",
    "-m", MODEL,
    "--host","127.0.0.1",
    "--port",str(LLAMA_PORT),
    "-c",os.environ.get("CTX","1024"),
    "-n",os.environ.get("MAX_TOKENS","128"),
    "-t",os.environ.get("THREADS","1"),
    "-tb",os.environ.get("THREADS_BATCH","1"),
    "-b",os.environ.get("BATCH","32"),
    "-ub",os.environ.get("UBATCH","32"),
    "-np","1",
    "--cont-batching",
    "--no-webui",
    "--metrics",
]

print("Starting:", " ".join(cmd), flush=True)
proc=subprocess.Popen(cmd, stdout=subprocess.STDOUT, stderr=subprocess.STDOUT, text=True)

def log():
    for line in proc.stdout:
        print("[llama] "+line.rstrip(), flush=True)
threading.Thread(target=log,daemon=True).start()

# Wait briefly for llama-server to bind, without making Render wait forever.
for _ in range(180):
    if proc.poll() is not None:
        raise SystemExit(proc.returncode or 1)
    try:
        urlopen("http://127.0.0.1:8080/health",timeout=1)
        break
    except Exception:
        time.sleep(1)

class Handler(BaseHTTPRequestHandler):
    def _send(self, code, ctype, body):
        self.send_response(code)
        self.send_header("Content-Type",ctype)
        self.send_header("Content-Length",str(len(body)))
        self.send_header("Access-Control-Allow-Origin","*")
        self.send_header("Access-Control-Allow-Headers","Content-Type, Authorization")
        self.send_header("Access-Control-Allow-Methods","GET, POST, OPTIONS")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self._send(204,"text/plain",b"")

    def do_GET(self):
        if self.path == "/" or self.path == "/index.html":
            body=open("/app/index.html","rb").read()
            self._send(200,"text/html; charset=utf-8",body)
            return
        if self.path == "/health":
            try:
                data=urlopen("http://127.0.0.1:8080/health",timeout=2).read()
                self._send(200,"application/json",data)
            except Exception as e:
                self._send(503,"application/json",b'{"status":"loading"}')
            return
        self._proxy()

    def do_POST(self):
        self._proxy()

    def _proxy(self):
        # Proxy /v1/* and /generate to the local llama-server.
        if not (self.path.startswith("/v1/") or self.path.startswith("/generate")):
            self._send(404,"text/plain",b"Not found")
            return
        n=int(self.headers.get("Content-Length","0"))
        body=self.rfile.read(n)
        headers={"Content-Type":self.headers.get("Content-Type","application/json")}
        if self.headers.get("Authorization"):
            headers["Authorization"]=self.headers["Authorization"]
        try:
            req=Request("http://127.0.0.1:8080"+self.path,data=body,headers=headers,method=self.command)
            with urlopen(req,timeout=600) as r:
                self.send_response(r.status)
                for k,v in r.headers.items():
                    if k.lower() in ("content-length","transfer-encoding","connection"):
                        continue
                    self.send_header(k,v)
                self.send_header("Access-Control-Allow-Origin","*")
                self.end_headers()
                while True:
                    chunk=r.read(8192)
                    if not chunk: break
                    self.wfile.write(chunk)
                    self.wfile.flush()
        except Exception as e:
            self._send(502,"application/json",b'{"error":"upstream unavailable"}')

    def log_message(self, fmt, *args):
        print("[http] "+(fmt%args),flush=True)

ThreadingHTTPServer(("0.0.0.0",PORT),Handler).serve_forever()
