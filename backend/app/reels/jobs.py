"""Claude Code jobs that work on one reel.

- stt:   transcribe the speech with local Whisper, proofread it in Traditional Chinese, save as "stt" in the JSON.
         For YouTube videos, the video's own subtitles are used instead when it has them.
- v2t:   look at frames extracted from the video (plus the transcript) and explain what's in it, save as "v2t".
- video: make a new anime-style explainer video (9:16 or 16:9, at most 3/5/8/12 minutes) from text, summary, stt
         and v2t, with Traditional Chinese narration, built in workspace/videos/<folder>/<id>-<aspect>/.

Jobs live in memory, one per reel and kind. A backend restart (including a hot reload) drops them.
"""

import asyncio
import json
import logging
import re
import shutil
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import av

from app.claude import run_turn
from app.config import settings
from app.youtube import subtitles

logger = logging.getLogger(__name__)

VIDEO_EXTS = (".mp4", ".mov", ".webm", ".m4v", ".mkv")
TRANSCRIBE_SCRIPT = Path(__file__).with_name("transcribe.py")
FRAMES_SCRIPT = Path(__file__).with_name("frames.py")
MAKE_SCRIPT = Path(__file__).parent / "videokit" / "make.py"
NAME_RE = re.compile(r"^[\w.\- ]+$")
ASPECTS = {"9x16": (1080, 1920), "16x9": (1920, 1080)}
MAX_MINUTES = (3, 5, 8, 12)
KINDS = ("stt", "v2t", "video")
YOUTUBE_PREFIX = "youtube-"  # folders made by the YouTube tab (app.youtube.downloads)

SAVE_RULES = """\
Save it into `{json_path}` as a top-level string field "{field}". Keep every other field exactly as it is,
and write valid UTF-8 JSON (2-space indent, non-ASCII characters not escaped).

Reply with one short line when done."""

STT_PROMPT = """\
Make a Traditional Chinese (Taiwan) speech-to-text transcript of the reel video `{video}` and save it into `{json_path}`.

1. Transcribe the audio with local Whisper:
   `python {transcribe} "{video}" > {work_dir}/transcript.json`
   It can take a few minutes, so give the Bash call a timeout of 600000 ms. Then read the output.
2. Proofread the transcript:
   - Traditional Chinese as written in Taiwan, with full-width punctuation (，。？！：、).
   - Fix words Whisper misheard, using the reel's caption below and the topic as context.
   - Keep it a faithful transcript of what was said: don't summarize, reorder or add content.
3. {save}

The reel's caption, for context only:
{caption}
"""

V2T_PROMPT = """\
Watch the reel video `{video}` by looking at frames from it, and explain in Traditional Chinese (Taiwan) what is in
the video. Save the explanation into `{json_path}`.

1. Extract frames: `python {frames} "{video}" {work_dir}` (about 30 frames spread over the video; it prints each
   frame's time and path). Then look at every frame with the Read tool, in order. If a moment needs a closer look,
   extract more frames there with `--start S --end S --every SECONDS`.
2. Write the explanation in Traditional Chinese as used in Taiwan, as plain text in this shape:
   概要：2–4 sentences on what the video is about and what happens.
   畫面內容：
   - [0:00–0:15] what is shown and done in this part
   - ... (one line per scene or step, in time order)
   重點：the key things a viewer learns or should notice, as short bullet lines starting with "- "
   Describe what is visible: plants, tools, places, people's actions, on-screen text. Use what is said (below) to name
   things and explain why they're done, but don't invent details that neither the frames nor the speech support.
   If you're unsure what something is, say so.
3. {save}

What is said in the video ({speech_source}), for context:
{speech}
"""

