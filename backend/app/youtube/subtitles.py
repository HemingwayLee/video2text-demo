"""A YouTube video's own subtitles as plain text, so STT can skip Whisper when the uploader already wrote them.

Only subtitles the uploader added count; YouTube's auto-generated captions don't. Chinese subtitles are preferred
(converted to Traditional Chinese, Taiwan), then the video's own language, then any other.
"""

import json
import re
from typing import Any

import opencc
from yt_dlp import YoutubeDL

ZH_ORDER = ("zh-TW", "zh-Hant", "zh-HK", "zh", "zh-Hans", "zh-CN")
TAG_RE = re.compile(r"<[^>]+>")


def _pick_language(subtitles: dict[str, Any], video_language: str | None) -> str | None:
    langs = [lang for lang in subtitles if lang != "live_chat"]
    base = (video_language or "").split("-")[0]
    candidates = [
        *(lang for lang in ZH_ORDER if lang in langs),
        *(lang for lang in langs if lang.startswith("zh")),
        *(lang for lang in langs if base and lang.split("-")[0] == base),
        *langs,
    ]
    return candidates[0] if candidates else None


def _json3_lines(raw: str) -> list[str]:
    events = json.loads(raw).get("events") or []
    return ["".join(seg.get("utf8", "") for seg in event.get("segs") or []) for event in events]


def _vtt_lines(raw: str) -> list[str]:
    lines = []
    for line in raw.splitlines():
        line = line.strip()
        if not line or line == "WEBVTT" or "-->" in line or line.isdigit() or line.startswith(("NOTE", "Kind:", "Language:")):
            continue
        lines.append(TAG_RE.sub("", line))
    return lines


def fetch(url: str) -> tuple[str, str] | None:
    """(language, text) of the video's subtitles, or None if it has none."""
    with YoutubeDL({"quiet": True, "no_warnings": True, "skip_download": True, "noplaylist": True}) as ydl:
        info = ydl.extract_info(url, download=False)
        subtitles = info.get("subtitles") or {}
        lang = _pick_language(subtitles, info.get("language"))
        if lang is None:
            return None
        formats = {f.get("ext"): f for f in subtitles[lang] if f.get("url")}
        if fmt := formats.get("json3"):
            parse = _json3_lines
        elif fmt := formats.get("vtt"):
            parse = _vtt_lines
        else:
            return None
        raw = ydl.urlopen(fmt["url"]).read().decode("utf-8")

    lines, previous = [], None
    for line in parse(raw):
        line = line.strip()
        if line and line != previous:  # VTT cues often repeat the previous line
            lines.append(line)
        previous = line or previous
    text = "\n".join(lines)
    if not text:
        return None
    if lang.startswith("zh"):
        text = opencc.OpenCC("s2twp").convert(text)
    return lang, text
