import os
import time
import requests
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, StreamingResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

PORT = int(os.environ.get("PORT", "10000"))
UPSTREAM = "http://127.0.0.1:8080"

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def root():
    return FileResponse("/app/index.html")

@app.get("/health")
def health():
    try:
        r = requests.get(UPSTREAM + "/health", timeout=2)
        return JSONResponse(status_code=r.status_code, content=r.json())
    except Exception as e:
        return {"status": "starting", "llama_server": False, "error": str(e)}

@app.api_route("/v1/{path:path}", methods=["GET","POST","OPTIONS"])
async def v1(path: str, request: Request):
    body = await request.body()
    headers = {k:v for k,v in request.headers.items() if k.lower() not in ("host","content-length")}
    try:
        r = requests.request(
            request.method,
            UPSTREAM + "/v1/" + path,
            data=body,
            headers=headers,
            stream=True,
            timeout=600,
        )
    except Exception as e:
        return JSONResponse(status_code=503, content={"error": str(e)})

    def stream():
        for chunk in r.iter_content(chunk_size=1024):
            if chunk:
                yield chunk
        r.close()

    return StreamingResponse(
        stream(),
        status_code=r.status_code,
        media_type=r.headers.get("content-type", "application/json"),
    )

@app.post("/generate")
async def generate(request: Request):
    body = await request.body()
    try:
        r = requests.post(UPSTREAM + "/v1/chat/completions", data=body, headers={"Content-Type":"application/json"}, timeout=600)
        return JSONResponse(status_code=r.status_code, content=r.json())
    except Exception as e:
        return JSONResponse(status_code=503, content={"error": str(e)})

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=PORT)
