"""Extract still frames from a video so Claude Code can look at them.

Usage: python /app/app/reels/frames.py <video> <out_dir> [--every SECONDS] [--start S] [--end S] [--max N]
Without --every, frames are spread evenly so there are at most --max of them (default 30).
Prints JSON to stdout: {"duration", "frames": [{"time", "path"}]}
"""

import argparse
import json
import os
import sys

import av

LONG_SIDE = 768  # px; enough detail for scenes and on-screen text, fewer image tokens


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("video")
    parser.add_argument("out_dir")
    parser.add_argument("--every", type=float, help="seconds between frames")
    parser.add_argument("--start", type=float, default=0.0)
    parser.add_argument("--end", type=float)
    parser.add_argument("--max", type=int, default=30)
    args = parser.parse_args()

    if not os.path.isfile(args.video):
        sys.exit(f"No such file: {args.video}")
    os.makedirs(args.out_dir, exist_ok=True)

    with av.open(args.video) as container:
        stream = container.streams.video[0]
        duration = float(container.duration / av.time_base) if container.duration else float(stream.duration * stream.time_base)
        end = min(args.end if args.end is not None else duration, duration)
        span = max(end - args.start, 0.0)
        every = args.every or max(span / args.max, 2.0)
        times = [args.start + every * (i + 0.5) for i in range(args.max) if args.start + every * (i + 0.5) < end]

        frames = []
        for t in times:
            # Seek to the keyframe before t, then decode forward to the first frame at or after t.
            container.seek(int(t / stream.time_base), stream=stream, backward=True)
            for frame in container.decode(stream):
                if frame.time is None or frame.time >= t:
                    break
            else:
                continue
            image = frame.to_image()
            image.thumbnail((LONG_SIDE, LONG_SIDE))
            path = os.path.join(args.out_dir, f"frame_{int(t // 60):02d}m{t % 60:05.2f}s.jpg")
            image.save(path, quality=85)
            frames.append({"time": round(t, 2), "path": path})

    json.dump({"duration": round(duration, 2), "frames": frames}, sys.stdout, indent=1)
    print()


if __name__ == "__main__":
    main()
