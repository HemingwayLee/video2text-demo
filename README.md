# video2text-demo

A chat GUI for Claude Code. React + MUI frontend, FastAPI backend, PostgreSQL.

The backend drives Claude Code through the [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview),
so each chat is a real Claude Code session: it can read and edit files, run commands, and search the web
inside `./workspace`.

## Setup

```bash
cp .env.example .env
claude setup-token            # Pro/Max plan: paste the printed token into CLAUDE_CODE_OAUTH_TOKEN in .env
docker compose -f docker-compose.dev.yml up --build
```

Credentials, set one in `.env`:

- **`CLAUDE_CODE_OAUTH_TOKEN`**: uses your Claude Pro/Max subscription and its usage limits. `claude setup-token`
  creates a one-year token. This is for your own personal use; keep the token out of git (`.env` is ignored).
- **`ANTHROPIC_API_KEY`**: pay-as-you-go API billing, with a key from the [Claude Console](https://platform.claude.com/).
  Per-reply cost is shown only in this mode.

| Service  | URL                          |
| -------- | ---------------------------- |
| Chat UI  | http://localhost:5174        |
| API      | http://localhost:8001/api    |
| API docs | http://localhost:8001/docs   |
| Postgres | localhost:5433 (app/app/app) |

## How it works

- `POST /api/conversations/{id}/messages` runs one Claude Code turn and streams it back as server-sent events
  (text deltas, tool calls, tool results, final cost).
- Chats and messages are stored in Postgres. Each conversation keeps its Claude Code session id, and the next
  message resumes that session. Session transcripts live in the `claude-config` Docker volume.
- Claude Code works in `./workspace` (mounted at `/workspace` in the backend container).
- Tools are pre-approved and anything else is denied (`permission_mode="dontAsk"`). The default set is Read,
  Write, Edit, Glob, Grep, Bash, WebSearch, WebFetch and TodoWrite; override it with
  `CLAUDE_ALLOWED_TOOLS='["Read","Glob","Grep"]'`. Bash runs inside the backend container.
- The Stop button aborts the stream, which stops Claude Code; the partial reply is kept.

## Downloaded reels

The **Downloaded reels** tab shows a local folder of reels as cards: each `<id>.mp4` is paired with `<id>.json`
(`url`, plus `text` and `summary`, or `title` and `description` shown as text and summary; other fields are ignored). Click **Select folder** and pick the folder, e.g.
`~/Downloads/reels/rayshinlife/`. Files are read in the browser and never uploaded. In Chrome the last
folder is remembered; after a reload click **Reopen** to grant read access again.

**STT** on a card asks Claude Code for a Traditional Chinese (Taiwan) transcript and saves it into that reel's
JSON as `"stt"`. Claude Code runs local Whisper (`backend/app/reels/transcribe.py`, model `WHISPER_MODEL`,
default `medium`), proofreads the result using the reel's caption as context, and writes the field. The backend
then checks the JSON is valid with every other field unchanged, and restores the original file if not.

- For this the backend needs the folder too: it mounts `REELS_HOST_DIR` (default `~/Downloads/reels`)
  at `/reels`, and the picked folder must be directly inside it (e.g. `reels/rayshinlife`).
- One STT or V2T job runs at a time (`REEL_JOB_CONCURRENCY`); others queue. Jobs are kept in memory, so a
  backend restart or hot reload drops running jobs.
- The Whisper model downloads once into the `whisper-models` volume.

**V2T** asks Claude Code to explain what's in the video, in Traditional Chinese, saved as `"v2t"`: a summary
(概要), a timestamped scene list (畫面內容) and key points (重點). Claude Code can't watch video directly, so
`backend/app/reels/frames.py` extracts about 30 frames (768 px) spread over the video. Claude Code looks at each one,
and can pull extra frames around a moment, with the `stt` transcript (or the caption, if there's no transcript yet)
as context. Running STT first gives better results. It only sees the sampled moments, so quick actions between
frames can be missed. A 44 s reel takes about 75 s.

**Make video** asks which shape to make (9:16 or 16:9), then has Claude Code turn the reel's `text`, `summary`,
`stt` and `v2t` into a new explainer video in Japanese anime / manga style, with Traditional Chinese narration
(Microsoft's zh-TW neural voice via `edge-tts`, so the narration text is sent to Microsoft). Run STT and V2T first:
they're the source material. No subtitles, no progress bar, and only a few short labels on screen.

- Claude Code builds each video in `workspace/videos/<folder>/<id>-<aspect>/`: `storyboard.json` (scenes and
  narration), one HTML page per scene, and the rendered `video.mp4`. The card shows **Made videos** chips to play
  or download it. Making a video again replaces it once the new one is done.
- The toolkit is in `backend/app/reels/videokit/`. `kit/` has the style kit (anime.css, the `<a-chibi>`
  character and props in anime.js) and `GUIDE.md`, the rules Claude Code follows. `make.py` does
  `init` / `preview` / `render`. Rendering steps the scenes' CSS animations frame by frame (24 fps) in headless
  Chromium and encodes with ffmpeg, so a re-render gives the same video:

  ```bash
  docker compose -f docker-compose.dev.yml exec backend \
    python app/reels/videokit/make.py render /workspace/videos/<folder>/<id>-<aspect>
  ```
- If narration fails with a 403 from `speech.platform.bing.com`, Microsoft changed its handshake: update
  `edge-tts` in `backend/requirements.txt` and rebuild.

## YouTube

The **YouTube** tab downloads a channel's latest videos with `yt-dlp`. On the left, enter the channel
(`@handle`, `handle` or a channel URL) and pick how many (1–50), then click **Download**. It takes the Videos tab,
or the tab in the URL (e.g. `https://www.youtube.com/@handle/shorts`). Videos go into
`REELS_HOST_DIR/youtube-<handle>/` in the reels format: `<video id>.mp4` (H.264/AAC, up to 1080p) and
`<video id>.json` with `url`, `title` and `description`. Cards show up on the right as each video finishes,
with the same STT, V2T and Make video buttons as the **Downloaded reels** tab. You can also open the folder there.

- Videos already in the folder are skipped, so downloading again only fetches new ones.
- A video's file time is set to its upload time, so cards are listed newest first.
- Downloads are kept in memory like the other jobs, so a backend restart or hot reload stops a download in progress.
- yt-dlp needs a JavaScript runtime for YouTube; `deno` is installed from PyPI. If downloads start failing,
  YouTube has probably changed something: rebuild the backend to get the newest `yt-dlp`.
- Only download videos you own or have permission to download; YouTube's Terms of Service forbid other downloads.

## Development

Both apps hot reload: edit files under `frontend/src` (Vite HMR) or `backend/app` (uvicorn `--reload`).
The frontend calls the API via `/api`, which Vite proxies to the backend.

After changing dependencies, rebuild (`-V` gives the frontend a fresh `node_modules` volume):

```bash
docker compose -f docker-compose.dev.yml up --build -V
```

Reset the database and Claude sessions: `docker compose -f docker-compose.dev.yml down -v`
