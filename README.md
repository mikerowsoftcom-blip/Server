# llama.cpp on Render Free

This version is designed for Render's Free web service.

It does NOT require a Render Persistent Disk.

## Model

Default model:

tensorblock/SmolLM2-135M-Instruct-GGUF:Q4_K_M

The GGUF is about 105 MB. llama.cpp downloads it automatically from Hugging Face on startup.

## Deploy

1. Upload this repository to GitHub.
2. In Render, create a new Web Service from the repository.
3. Choose Docker.
4. Select the Free plan.
5. Deploy.

No Persistent Disk is required.

## Important Free-plan behavior

Render Free services have an ephemeral filesystem. If the service restarts, redeploys, or spins down after inactivity, the downloaded model is lost and will be downloaded again on the next startup.

Render Free services have 512 MB RAM, so this package intentionally uses a very small 135M-parameter model and a 512-token context.

## API

Health:

GET /health

OpenAI-compatible chat endpoint:

POST /v1/chat/completions

Example request:

{
  "model": "tensorblock/SmolLM2-135M-Instruct-GGUF:Q4_K_M",
  "messages": [
    {
      "role": "user",
      "content": "Hello!"
    }
  ],
  "max_tokens": 100
}

## Changing the model

Do not switch to a multi-gigabyte model on the Free plan. Larger models need substantially more RAM.

You can change HF_MODEL to another small GGUF repository if it fits within the available RAM.

For a stronger model such as Qwen3 4B, use a paid Render compute plan with more RAM. A Persistent Disk is still useful to avoid downloading the model after restarts.
