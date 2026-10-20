"""Make an anime-style explainer video from HTML scenes and Traditional Chinese narration.

A project folder holds storyboard.json plus one HTML page per scene (using kit/anime.css and kit/anime.js):

    {"aspect": "9x16", "voice": "zh-TW-HsiaoChenNeural", "rate": "+0%", "max_seconds": 180,
     "scenes": [{"id": "s01", "html": "s01.html", "narration": "..."}]}

Commands:
    python make.py init <dir> --aspect 9x16|16x9 [--max-seconds N]   copy the kit, a template scene and a storyboard
    python make.py preview <dir> s01 [--times 0.5,2,end]   render still PNGs of a scene to check it
    python make.py duration <dir>                   narrate every scene and print the video's length, without rendering
    python make.py render <dir>                     narrate, render every scene and write <dir>/video.mp4

Each scene lasts as long as its narration (plus a short lead-in and pause). With "max_seconds" set,
render refuses a storyboard whose video would be longer. Scenes animate with CSS
animations, which the renderer steps frame by frame, so the output is the same on every run.
"""

import argparse
import asyncio
import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path

import av
import edge_tts
from PIL import Image
from playwright.async_api import async_playwright

KIT_DIR = Path(__file__).with_name("kit")
SIZES = {"9x16": (1080, 1920), "16x9": (1920, 1080)}
FPS = 24
LEAD_IN = 0.4  # seconds of picture before the narration starts
TAIL = 0.6  # seconds after the narration ends
MIN_SCENE = 2.5
FADE = 0.25
PARALLEL_SCENES = 4
DEFAULT_VOICE = "zh-TW-HsiaoChenNeural"

SEEK_SCRIPT = """
window.__seek = (t) => {
  for (const a of document.getAnimations()) { a.pause(); a.currentTime = t * 1000; }
  if (typeof window.renderAt === "function") window.renderAt(t);
};
"""


def load_storyboard(project: Path) -> dict:
    path = project / "storyboard.json"
    if not path.is_file():
        sys.exit(f"No storyboard.json in {project}. Run `make.py init` first.")
    board = json.loads(path.read_text(encoding="utf-8"))
    if board.get("aspect") not in SIZES:
        sys.exit(f'storyboard.json: "aspect" must be one of {", ".join(SIZES)}')
    ids = [s.get("id") for s in board.get("scenes", [])]
    if not ids or len(set(ids)) != len(ids):
        sys.exit('storyboard.json: "scenes" must be a non-empty list with unique ids')
    for scene in board["scenes"]:
        if not (project / scene.get("html", "")).is_file():
            sys.exit(f"Scene {scene['id']}: HTML file {scene.get('html')!r} not found")
        if not scene.get("narration", "").strip():
            sys.exit(f"Scene {scene['id']}: narration is empty")
    return board


def media_duration(path: Path) -> float:
    with av.open(str(path)) as container:
        return float(container.duration / av.time_base)


async def narrate(project: Path, board: dict, scene: dict) -> tuple[Path, float]:
    """Synthesize a scene's narration (cached by text, voice and rate). Returns (mp3, seconds)."""
    voice, rate = board.get("voice", DEFAULT_VOICE), board.get("rate", "+0%")
    key = hashlib.sha1(f"{voice}|{rate}|{scene['narration']}".encode()).hexdigest()[:12]
    audio_dir = project / "build" / "audio"
    audio_dir.mkdir(parents=True, exist_ok=True)
    mp3 = audio_dir / f"{scene['id']}-{key}.mp3"
    if not mp3.is_file():
        for attempt in range(3):
            try:
                await edge_tts.Communicate(scene["narration"], voice, rate=rate).save(str(mp3))
                break
            except Exception:
                mp3.unlink(missing_ok=True)
                if attempt == 2:
                    raise
                await asyncio.sleep(2)
    return mp3, media_duration(mp3)


