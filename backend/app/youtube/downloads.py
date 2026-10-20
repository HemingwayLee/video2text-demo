"""Download the latest videos of a YouTube channel into the reels directory with yt-dlp.

Each channel gets a folder `youtube-<handle>` under REELS_DIR with the same layout as downloaded reels:
`<video id>.mp4` + `<video id>.json` ({"url", "title", "description"}), so STT, V2T and Make video work on it.
Each video's mtime is set to its upload time, so newest first is the channel's order.

Download jobs live in memory, one per channel folder. A backend restart (including a hot reload) drops them.
"""

import asyncio
import json
import logging
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from yt_dlp import YoutubeDL

from app.config import settings
from app.reels.jobs import NAME_RE, VIDEO_EXTS, YOUTUBE_PREFIX, JobError

logger = logging.getLogger(__name__)

FOLDER_PREFIX = YOUTUBE_PREFIX
MAX_COUNT = 50
CHANNEL_PATH_RE = re.compile(r"^/(@[^/]+|channel/[^/]+|c/[^/]+|user/[^/]+)(/.*)?$")
CHANNEL_TABS = ("videos", "shorts", "streams")
# H.264 + AAC in MP4 plays in every browser; cap at 1080p to keep files reasonable.
FORMAT = (
    "bv*[height<=1080][ext=mp4][vcodec^=avc1]+ba[ext=m4a]"
    "/b[height<=1080][ext=mp4]"
    "/bv*[height<=1080]+ba"
    "/b"
)

_jobs: dict[str, dict[str, Any]] = {}
_tasks: set[asyncio.Task] = set()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def channel_url(channel: str) -> str:
    """A channel's tab URL from "@handle", "handle" or a channel URL. Defaults to the Videos tab."""
    channel = channel.strip()
    if not channel:
        raise JobError(400, "Enter a channel: @handle or a channel URL.")
    if not re.match(r"^https?://", channel):
        if "/" in channel or " " in channel:
            raise JobError(400, f"Not a channel handle or URL: {channel!r}")
        return f"https://www.youtube.com/{channel if channel.startswith('@') else '@' + channel}/videos"
    parsed = urlparse(channel)
    host = parsed.netloc.lower().removeprefix("www.").removeprefix("m.")
    match = CHANNEL_PATH_RE.match(parsed.path.rstrip("/") or "/")
    if host != "youtube.com" or not match:
        raise JobError(400, "Use a YouTube channel URL, like https://www.youtube.com/@handle.")
    tab = (match.group(2) or "").strip("/").split("/")[0]
    return f"https://www.youtube.com/{match.group(1)}/{tab if tab in CHANNEL_TABS else 'videos'}"


def _folder_name(info: dict[str, Any]) -> str:
    handle = (info.get("uploader_id") or info.get("channel_id") or info.get("id") or "").lstrip("@")
    name = FOLDER_PREFIX + re.sub(r"[^\w.\- ]", "_", handle)
    if not NAME_RE.match(name):
        raise JobError(502, "Couldn't work out the channel's handle.")
    return name


def _folder_dir(folder: str) -> Path:
    if not folder.startswith(FOLDER_PREFIX) or not NAME_RE.match(folder) or folder in (".", ".."):
        raise JobError(400, f"Invalid folder: {folder!r}")
    return Path(settings.reels_dir) / folder


def _list_channel(url: str, count: int) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """The channel's info and its latest `count` entries (without downloading)."""
    opts = {"extract_flat": "in_playlist", "playlistend": count, "quiet": True, "no_warnings": True,
            "skip_download": True}
    try:
        with YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)
    except Exception as exc:
        raise JobError(400, f"Couldn't read the channel: {exc}") from exc
    entries = [e for e in (info.get("entries") or []) if e and e.get("id")][:count]
    if not entries:
        raise JobError(404, "No videos found on this channel tab.")
    return info, entries


def _video_file(directory: Path, video_id: str) -> Path | None:
    return next((directory / f"{video_id}{ext}" for ext in VIDEO_EXTS if (directory / f"{video_id}{ext}").is_file()), None)


