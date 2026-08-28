# llama.cpp on Render

A minimal Render-ready Docker container for the llama.cpp HTTP server.

## Deploy

1. Put these files in a GitHub repository.
2. In Render, create a **New Web Service** from the repository.
3. Select **Docker**.
4. Deploy.
5. Mount a Render Persistent Disk at `/models`.
6. Put your GGUF model at:

```text
/models/model.gguf
```

The container listens on Render's `$PORT` and binds to `0.0.0.0`.

## Environment variables

- `MODEL_PATH` — default: `/models/model.gguf`
- `CTX_SIZE` — default: `4096`
- `N_PREDICT` — default: `512`

## API

llama.cpp exposes an OpenAI-compatible API, including:

```text
POST /v1/chat/completions
```

Health check:

```text
GET /health
```

## Notes

For larger GGUF models, choose a Render instance with enough RAM. CPU inference may be slow for large models.

For GPU deployment, the Render service type/plan and llama.cpp build need to match the GPU configuration you choose.