def scene_length(narration_seconds: float) -> float:
    return max(MIN_SCENE, LEAD_IN + narration_seconds + TAIL)


async def open_scene(browser, project: Path, board: dict, scene: dict, duration: float):
    width, height = SIZES[board["aspect"]]
    page = await browser.new_page(viewport={"width": width, "height": height})
    await page.add_init_script(SEEK_SCRIPT + f"\nwindow.SCENE_DURATION = {duration};")
    errors: list[str] = []
    page.on("pageerror", lambda exc: errors.append(str(exc)))
    await page.goto((project / scene["html"]).resolve().as_uri(), wait_until="load")
    await page.evaluate("document.fonts.ready.then(() => true)")
    await page.evaluate("window.__seek(0)")
    return page, errors


async def preview(project: Path, scene_id: str, times: list[str]) -> None:
    board = load_storyboard(project)
    scene = next((s for s in board["scenes"] if s["id"] == scene_id), None)
    if scene is None:
        sys.exit(f"No scene {scene_id!r} in storyboard.json")
    _, seconds = await narrate(project, board, scene)
    duration = scene_length(seconds)
    out_dir = project / "build" / "preview"
    out_dir.mkdir(parents=True, exist_ok=True)

    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page, errors = await open_scene(browser, project, board, scene, duration)
        written = []
        for value in times:
            t = duration - 0.05 if value == "end" else min(float(value), duration - 0.05)
            await page.evaluate("t => window.__seek(t)", t)
            path = out_dir / f"{scene_id}_{t:.1f}s.png"
            await page.screenshot(path=str(path))
            # Half size is plenty to judge a frame and keeps it cheap to look at.
            with Image.open(path) as image:
                image.thumbnail((960, 960))
                image.save(path)
            written.append(str(path))
        await browser.close()

    print(json.dumps({"scene": scene_id, "duration": round(duration, 2), "narration_seconds": round(seconds, 2),
                      "images": written, "page_errors": errors}, ensure_ascii=False, indent=1))


async def render_scene(browser, project: Path, board: dict, scene: dict, mp3: Path, seconds: float) -> Path:
    duration = scene_length(seconds)
    frames = round(duration * FPS)
    out = project / "build" / "scenes" / f"{scene['id']}.mp4"
    out.parent.mkdir(parents=True, exist_ok=True)

    page, errors = await open_scene(browser, project, board, scene, duration)
    fade = f"fade=t=in:st=0:d={FADE},fade=t=out:st={duration - FADE:.3f}:d={FADE}"
    ffmpeg = await asyncio.create_subprocess_exec(
        "ffmpeg", "-y", "-loglevel", "error",
        "-f", "image2pipe", "-framerate", str(FPS), "-i", "-",
        "-i", str(mp3),
        "-filter_complex", f"[0:v]{fade},format=yuv420p[v];"
                           f"[1:a]adelay={int(LEAD_IN * 1000)}:all=1,apad,atrim=0:{duration:.3f},"
                           f"aformat=sample_rates=48000:channel_layouts=stereo[a]",
        "-map", "[v]", "-map", "[a]",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-r", str(FPS),
        "-c:a", "aac", "-b:a", "160k", "-t", f"{duration:.3f}",
        str(out),
        stdin=asyncio.subprocess.PIPE,
    )
    try:
        for i in range(frames):
            await page.evaluate("t => window.__seek(t)", i / FPS)
            ffmpeg.stdin.write(await page.screenshot(type="jpeg", quality=92))
            await ffmpeg.stdin.drain()
    finally:
        ffmpeg.stdin.close()
        await page.close()
    if await ffmpeg.wait() != 0:
        raise RuntimeError(f"ffmpeg failed for scene {scene['id']}")
    if errors:
        print(f"warning: scene {scene['id']} had page errors: {errors}", file=sys.stderr)
    return out


