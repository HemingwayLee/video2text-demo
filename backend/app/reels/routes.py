from typing import Any

from fastapi import APIRouter, Body, HTTPException
from fastapi.responses import FileResponse

from app.reels import jobs

router = APIRouter(prefix="/api/reels", tags=["reels"])


def _http(exc: jobs.JobError) -> HTTPException:
    return HTTPException(status_code=exc.status, detail=exc.detail)


@router.get("/{folder}/jobs")
def list_jobs(folder: str):
    """Claude Code jobs for one folder as {reel_id: {kind: job}}, plus finished videos as {reel_id: [aspect]}."""
    try:
        return {"jobs": jobs.folder_jobs(folder), "videos": jobs.made_videos(folder)}
    except jobs.JobError as exc:
        raise _http(exc) from exc


@router.post("/{folder}/{reel_id}/{kind}", status_code=202)
async def start_job(folder: str, reel_id: str, kind: str, options: dict[str, Any] | None = Body(default=None)):
    """Start a job on one reel. kind: "stt", "v2t" or "video" (options: {"aspect": "9x16" | "16x9"})."""
    try:
        return jobs.start(kind, folder, reel_id, options or {})
    except jobs.JobError as exc:
        raise _http(exc) from exc


@router.get("/{folder}/{reel_id}/source")
def get_source_video(folder: str, reel_id: str):
    """The reel's own video file, for folders the browser doesn't read itself (YouTube downloads)."""
    try:
        video, _ = jobs.resolve_reel(folder, reel_id)
    except jobs.JobError as exc:
        raise _http(exc) from exc
    return FileResponse(video, media_type="video/mp4")


@router.get("/{folder}/{reel_id}/videos/{aspect}")
def get_made_video(folder: str, reel_id: str, aspect: str, download: bool = False):
    try:
        path = jobs.made_video_path(folder, reel_id, aspect)
    except jobs.JobError as exc:
        raise _http(exc) from exc
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Video not made yet.")
    filename = f"{reel_id}-{aspect}.mp4"
    return FileResponse(path, media_type="video/mp4", filename=filename if download else None)
