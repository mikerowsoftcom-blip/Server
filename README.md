# llama.cpp on Render — CPU-optimized, sized for fast responses

## The honest constraint first

Render's standard/pro compute plans are **CPU-only** — there's no NVIDIA GPU
tier. So "astronomically optimized" for this stack means squeezing the most
out of CPU inference: native vectorized builds, BLAS-accelerated prefill,
threads pinned to the container's real quota, continuous batching. That's
what this Dockerfile does.

What it can't do is make a large model fast on a CPU. Token generation
speed is dominated by **model size** far more than by build flags. The
build gets you maybe a 1.5–3x speedup over an unoptimized build; picking a
smaller quantized model gets you a 5–20x speedup. So the lever that
actually guarantees "under a minute" is `MODEL_URL` + `N_PREDICT_DEFAULT`,
not the compiler flags.

## Realistic throughput (Render "Pro" plan, 4 vCPU, AVX2 host)

These are ballpark figures for Q4_K_M quantization, typical of what
llama.cpp reports on comparable CPUs — actual numbers vary by Render's
underlying hardware at deploy time:

| Model size | ~tok/s (decode) | 512-token reply |
|---|---|---|
| 1B (e.g. Llama-3.2-1B) | 40–80 tok/s | ~7–13s |
| 3B (e.g. Llama-3.2-3B) | 15–30 tok/s | ~17–35s |
| 7–8B (e.g. Llama-3.1-8B) | 6–14 tok/s | ~40–90s |
| 13B+ | 3–7 tok/s | often over a minute |

**To reliably stay under a minute, use a 1B–3B instruct model** (the
default in this repo is Llama-3.2-3B-Instruct Q4_K_M) and cap
`N_PREDICT_DEFAULT` — a 512-token ceiling is already a generous reply
length for most use cases. If you need an 8B+ model's quality, either:
- accept slower responses and stream the output instead of waiting for
  the full completion, or
- move to a GPU-backed provider for that specific workload.

## What's actually optimized in the build

- `GGML_NATIVE` — **off**, and **AVX/AVX2/FMA/F16C are off too**. First
  attempt used `-march=native`, which SIGILL'd (exit 132) because the
  build node's ISA didn't match the serving node's. Second attempt
  targeted AVX2/FMA/F16C explicitly — still SIGILL'd, meaning the actual
  runtime node doesn't have AVX2 either. This build now targets the
  plain x86-64 baseline (SSE2 only, no AVX family), which is guaranteed
  to run on literally any x86-64 node regardless of generation. It's
  slower than a matched native build. `entrypoint.sh` logs the real
  `/proc/cpuinfo` model and flags on every boot — once you can see the
  actual instance's flags in the logs, bump the CMake flags back up
  (AVX2/FMA/F16C if present, possibly AVX-512 subsets on larger plans)
  and rebuild to reclaim that throughput. Don't re-guess; read the log.
- `GGML_OPENBLAS=ON` — BLAS-accelerated matmul, which mainly speeds up
  prompt/prefill processing (long system prompts, RAG context).
- `GGML_LTO` — **off**. It was on originally, but `llama-server` now bundles
  `tools/mtmd` (multimodal support), which includes large template-heavy
  files like `siglip.cpp`. Compiling those with LTO under real parallelism
  is memory-hungry enough to OOM-kill Render's build container. The
  runtime win from LTO here is small next to that risk, so it's disabled.
  Build parallelism is capped via `BUILD_JOBS` (default 4) rather than
  `nproc`, since the limiting resource during build is RAM, not cores — if
  you still see an OOM on `siglip.cpp` or similar on a smaller build plan,
  pass `--build-arg BUILD_JOBS=2` or `1`.
- Multi-stage build — the runtime image ships only the compiled binaries
  and shared libs, not the toolchain, so cold starts and deploys are fast.
- `--threads` / `--threads-batch` pinned via cgroup CPU quota detection
  (not `nproc`, which can misreport inside a container) — avoids
  oversubscribing and thrashing.
- `--cont-batching` — keeps throughput up if more than one request lands
  concurrently.
- `--mlock` — best-effort page-locking so the model isn't swapped out.
- mmap left **on** (default) — lets the OS lazily page in the model file
  and share pages across worker restarts; faster boot, no runtime cost.
- Model is downloaded once into a **persistent Render Disk** (`render.yaml`)
  so redeploys don't re-download it and cold starts aren't dominated by a
  multi-GB fetch.

## Files

- `Dockerfile` — multi-stage build (compiler toolchain stage → slim runtime).
- `entrypoint.sh` — fetches/caches the GGUF model, detects real CPU quota,
  launches `llama-server`.
- `render.yaml` — Render Blueprint: Docker runtime, persistent disk for the
  model cache, env vars for model URL and inference params.

## Deploying

1. Push this directory to a repo Render can see.
2. In Render: New → Blueprint → point at the repo → it reads `render.yaml`.
3. Adjust `plan:` in `render.yaml` up if you need more vCPUs (throughput
   scales close to linearly with core count for this workload up to
   4–8 cores, then falls off due to memory-bandwidth limits).
4. Swap `MODEL_URL` / `MODEL_FILE` for whatever GGUF you want to serve.

## Calling it

```bash
curl -X POST https://<your-service>.onrender.com/completion \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Explain quantum tunnelling in two sentences.", "n_predict": 200}'
```

Or use the OpenAI-compatible endpoint at `/v1/chat/completions`, which
`llama-server` also exposes.

## If you truly need big-model quality *and* sub-minute latency

CPU optimization has a ceiling. At that point the actual fix is one of:
- a much smaller/distilled model,
- speculative decoding with a small draft model (llama.cpp supports this
  via `--model-draft`, worth exploring once base latency is measured),
- or moving the inference workload off Render to GPU compute — Render
  itself doesn't offer GPU instances, so that would mean a different host
  for the model server while Render still serves the rest of your app.
