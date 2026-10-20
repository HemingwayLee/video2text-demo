"""Speech-to-text for one video with local Whisper, output in Traditional Chinese (Taiwan).

Usage: python /app/app/reels/transcribe.py <video> [--model medium]
Prints JSON to stdout: {"model", "language", "duration", "text", "segments": [{"start", "end", "text"}]}
"""

import argparse
import json
import os
import sys

import opencc
from faster_whisper import WhisperModel

# Nudges Whisper toward Traditional characters and punctuation; OpenCC then converts whatever is left.
INITIAL_PROMPT = "以下是台灣口語的繁體中文逐字稿，包含標點符號。"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("video")
    parser.add_argument("--model", default=os.environ.get("WHISPER_MODEL", "medium"))
    args = parser.parse_args()

    if not os.path.isfile(args.video):
        sys.exit(f"No such file: {args.video}")

    model = WhisperModel(args.model, device="cpu", compute_type="int8")
    segments, info = model.transcribe(
        args.video, language="zh", initial_prompt=INITIAL_PROMPT, vad_filter=True, beam_size=5
    )
    to_traditional = opencc.OpenCC("s2twp")
    out = [
        {"start": round(s.start, 2), "end": round(s.end, 2), "text": to_traditional.convert(s.text.strip())}
        for s in segments
    ]
    json.dump(
        {
            "model": args.model,
            "language": info.language,
            "duration": round(info.duration, 2),
            "text": "".join(s["text"] for s in out),
            "segments": out,
        },
        sys.stdout,
        ensure_ascii=False,
        indent=1,
    )
    print()


if __name__ == "__main__":
    main()