async def measure(project: Path, board: dict) -> tuple[list[tuple[Path, float]], dict]:
    """Narrate every scene and work out the video's length against the storyboard's "max_seconds"."""
    narrations = await asyncio.gather(*(narrate(project, board, s) for s in board["scenes"]))
    lengths = [scene_length(seconds) for _, seconds in narrations]
    total, limit = sum(lengths), board.get("max_seconds")
    report = {"duration": round(total, 1), "max_seconds": limit, "over_limit": bool(limit and total > limit),
              "scenes": [{"id": s["id"], "duration": round(d, 1)} for s, d in zip(board["scenes"], lengths)]}
    return narrations, report


async def duration(project: Path) -> None:
    _, report = await measure(project, load_storyboard(project))
    print(json.dumps(report, indent=1))


async def render(project: Path) -> None:
    board = load_storyboard(project)
    narrations, report = await measure(project, board)
    if report["over_limit"]:
        sys.exit(f"The video would be {report['duration']:.0f} s, over the limit of {report['max_seconds']} s. "
                 "Shorten it (fewer scenes, shorter narration) and run render again.")

    limit = asyncio.Semaphore(PARALLEL_SCENES)
    async with async_playwright() as p:
        browser = await p.chromium.launch()

        async def one(scene, narration):
            async with limit:
                return await render_scene(browser, project, board, scene, *narration)

        clips = await asyncio.gather(*(one(s, n) for s, n in zip(board["scenes"], narrations)))
        await browser.close()

    concat_list = project / "build" / "concat.txt"
    concat_list.write_text("".join(f"file '{c.resolve()}'\n" for c in clips))
    video = project / "video.mp4"
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(concat_list),
         "-c", "copy", "-movflags", "+faststart", str(video)],
        check=True,
    )
    width, height = SIZES[board["aspect"]]
    print(json.dumps({"video": str(video), "aspect": board["aspect"], "size": f"{width}x{height}",
                      "duration": round(media_duration(video), 2), "scenes": len(clips)}, indent=1))


def init(project: Path, aspect: str, max_seconds: int | None) -> None:
    project.mkdir(parents=True, exist_ok=True)
    shutil.copytree(KIT_DIR, project / "kit", dirs_exist_ok=True)
    if not (project / "storyboard.json").exists():
        (project / "storyboard.json").write_text(json.dumps({
            "aspect": aspect, "voice": DEFAULT_VOICE, "rate": "+0%",
            **({"max_seconds": max_seconds} if max_seconds else {}),
            "scenes": [{"id": "s01", "html": "s01.html", "narration": "大家好，今天來看看菜園裡的小祕訣！"}],
        }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if not (project / "s01.html").exists():
        shutil.copy(KIT_DIR / "template.html", project / "s01.html")
    print(f"Initialized {project} ({aspect}). Read kit/GUIDE.md, then edit storyboard.json and the scene pages.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    p_init = sub.add_parser("init")
    p_init.add_argument("project", type=Path)
    p_init.add_argument("--aspect", choices=list(SIZES), required=True)
    p_init.add_argument("--max-seconds", type=int, help="longest the video may be")
    p_preview = sub.add_parser("preview")
    p_preview.add_argument("project", type=Path)
    p_preview.add_argument("scene")
    p_preview.add_argument("--times", default="0.6,2,end", help='comma-separated seconds, or "end"')
    p_duration = sub.add_parser("duration")
    p_duration.add_argument("project", type=Path)
    p_render = sub.add_parser("render")
    p_render.add_argument("project", type=Path)
    args = parser.parse_args()

    if args.command == "init":
        init(args.project, args.aspect, args.max_seconds)
    elif args.command == "preview":
        asyncio.run(preview(args.project, args.scene, [t.strip() for t in args.times.split(",") if t.strip()]))
    elif args.command == "duration":
        asyncio.run(duration(args.project))
    else:
        asyncio.run(render(args.project))


if __name__ == "__main__":
    main()
