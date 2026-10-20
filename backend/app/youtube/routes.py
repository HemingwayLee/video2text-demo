from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.reels.jobs import JobError
from app.youtube import downloads

router = APIRouter(prefix="/api/youtube", tags=["youtube"])


class DownloadRequest(BaseModel):
    channel: str
    count: int


def _http(exc: JobError) -> HTTPException:
    return HTTPException(status_code=exc.status, detail=exc.detail)


@router.get("/channels")
def list_channels():
    return downloads.list_channels()


@router.post("/downloads", status_code=202)
async def start_download(payload: DownloadRequest):
    """Download a channel's latest `count` videos into REELS_DIR/youtube-<handle>/."""
    try:
        return await downloads.start(payload.channel, payload.count)
    except JobError as exc:
        raise _http(exc) from exc


@router.get("/channels/{folder}")
def get_channel(folder: str):
    try:
        return downloads.folder_reels(folder)
    except JobError as exc:
        raise _http(exc) from exc