VIDEO_PROMPT = """\
Make a new short explainer video ({aspect_label}) about the reel below, in Japanese anime / manga cartoon style,
with Traditional Chinese (Taiwan) narration. Build everything inside `{project}` and nowhere else.

1. Set up the project: `python {make} init {project} --aspect {aspect} --max-seconds {max_seconds}`. Read `{project}/kit/GUIDE.md` (the style
   kit and the rules) and `{project}/s01.html` (a template scene).
2. Plan the story from the sources below: a hook, the steps or ideas in order, the key tips, a short wrap-up.
   Let the sources set the length: as many scenes as the content needs (usually 6–10 scenes, about 40–90 seconds,
   for a short reel; more for a long video with many steps), without padding. Only use facts from the sources;
   simplify, don't invent.
3. Write `{project}/storyboard.json` (keep "aspect": "{aspect}" and "max_seconds": {max_seconds}) with one entry per scene: id, html file and
   narration. Narration: natural spoken Traditional Chinese as used in Taiwan, warm and lively, 1–2 short sentences
   per scene (about 15–45 characters).
   The video must be shorter than {max_minutes} minutes. Run `python {make} duration {project}` to get its length
   (it narrates the scenes without rendering). If "over_limit" is true, show less content: drop the least important
   scenes and details, merge similar steps, tighten the narration, and check again until it fits. If it's already
   within the limit, leave it as it is.
4. Write one HTML page per scene with the kit. Explain with pictures: draw the plants, tools, actions and
   before/after comparisons as anime-style inline SVG, use characters, arrows, rings, step badges and manga effects
   as visual aids, and keep things moving. Use one narrator character throughout, styled after the person in the
   reel when the sources describe them.
5. Check every scene: `python {make} preview {project} <scene id>` renders a few stills; look at each image with
   the Read tool and fix anything cut off, overlapping, too empty, too small to read, or breaking the rules below.
6. Run `python {make} duration {project}` again after the last narration change, then render:
   `python {make} render {project}` (give the Bash call a timeout of 600000 ms). It writes
   `{project}/video.mp4`. Reply with one short line when done.

Rules:
- No subtitles: never show the narration as text on screen.
- No progress bar, timeline, scene counter or page numbers.
- Very little text on screen: at most two short labels per scene, about 2–8 characters each.
- Japanese anime / manga cartoon look throughout, with all the visual aids needed to understand it without text.

Sources:
Caption (text): {text}
Summary: {summary}
Speech-to-text transcript (stt): {stt}
What the video shows (v2t): {v2t}
"""


class JobError(Exception):
    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status = status
        self.detail = detail


@dataclass
class Plan:
    """What one job runs: the prompt, where, and how to check and undo its result."""

    prompt: str
    cwd: Path
    tools: list[str]
    finish: Callable[[], dict[str, Any] | None]  # validates the result; raises if it's missing or wrong
    rollback: Callable[[], None]


# No message from Claude Code for this long means the turn has stalled. Tools like Whisper or rendering run
# silently for up to 10 minutes (the Bash timeout), so keep it well above that.
IDLE_TIMEOUT = 15 * 60
MAX_RESUMES = 2
RESUME_PROMPT = "Your previous response was cut off. Continue the task from where you left off."

_jobs: dict[tuple[str, str, str], dict[str, Any]] = {}
_tasks: set[asyncio.Task] = set()
# Whisper, frame extraction and video rendering are CPU-heavy, so jobs of every kind share one queue.
_semaphore = asyncio.Semaphore(settings.reel_job_concurrency)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _check_name(value: str, what: str) -> str:
    if not NAME_RE.match(value) or value in (".", ".."):
        raise JobError(400, f"Invalid {what}: {value!r}")
    return value


def resolve_reel(folder: str, reel_id: str) -> tuple[Path, Path]:
    """Return (video, json) paths for a reel under the mounted reels directory."""
    root = Path(settings.reels_dir)
    directory = root / _check_name(folder, "folder")
    _check_name(reel_id, "reel id")
    if not directory.is_dir():
        raise JobError(
            404,
            f"Folder '{folder}' isn't in the backend's reels directory. Put it under REELS_HOST_DIR "
            "(default ../reels-downloader/downloads) and restart the backend.",
        )
    video = next((directory / f"{reel_id}{ext}" for ext in VIDEO_EXTS if (directory / f"{reel_id}{ext}").is_file()), None)
    if video is None:
        raise JobError(404, f"No video file for reel {reel_id} in '{folder}'.")
    return video, directory / f"{reel_id}.json"