def _download_one(job: dict[str, Any], directory: Path, entry: dict[str, Any]) -> None:
    video_id = entry["id"]

    def progress(d: dict[str, Any]) -> None:
        if d["status"] == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate")
            job["progress"] = round(d["downloaded_bytes"] / total, 3) if total else None
            job["updated_at"] = _now()

    opts = {
        "format": FORMAT,
        "merge_output_format": "mp4",
        "outtmpl": str(directory / "%(id)s.%(ext)s"),
        "noplaylist": True,
        "updatetime": False,
        "quiet": True,
        "no_warnings": True,
        "progress_hooks": [progress],
    }
    with YoutubeDL(opts) as ydl:
        info = ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=True)
    video = _video_file(directory, video_id)
    if video is None:
        raise RuntimeError("yt-dlp didn't leave a video file.")
    data = {
        "url": info.get("webpage_url") or f"https://www.youtube.com/watch?v={video_id}",
        "title": info.get("title") or "",
        "description": info.get("description") or "",
    }
    (directory / f"{video_id}.json").write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    if timestamp := info.get("timestamp"):
        os.utime(video, (timestamp, timestamp))


def _download_all(job: dict[str, Any], directory: Path, entries: list[dict[str, Any]]) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    for index, entry in enumerate(entries, 1):
        job.update(step=f"Downloading {index} of {len(entries)}: {entry.get('title') or entry['id']}",
                   progress=None, updated_at=_now())
        if _video_file(directory, entry["id"]) and (directory / f"{entry['id']}.json").is_file():
            job["skipped"] += 1
            continue
        try:
            _download_one(job, directory, entry)
            job["downloaded"] += 1
        except Exception as exc:
            logger.exception("Download failed for %s", entry["id"])
            job["failed"].append({"id": entry["id"], "title": entry.get("title"), "error": str(exc)})


async def _run(job: dict[str, Any], directory: Path, entries: list[dict[str, Any]]) -> None:
    try:
        await asyncio.to_thread(_download_all, job, directory, entries)
        job.update(status="done", step=None, progress=None, updated_at=_now())
    except Exception as exc:
        logger.exception("Download job failed for %s", directory.name)
        job.update(status="failed", step=None, progress=None, error=str(exc), updated_at=_now())


async def start(channel: str, count: int) -> dict[str, Any]:
    if not 1 <= count <= MAX_COUNT:
        raise JobError(400, f"Pick between 1 and {MAX_COUNT} videos.")
    url = channel_url(channel)
    info, entries = await asyncio.to_thread(_list_channel, url, count)
    folder = _folder_name(info)
    if _jobs.get(folder, {}).get("status") == "running":
        raise JobError(409, "This channel is already downloading.")

    job = {"status": "running", "channel": info.get("channel") or info.get("uploader") or folder, "url": url,
           "total": len(entries), "downloaded": 0, "skipped": 0, "failed": [], "step": "Starting…",
           "progress": None, "error": None, "updated_at": _now()}
    _jobs[folder] = job
    task = asyncio.create_task(_run(job, _folder_dir(folder), entries))
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)
    return {"folder": folder, "job": job}


def list_channels() -> list[dict[str, Any]]:
    """Downloaded channel folders, most recently changed first."""
    root = Path(settings.reels_dir)
    folders = [p for p in root.glob(f"{FOLDER_PREFIX}*") if p.is_dir()] if root.is_dir() else []
    folders.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    return [{"folder": p.name, "count": sum(1 for f in p.iterdir() if f.suffix in VIDEO_EXTS),
             "job": _jobs.get(p.name)} for p in folders]


def folder_reels(folder: str) -> dict[str, Any]:
    """A channel folder's videos (newest upload first) with their JSON, plus its download job if any."""
    directory = _folder_dir(folder)
    reels = []
    if directory.is_dir():
        for video in directory.iterdir():
            if video.suffix not in VIDEO_EXTS:
                continue
            json_path = video.with_suffix(".json")
            data, error = None, None
            if json_path.is_file():
                try:
                    data = json.loads(json_path.read_text(encoding="utf-8"))
                except (OSError, ValueError) as exc:
                    error = f"Cannot read {json_path.name}: {exc}"
            stat = video.stat()
            reels.append({"id": video.stem, "data": data, "error": error, "size": stat.st_size,
                          "modified": stat.st_mtime})
    reels.sort(key=lambda r: (-r["modified"], r["id"]))
    return {"folder": folder, "job": _jobs.get(folder), "reels": reels}
