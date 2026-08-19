import json
import os
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from llama_cpp import Llama

MODEL_PATH = os.environ.get("MODEL_PATH", "/app/models/model.gguf")
N_CTX = int(os.environ.get("N_CTX", "256"))
N_THREADS = int(os.environ.get("N_THREADS", "1"))
N_BATCH = int(os.environ.get("N_BATCH", "32"))
llm = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global llm
    llm = Llama(model_path=MODEL_PATH, n_ctx=N_CTX, n_threads=N_THREADS,
                n_threads_batch=N_THREADS, n_batch=N_BATCH,
                use_mlock=False, verbose=False)
    yield
    llm = None

app = FastAPI(lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

class ChatMessage(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    max_tokens: int = Field(default=128, ge=1, le=256)
    temperature: float = Field(default=0.7, ge=0.0, le=2.0)
    stream: bool = False

class GenerateRequest(BaseModel):
    prompt: str
    max_tokens: int = Field(default=128, ge=1, le=256)
    temperature: float = Field(default=0.7, ge=0.0, le=2.0)

@app.get("/")
def root():
    return {"status": "ok", "message": "Qwen 0.5B llama.cpp API"}

@app.get("/health")
def health():
    return {"status": "ok", "model_loaded": llm is not None,
            "context": N_CTX, "threads": N_THREADS}

@app.post("/generate")
def generate(req: GenerateRequest):
    if llm is None:
        raise HTTPException(503, "Model not loaded yet")
    start = time.time()
    out = llm(req.prompt, max_tokens=req.max_tokens,
              temperature=req.temperature, stop=["</s>"])
    return {"text": out["choices"][0]["text"],
            "seconds": round(time.time() - start, 2)}

@app.post("/v1/chat/completions")
def chat_completions(req: ChatRequest):
    if llm is None:
        raise HTTPException(503, "Model not loaded yet")
    messages = [m.model_dump() for m in req.messages]
    if not req.stream:
        return llm.create_chat_completion(messages=messages,
            max_tokens=req.max_tokens, temperature=req.temperature)

    def event_stream():
        try:
            stream = llm.create_chat_completion(messages=messages,
                max_tokens=req.max_tokens, temperature=req.temperature, stream=True)
            for chunk in stream:
                yield f"data: {json.dumps(chunk, separators=(',', ':'))}\n\n"
            yield "data: [DONE]\n\n"
        except Exception as exc:
            yield f"data: {json.dumps({'error': {'message': str(exc), 'type': 'server_error'}})}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive",
                 "X-Accel-Buffering": "no"})