# ---------- made videos ----------


def _videos_root(folder: str) -> Path:
    return Path(settings.claude_workspace) / "videos" / _check_name(folder, "folder")


def made_video_path(folder: str, reel_id: str, aspect: str) -> Path:
    if aspect not in ASPECTS:
        raise JobError(404, f"Unknown aspect: {aspect}")
    return _videos_root(folder) / f"{_check_name(reel_id, 'reel id')}-{aspect}" / "video.mp4"


def made_videos(folder: str) -> dict[str, list[str]]:
    """Finished videos for a folder, as {reel_id: [aspect, ...]}."""
    result: dict[str, list[str]] = {}
    root = _videos_root(folder)
    for aspect in ASPECTS:
        for video in root.glob(f"*-{aspect}/video.mp4"):
            result.setdefault(video.parent.name.removesuffix(f"-{aspect}"), []).append(aspect)
    return result


# ---------- jobs ----------


def folder_jobs(folder: str) -> dict[str, dict[str, dict[str, Any]]]:
    """Jobs for one folder as {reel_id: {kind: job}}."""
    result: dict[str, dict[str, dict[str, Any]]] = {}
    for (f, reel_id, kind), job in _jobs.items():
        if f == folder:
            result.setdefault(reel_id, {})[kind] = job
    return result


def start(kind: str, folder: str, reel_id: str, options: dict[str, Any]) -> dict[str, Any]:
    if kind not in KINDS:
        raise JobError(404, f"Unknown job kind: {kind}")
    video, json_path = resolve_reel(folder, reel_id)
    if kind == "video" and options.get("aspect") not in ASPECTS:
        raise JobError(400, f"Pick an aspect: {' or '.join(ASPECTS)}")
    if kind == "video" and options.get("max_minutes") not in MAX_MINUTES:
        raise JobError(400, f"Pick a length limit: {', '.join(map(str, MAX_MINUTES))} minutes")
    key = (folder, reel_id, kind)
    if _jobs.get(key, {}).get("status") in ("queued", "running"):
        raise JobError(409, f"{kind.upper()} is already running for this reel.")

    job = {"status": "queued", "step": "Waiting for another job to finish…", "error": None, "data": None,
           "options": options, "updated_at": _now()}
    _jobs[key] = job
    task = asyncio.create_task(_run(kind, job, folder, video, json_path, options))
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)
    return job


def _update(job: dict[str, Any], **fields: Any) -> None:
    job.update(fields, updated_at=_now())


def _step_for(event: dict[str, Any]) -> str | None:
    if event["type"] != "tool_use":
        return None
    name, tool_input = event["name"], event["input"]
    command = str(tool_input.get("command", ""))
    path = str(tool_input.get("file_path", ""))
    if TRANSCRIBE_SCRIPT.name in command:
        return "Transcribing audio with Whisper…"
    if FRAMES_SCRIPT.name in command:
        return "Extracting frames…"
    if MAKE_SCRIPT.name in command:
        if " render " in command:
            return "Recording narration and rendering the video…"
        if " preview " in command:
            return "Checking scene previews…"
        if " duration " in command:
            return "Checking the video's length…"
        return "Setting up the video project…"
    if name == "Read" and path.endswith(".jpg"):
        return "Looking at the frames…"
    if name == "Read" and path.endswith(".png"):
        return "Checking scene previews…"
    if name in ("Write", "Edit") and path.endswith(".html"):
        return "Drawing scenes…"
    if name in ("Write", "Edit") and path.endswith("storyboard.json"):
        return "Writing the storyboard and narration…"
    if name in ("Write", "Edit") or (name == "Bash" and ".json" in command):
        return "Saving…"
    return "Planning…"


def _read_json(json_path: Path) -> tuple[str | None, dict[str, Any]]:
    """The JSON file's text (to restore it later) and its fields ({} if missing or unreadable)."""
    text = json_path.read_text(encoding="utf-8") if json_path.is_file() else None
    try:
        data = json.loads(text) if text else {}
    except ValueError:
        data = {}
    return text, data if isinstance(data, dict) else {}


