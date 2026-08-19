import os
import json
import threading
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, StreamingResponse
from pydantic import BaseModel

MODEL_DIR = Path(os.environ.get("MODEL_DIR", "/tmp/qwen-model"))
MODEL_REPO = os.environ.get(
    "MODEL_REPO",
    "xiaoyao9184/Qwen2.5-0.5B-Instruct-onnx-genai"
)
MODEL_SUBDIR = os.environ.get(
    "MODEL_SUBDIR",
    "cpu_and_mobile/cpu-int4-rtn-block-32"
)
MAX_NEW_TOKENS = int(os.environ.get("MAX_NEW_TOKENS", "160"))
MAX_HISTORY = int(os.environ.get("MAX_HISTORY", "8"))

app = FastAPI(title="Qwen 0.5B ONNX API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

engine = None
tokenizer = None
model_lock = threading.Lock()


class ChatRequest(BaseModel):
    messages: list
    max_tokens: int = MAX_NEW_TOKENS
    temperature: float = 0.7


def ensure_model():
    global engine, tokenizer
    if engine is not None:
        return

    import onnxruntime_genai as og
    from huggingface_hub import snapshot_download

    MODEL_DIR.mkdir(parents=True, exist_ok=True)

    # Download only the prebuilt CPU INT4 ONNX package.
    snapshot_download(
        repo_id=MODEL_REPO,
        allow_patterns=[
            f"{MODEL_SUBDIR}/**"
        ],
        local_dir=str(MODEL_DIR),
    )

    model_path = MODEL_DIR / MODEL_SUBDIR
    engine = og.Model(str(model_path))
    tokenizer = og.Tokenizer(engine)


@app.on_event("startup")
def startup():
    # Load after the web server starts; /health remains available while
    # the model is downloading/loading.
    try:
        ensure_model()
    except Exception as e:
        print("MODEL LOAD ERROR:", repr(e), flush=True)


@app.get("/")
def root():
    return HTMLResponse(open("/app/index.html", encoding="utf-8").read())


@app.get("/health")
def health():
    return {
        "status": "ok",
        "model_loaded": engine is not None,
        "runtime": "onnxruntime-genai",
        "model": MODEL_REPO,
    }


def generate_text(messages, max_tokens, temperature):
    import onnxruntime_genai as og

    # Keep the prompt bounded on the tiny free CPU instance.
    messages = messages[-MAX_HISTORY:]

    prompt = tokenizer.apply_chat_template(
        messages,
        add_generation_prompt=True,
    )

    params = og.GeneratorParams(engine)
    params.set_search_options(
        max_length=max_tokens,
        temperature=max(0.1, float(temperature)),
        top_p=0.8,
        top_k=1,
        repetition_penalty=1.1,
    )

    generator = og.Generator(engine, params)
    generator.append_tokens(tokenizer.encode(prompt))

    while not generator.is_done():
        generator.generate_next_token()
        seq = generator.get_sequence(0)
        text = tokenizer.decode(seq)
        yield text

    del generator


@app.post("/generate")
def generate(req: ChatRequest):
    ensure_model()
    msgs = req.messages[-MAX_HISTORY:]
    chunks = list(generate_text(msgs, min(req.max_tokens, MAX_NEW_TOKENS), req.temperature))
    return {"response": chunks[-1] if chunks else ""}


@app.post("/v1/chat/completions")
def chat(req: ChatRequest):
    ensure_model()

    def stream():
        # ORT GenAI's Python API exposes the generated sequence rather than
        # an OpenAI-native token iterator, so we stream the newly decoded
        # suffix as generation progresses.
        import onnxruntime_genai as og

        messages = req.messages[-MAX_HISTORY:]
        prompt = tokenizer.apply_chat_template(
            messages, add_generation_prompt=True
        )
        params = og.GeneratorParams(engine)
        params.set_search_options(
            max_length=min(req.max_tokens, MAX_NEW_TOKENS),
            temperature=max(0.1, float(req.temperature)),
            top_p=0.8,
            top_k=1,
            repetition_penalty=1.1,
        )
        generator = og.Generator(engine, params)
        generator.append_tokens(tokenizer.encode(prompt))

        previous = ""
        while not generator.is_done():
            generator.generate_next_token()
            text = tokenizer.decode(generator.get_sequence(0))
            # Only send the newly generated suffix.
            if text.startswith(previous):
                delta = text[len(previous):]
            else:
                delta = text
            previous = text
            if delta:
                payload = {
                    "choices": [{
                        "delta": {"content": delta},
                        "index": 0,
                    }]
                }
                yield f"data: {json.dumps(payload)}\n\n"

        yield "data: [DONE]\n\n"
        del generator

    with model_lock:
        return StreamingResponse(
            stream(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )
