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

    opts = {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "skip_download": True,
    }

    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            data = ydl.extract_info(url, download=False)

        return jsonify({
            "id": data.get("id"),
            "title": data.get("title") or "YouTube video",
            "thumbnail": data.get("thumbnail"),
            "duration": data.get("duration"),
            "channel": data.get("channel") or data.get("uploader"),
            "is_short": "/shorts/" in url.lower(),
        })
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


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

    # Short title + video ID prevents Android/Unix filename-length problems.
    outtmpl = str(Path(temp_dir) / "%(title).70s [%(id)s].%(ext)s")

    opts = {
        "format": format_for_quality(quality),
        "outtmpl": outtmpl,
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "retries": 5,
        "fragment_retries": 5,
        "continuedl": True,
        "windowsfilenames": True,
        "trim_file_name": 120,
    }

    # If a merge is needed, the Docker image includes ffmpeg.
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            ydl.download([url])

        files = list(Path(temp_dir).glob("*"))
        files = [p for p in files if p.is_file() and not p.name.endswith(".part")]

        if not files:
            return jsonify({"error": "Download completed but no output file was found."}), 500

        file_path = files[0]

        response = send_file(
            file_path,
            as_attachment=True,
            download_name=file_path.name,
            max_age=0,
        )

        # Temporary cleanup after the response is closed.
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
        return jsonify({"error": str(exc)}), 500


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "10000"))
    app.run(host="0.0.0.0", port=port)