def reel_caption(data: dict[str, Any]) -> dict[str, str | None]:
    """The reel's text and summary. Newer downloads name them "title" and "description"."""
    return {
        "text": data.get("text") or data.get("title"),
        "summary": data.get("summary") or data.get("description"),
    }


def _json_field_plan(kind: str, prompt_template: str, video: Path, json_path: Path, work_dir: Path) -> Plan:
    """stt / v2t: Claude Code writes one text field into the reel's JSON."""
    original_text, original = _read_json(json_path)
    caption = "\n".join(v for v in reel_caption(original).values() if v) or "(none)"
    if original.get("stt"):
        speech_source, speech = "speech-to-text transcript", original["stt"]
    else:
        speech_source, speech = "no transcript yet, so this is the reel's caption", caption
    prompt = prompt_template.format(
        video=video, json_path=json_path, work_dir=work_dir, transcribe=TRANSCRIBE_SCRIPT, frames=FRAMES_SCRIPT,
        caption=caption, speech_source=speech_source, speech=speech,
        save=SAVE_RULES.format(json_path=json_path, field=kind),
    )

    def finish() -> dict[str, Any]:
        try:
            data = json.loads(json_path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            raise RuntimeError(f"Claude Code left {json_path.name} unreadable: {exc}") from exc
        if not isinstance(data, dict) or not isinstance(data.get(kind), str) or not data[kind].strip():
            raise RuntimeError(f'Claude Code didn\'t save a "{kind}" text field into {json_path.name}.')
        changed = [k for k, v in original.items() if k != kind and data.get(k) != v]
        if changed:
            raise RuntimeError(f"Claude Code changed other fields in {json_path.name}: {', '.join(changed)}")
        return data

    def rollback() -> None:
        # Put the JSON back as it was rather than leave a half-written file.
        if original_text is not None:
            json_path.write_text(original_text, encoding="utf-8")

    return Plan(prompt, video.parent, ["Bash", "Read", "Write", "Edit"], finish, rollback)


def _video_plan(folder: str, video: Path, json_path: Path, aspect: str, max_minutes: int) -> Plan:
    """video: Claude Code builds a project folder in the workspace and renders video.mp4 there."""
    _, data = _read_json(json_path)
    output = made_video_path(folder, video.stem, aspect)
    project = output.parent
    # Keep the previous version until the new one is done.
    previous = project.with_name(project.name + ".prev")
    shutil.rmtree(previous, ignore_errors=True)
    if project.exists():
        project.rename(previous)
    project.mkdir(parents=True)
    started = time.time()

    prompt = VIDEO_PROMPT.format(
        aspect=aspect, aspect_label="9:16 portrait" if aspect == "9x16" else "16:9 landscape",
        project=project, make=MAKE_SCRIPT, max_minutes=max_minutes, max_seconds=max_minutes * 60,
        **{k: v or "(none)" for k, v in {**reel_caption(data), "stt": data.get("stt"), "v2t": data.get("v2t")}.items()},
    )

    def finish() -> dict[str, Any]:
        if not output.is_file() or output.stat().st_mtime < started:
            raise RuntimeError("Claude Code didn't render video.mp4.")
        with av.open(str(output)) as container:
            streams = container.streams
            duration = float(container.duration / av.time_base) if container.duration else 0.0
            size = (streams.video[0].codec_context.width, streams.video[0].codec_context.height) if streams.video else None
            has_audio = bool(streams.audio)
        if size != ASPECTS[aspect]:
            raise RuntimeError(f"The video is {size}, expected {ASPECTS[aspect]}.")
        if duration < 10 or not has_audio:
            raise RuntimeError(f"The video looks incomplete ({duration:.0f} s, audio: {has_audio}).")
        if duration > max_minutes * 60:
            raise RuntimeError(f"The video is {duration:.0f} s, over the {max_minutes}-minute limit.")
        shutil.rmtree(previous, ignore_errors=True)
        return {"aspect": aspect, "max_minutes": max_minutes, "duration": round(duration, 1)}

    def rollback() -> None:
        if previous.exists():
            shutil.rmtree(project, ignore_errors=True)
            previous.rename(project)

    return Plan(prompt, project, ["Bash", "Read", "Write", "Edit", "Glob"], finish, rollback)


async def _turn(job: dict[str, Any], plan: Plan, prompt: str, resume: str | None, state: dict[str, Any]) -> None:
    def touch() -> None:
        state["last_activity"] = time.monotonic()

    async for event in run_turn(
        prompt, settings.claude_default_model, resume, cwd=str(plan.cwd), allowed_tools=plan.tools, on_activity=touch
    ):
        if event["type"] in ("session", "result") and event.get("session_id"):
            state["session_id"] = event["session_id"]
        if event["type"] == "result" and event["is_error"]:
            raise RuntimeError(event["result"] or event["subtype"])
        if step := _step_for(event):
            _update(job, step=step)


async def _drive(job: dict[str, Any], plan: Plan) -> None:
    """Run the job's Claude Code turn. If Claude Code goes silent for IDLE_TIMEOUT (an API stream can stall), stop
    the turn and resume the same session, up to MAX_RESUMES times."""
    state: dict[str, Any] = {"last_activity": time.monotonic(), "session_id": None}
    prompt, resume = plan.prompt, None
    for attempt in range(MAX_RESUMES + 1):
        state["last_activity"] = time.monotonic()
        task = asyncio.create_task(_turn(job, plan, prompt, resume, state))
        while not task.done():
            await asyncio.wait({task}, timeout=30)
            if not task.done() and time.monotonic() - state["last_activity"] > IDLE_TIMEOUT:
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
                break
        else:
            task.result()  # re-raise the turn's error, if any
            return
        if not state["session_id"] or attempt == MAX_RESUMES:
            raise RuntimeError(f"Claude Code stopped responding for {IDLE_TIMEOUT // 60:.0f} minutes.")
        logger.warning("Claude Code went silent; resuming session %s", state["session_id"])
        _update(job, step="Claude Code stalled; resuming…")
        prompt, resume = RESUME_PROMPT, state["session_id"]


async def _stt_from_subtitles(job: dict[str, Any], json_path: Path) -> bool:
    """Save a YouTube video's own subtitles as "stt". False if it has none (or they can't be fetched)."""
    _, data = _read_json(json_path)
    if not data.get("url"):
        return False
    _update(job, status="running", step="Checking for YouTube subtitles…")
    try:
        found = await asyncio.to_thread(subtitles.fetch, data["url"])
    except Exception:
        logger.exception("Couldn't fetch subtitles for %s", data["url"])
        found = None
    if found is None:
        _update(job, status="queued", step="No subtitles; waiting to transcribe…")
        return False
    lang, data["stt"] = found
    json_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    logger.info("Saved %s subtitles as stt for %s", lang, json_path.stem)
    _update(job, status="done", step=None, data=data)
    return True


async def _run(kind: str, job: dict[str, Any], folder: str, video: Path, json_path: Path,
               options: dict[str, Any]) -> None:
    if kind == "stt" and folder.startswith(YOUTUBE_PREFIX) and await _stt_from_subtitles(job, json_path):
        return
    async with _semaphore:
        work_dir = Path("/tmp") / f"{kind}-{video.stem}"
        shutil.rmtree(work_dir, ignore_errors=True)
        work_dir.mkdir(parents=True)
        plan = None
        try:
            if kind == "video":
                plan = _video_plan(folder, video, json_path, options["aspect"], options["max_minutes"])
            else:
                plan = _json_field_plan(kind, STT_PROMPT if kind == "stt" else V2T_PROMPT, video, json_path, work_dir)
            _update(job, status="running", step="Starting Claude Code…")
            await _drive(job, plan)
            _update(job, status="done", step=None, data=plan.finish())
        except Exception as exc:
            logger.exception("%s failed for %s", kind, video)
            if plan is not None:
                plan.rollback()
            _update(job, status="failed", step=None, error=str(exc))
        finally:
            shutil.rmtree(work_dir, ignore_errors=True)
