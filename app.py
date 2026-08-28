import base64
import os
import re
import tempfile
from pathlib import Path

from flask import Flask, jsonify, render_template, request, send_file
import yt_dlp

app = Flask(__name__)

YOUTUBE_RE = re.compile(
    r"^https?://([a-z0-9-]+\.)?(youtube\.com|youtu\.be)(/|$)",
    re.I,
)


# ---------------------------------------------------------------------------
# YouTube authentication
# ---------------------------------------------------------------------------
# Render cannot use --cookies-from-browser because there is no browser profile
# inside the container. Instead, provide a Netscape-format cookies.txt file
# through a Render Secret Environment Variable (YOUTUBE_COOKIES_B64) or point
# YOUTUBE_COOKIES_FILE at a mounted secret file.
#
# Never put the cookie contents in GitHub or hard-code them in this file.

_COOKIE_FILE = None


def get_cookie_file() -> str | None:
    """Return a local cookies.txt path, creating it from a secret if needed."""
    global _COOKIE_FILE

    configured_file = os.environ.get("YOUTUBE_COOKIES_FILE", "").strip()
    if not configured_file:
        default_secret = Path("/etc/secrets/youtube-cookies.txt")
        if default_secret.is_file():
            configured_file = str(default_secret)

    if configured_file:
        path = Path(configured_file)
        if path.is_file():
            return str(path)

    if _COOKIE_FILE and Path(_COOKIE_FILE).is_file():
        return _COOKIE_FILE

    encoded = os.environ.get("YOUTUBE_COOKIES_B64", "").strip()
    plain = os.environ.get("YOUTUBE_COOKIES", "")

    if not encoded and not plain:
        return None

    try:
        if encoded:
            cookie_text = base64.b64decode(encoded).decode("utf-8")
        else:
            cookie_text = plain
    except Exception as exc:
        raise RuntimeError("YOUTUBE_COOKIES_B64 is not valid base64.") from exc

    if not cookie_text.startswith(("# HTTP Cookie File", "# Netscape HTTP Cookie File")):
        raise RuntimeError(
            "The YouTube cookies secret must be a Netscape/Mozilla cookies.txt file."
        )

    cookie_path = Path(tempfile.gettempdir()) / "youtube-cookies.txt"
    cookie_path.write_text(cookie_text, encoding="utf-8")
    _COOKIE_FILE = str(cookie_path)
    return _COOKIE_FILE


def yt_options() -> dict:
    """Options shared by /api/info and /api/download."""
    opts = {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
    }

    cookie_file = get_cookie_file()
    if cookie_file:
        opts["cookiefile"] = cookie_file

    # This should be the same/current UA as the browser used to create the
    # cookies. Leave it unset unless the deployment has explicitly supplied it.
    user_agent = os.environ.get("YOUTUBE_USER_AGENT", "").strip()
    if user_agent:
        opts["http_headers"] = {"User-Agent": user_agent}

    return opts


def friendly_youtube_error(exc: Exception) -> str:
    """Hide noisy yt-dlp internals and give the user an actionable message."""
    message = str(exc)
    lower = message.lower()

    if "sign in to confirm" in lower or "cookies-from-browser" in lower or "cookies for the authentication" in lower:
        if get_cookie_file() is None:
            return (
                "YouTube is asking the server to authenticate. "
                "Configure the YOUTUBE_COOKIES_B64 Render secret with a fresh "
                "YouTube cookies.txt file, then redeploy."
            )
        return (
            "YouTube rejected the configured cookies. Refresh/export a new "
            "YouTube cookies.txt file and update the YOUTUBE_COOKIES_B64 Render secret."
        )

    if "video unavailable" in lower:
        return "YouTube says this video is unavailable to the downloader."

    if "private video" in lower:
        return "This is a private video. Use cookies from an account that can access it."

    # Keep ordinary yt-dlp errors, but strip the redundant ERROR: prefix.
    return message.removeprefix("ERROR: ").strip()


def valid_youtube_url(url: str) -> bool:
    return bool(YOUTUBE_RE.match((url or "").strip()))


def format_for_quality(quality: str) -> str:
    quality = quality or "best"
    if quality == "720p":
        return "bestvideo[height<=720]+bestaudio/best[height<=720]/best"
    if quality == "480p":
        return "bestvideo[height<=480]+bestaudio/best[height<=480]/best"
    if quality == "360p":
        return "bestvideo[height<=360]+bestaudio/best[height<=360]/best"
    return "bestvideo*+bestaudio/best"


@app.get("/")
def index():
    return render_template("index.html")


@app.post("/api/info")
def info():
    data = request.get_json(silent=True) or {}
    url = (data.get("url") or "").strip()

    if not valid_youtube_url(url):
        return jsonify({"error": "Please enter a valid YouTube URL."}), 400

    opts = yt_options()
    opts.update({
        "skip_download": True,
    })

    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            video = ydl.extract_info(url, download=False)

        return jsonify({
            "id": video.get("id"),
            "title": video.get("title") or "YouTube video",
            "thumbnail": video.get("thumbnail"),
            "duration": video.get("duration"),
            "channel": video.get("channel") or video.get("uploader"),
            "is_short": "/shorts/" in url.lower(),
        })
    except Exception as exc:
        return jsonify({"error": friendly_youtube_error(exc)}), 500


@app.post("/api/download")
def download():
    data = request.get_json(silent=True) or {}
    url = (data.get("url") or "").strip()
    quality = data.get("quality") or "best"

    if not valid_youtube_url(url):
        return jsonify({"error": "Please enter a valid YouTube URL."}), 400

    if quality not in {"best", "720p", "480p", "360p"}:
        quality = "best"

    # Render containers have ephemeral filesystems. The file is downloaded
    # into a temporary directory and immediately streamed to the requester.
    temp_dir = tempfile.mkdtemp(prefix="yt_")
    outtmpl = str(Path(temp_dir) / "%(title).70s [%(id)s].%(ext)s")

    opts = yt_options()
    opts.update({
        "format": format_for_quality(quality),
        "outtmpl": outtmpl,
        "retries": 5,
        "fragment_retries": 5,
        "continuedl": True,
        "windowsfilenames": True,
        "trim_file_name": 120,
    })

    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            ydl.download([url])

        files = [
            p for p in Path(temp_dir).glob("*")
            if p.is_file() and not p.name.endswith(".part")
        ]

        if not files:
            raise RuntimeError("Download completed but no output file was found.")

        file_path = files[0]
        response = send_file(
            file_path,
            as_attachment=True,
            download_name=file_path.name,
            max_age=0,
        )

        @response.call_on_close
        def cleanup():
            try:
                for p in Path(temp_dir).glob("*"):
                    p.unlink(missing_ok=True)
                Path(temp_dir).rmdir()
            except Exception:
                pass

        return response

    except Exception as exc:
        try:
            for p in Path(temp_dir).glob("*"):
                p.unlink(missing_ok=True)
            Path(temp_dir).rmdir()
        except Exception:
            pass
        return jsonify({"error": friendly_youtube_error(exc)}), 500


@app.get("/api/auth-status")
def auth_status():
    """Small diagnostic endpoint; never returns cookie contents."""
    try:
        configured = get_cookie_file() is not None
    except Exception:
        configured = False

    return jsonify({
        "cookies_configured": configured,
        "user_agent_configured": bool(os.environ.get("YOUTUBE_USER_AGENT", "").strip()),
    })


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "10000"))
    app.run(host="0.0.0.0", port=port)
