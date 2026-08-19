# Qwen 0.5B + standalone llama.cpp (Render Free)

This revision fixes the Render `OSError: [Errno 9] Bad file descriptor` startup failure.

The previous launcher passed Render's stdout/stderr through `subprocess.Popen`.
This version lets llama-server inherit the container stdout/stderr directly.

It also uses a small Q3_K_M GGUF and constrained llama.cpp settings:
- context 1024
- max 128 output tokens
- 1 CPU thread
- batch 32
- ubatch 32
- 1 parallel slot

Deploy as a Docker Web Service.

IMPORTANT: the Dockerfile uses a prebuilt llama.cpp release and downloads the GGUF during the image build, so llama-cpp-python is never compiled.
