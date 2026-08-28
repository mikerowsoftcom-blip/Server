# YouTube Downloader — Docker + Render

A small Flask/yt-dlp web application intended for videos the user owns or is
authorized to download.

## Local Docker

```bash
docker build -t youtube-downloader .
docker run --rm -p 10000:10000 youtube-downloader
```

Open http://localhost:10000

## Render

1. Put these files in a GitHub repository.
2. In Render, choose **New → Web Service**.
3. Connect the repository.
4. Set **Language/Runtime: Docker**.
5. Render will build the Dockerfile.
6. Deploy.

The included `render.yaml` can also be used as a Blueprint.

The application listens on `0.0.0.0` and the `PORT` environment variable, as
required by Render web services.

## Notes

- FFmpeg is included in the image so yt-dlp can merge separate video/audio
  streams.
- Downloads are temporary and streamed back to the browser.
- Render web-service filesystems are not intended as permanent storage.
- Long-running or very large downloads may require a paid instance or a
  different architecture.
