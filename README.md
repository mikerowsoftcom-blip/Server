# YouTube Downloader — Docker + Render

A small Flask/yt-dlp web application intended for videos the user owns or is authorized to download.

## Render YouTube authentication

YouTube can require yt-dlp to authenticate. A Render container does not have your phone/PC browser profile, so `--cookies-from-browser` cannot be used there. yt-dlp supports supplying a Netscape/Mozilla `cookies.txt` file with `--cookies`.

### Recommended setup on Render

Use a **Render Secret File**. This avoids putting the cookie contents in GitHub or encoding a large cookie file into an environment variable.

1. Export a **fresh YouTube cookies.txt** from a browser session you are authorized to use. For YouTube, yt-dlp recommends exporting cookies in a way that avoids cookie rotation, such as a private/incognito session that is closed after exporting.
2. Do **not** commit the cookies file to GitHub.
3. In Render, open your service → **Environment** → **Secret Files** → **Add Secret File**.
4. Set the filename to:

   `youtube-cookies.txt`

5. Paste the complete Netscape/Mozilla `cookies.txt` contents into the Secret File and save it. Render makes service secret files available at `/etc/secrets/<filename>` at runtime.
6. Redeploy the service. The application automatically checks `/etc/secrets/youtube-cookies.txt`. You can also set `YOUTUBE_COOKIES_FILE` if you use a different secret-file path.
7. If YouTube still rejects the cookies, set `YOUTUBE_USER_AGENT` to the current full User-Agent of the browser used for the cookie export.

The application never sends the cookie contents to the browser and `/api/auth-status` only reports whether authentication is configured.

### Security

Treat YouTube cookies like a password/session credential. Anyone who obtains them may be able to access the associated account. Use an account/session appropriate for this downloader, never commit the cookie file or secret to GitHub, and replace/revoke the session if the secret is exposed.

### Alternative environment-variable setup

The application also supports `YOUTUBE_COOKIES_B64` for deployments where a secret file is not available. Base64-encode a Netscape/Mozilla `cookies.txt` file and put the result in that secret variable. The Render Secret File method above is preferred.

## Local Docker

```bash
docker build -t youtube-downloader .
docker run --rm -p 10000:10000 youtube-downloader
```

Open `http://localhost:10000`.

## Render

1. Put these files in a GitHub repository.
2. In Render, choose **New → Web Service**.
3. Connect the repository.
4. Set **Language/Runtime: Docker**.
5. Add the `YOUTUBE_COOKIES_B64` secret environment variable.
6. Optionally add `YOUTUBE_USER_AGENT`.
7. Deploy/redeploy.

FFmpeg is included in the Docker image so yt-dlp can merge separate video/audio streams. Downloads are temporary and streamed back to the requester.
