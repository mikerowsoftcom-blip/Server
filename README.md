# llama.cpp on Render

Builds `llama.cpp` from source, bakes in a small quantized model (Qwen2.5-0.5B-Instruct,
Q4_K_M, ~380MB), and serves it via `llama-server`'s OpenAI-compatible HTTP API. Includes a
static `index.html` you can host anywhere (GitHub Pages, Render static site, etc.) to chat
with it.

## Files

- `Dockerfile` — multi-stage build: compiles `llama-server` from the llama.cpp repo, then
  copies the binary + model into a slim runtime image.
- `start.sh` — entrypoint; binds to Render's `$PORT` env var.
- `render.yaml` — optional Render "Blueprint" so Render auto-configures the service from
  this repo (Dashboard → New → Blueprint).
- `index.html` — static chat UI, calls the deployed server directly from the browser.

## Deploy to Render

1. Push this directory to a new GitHub repo.
2. In the Render dashboard: **New → Web Service**, connect the repo, and select
   **Docker** as the environment (Render auto-detects the `Dockerfile`). Or use
   **New → Blueprint** to pick up `render.yaml` automatically.
3. Pick a plan with enough RAM. This model only needs a few hundred MB, but the **free
   plan (512MB) is too tight once you add the OS + server overhead** — use at least the
   **Starter** plan (2GB). Free-plan services also spin down when idle, so the first
   request after inactivity will be slow (cold start + model load).
4. (Optional) Set an environment variable `LLAMA_API_KEY` in the Render dashboard if you
   want to require a bearer token for requests — the server will require
   `Authorization: Bearer <key>` on every request when this is set.
5. Deploy. The first build takes a while (compiling llama.cpp + downloading the model
   layer), but subsequent deploys are cached unless you change the Dockerfile.
6. Once live, your API is at `https://<your-service>.onrender.com`, with an
   OpenAI-compatible endpoint at `POST /v1/chat/completions`.

## Using a different model

Swap the `MODEL_URL` build arg in the `Dockerfile` for any GGUF file (e.g. from
Hugging Face). Keep an eye on:
- **File size** — this determines image size and cold-start time.
- **RAM** — a rule of thumb is you need roughly the file's size in RAM, plus some
  overhead for context/KV cache. Match it to your Render plan.

Larger/smarter options that still run reasonably on CPU: Qwen2.5-1.5B-Instruct-GGUF,
Llama-3.2-1B-Instruct-GGUF, Phi-3.5-mini-instruct-GGUF (larger, needs more RAM).

## Testing locally

```bash
docker build -t llama-render .
docker run -p 10000:10000 -e PORT=10000 llama-render
curl http://localhost:10000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Say hi in five words."}]}'
```

## Using index.html

Open `index.html` in a browser (or host it as a static site — GitHub Pages works fine
since it's a single self-contained file), enter your Render service URL
(`https://<your-service>.onrender.com`, no trailing slash), and start chatting. If you
set `LLAMA_API_KEY`, also fill in the API key field — it's sent as an
`Authorization: Bearer` header.

`llama-server` sends permissive CORS headers by default, so calling it directly from a
static site on a different origin works out of the box. If you ever see CORS errors in
the browser console, check your llama.cpp version — very old builds may need a
`--cors` style flag or a small reverse proxy in front.

## Notes on Render specifics

- Render injects `$PORT` at runtime — `start.sh` reads it, don't hardcode a port.
- Render web services need to bind to `0.0.0.0`, not `127.0.0.1` — already handled in
  `start.sh`.
- The `/health` path used in `render.yaml`'s health check is provided by `llama-server`
  out of the box.
