# Scene kit guide

Every scene is one HTML page in the project folder that links `kit/anime.css` and `kit/anime.js` (copy the
structure of `s01.html`). The renderer opens it at 1080×1920 (9:16) or 1920×1080 (16:9) and records it for as
long as the scene's narration lasts. Write CSS sizes in `vmin` so a scene fits either shape.

## Look: Japanese anime / manga

Flat pastel colours, thick dark outlines (`var(--ink)`, `class="ink"` on SVG shapes), hard offset shadows,
round friendly shapes, and manga effects: screentone dots, sunbursts, speed lines, sparkles, sweat drops,
stamps, speech bubbles. Characters are chibi (big head, small body). Keep one consistent narrator character
across scenes, e.g. the same `<a-chibi>` hat and shirt, matching the person in the reel when it's known.

## Building blocks (anime.css / anime.js)

| What | How |
| --- | --- |
| Stage | `<main class="stage bg-…">` fills the frame and centres its children. Add `<div class="ground"></div>` for a hill (`.ground.soil` for dirt). |
| Backgrounds | `bg-sky`, `bg-paper`, `bg-screentone` (manga dots), `bg-sunburst` (spinning rays), `bg-speedlines` (emphasis), `bg-pink`, `bg-yellow`, `bg-mint` |
| Layout | `.split` (side by side in 16:9, stacked in 9:16), `.row`, `.col`, `.abs` + your own top/left, widths `.w-10` … `.w-80` (vmin) |
| Characters | `<a-chibi expression="smile\|happy\|surprised\|thinking\|wink\|proud" pose="idle\|wave\|point\|thumbs\|cheer" hat="#fff" shirt="#6fa8dc" check flip>` |
| Props | `<a-sun>`, `<a-cloud>`, `<a-sparkle color>`, `<a-sweat>`, `<a-heart color>`, `<a-arrow color>` (points right; rotate with CSS) |
| Text | `.title` (big outlined, `.small`, `.yellow`, `.pink`, `.green`), `.tag` (pill label), `.bubble` (speech bubble, `.tail-left/.tail-right`), `.burst > span` (spiky shout), `.badge` (step number) |
| Frames | `.card` (rounded), `.panel` (manga panel, `.tilt-l/.tilt-r`), `.no-sign` (red ⃠ over something), `.ok-ring` (green ring) |
| Entrances | `.pop`, `.bounce-in`, `.slide-l`, `.slide-r`, `.slide-up`, `.fade-in`, `.zoom-in`, `.stamp`, delayed with `.d1` … `.d12` (0.35 s steps) |
| Loops | `.float`, `.wiggle`, `.spin`, `.pulse`, `.twinkle`, `.shake`, `.bob`, `.sway`; `.ken-burns` on the stage for a slow push-in |

One animation per element: to combine an entrance with a loop, nest them
(`<div class="pop d2"><a-sparkle class="w-10 twinkle"></a-sparkle></div>`).

Draw anything else (plants, vegetables, fruit, tools, soil cross-sections, diagrams) as inline SVG in the same
style: simple shapes, `fill` with flat colours, `class="ink"` for the outline. To animate part of an SVG, give it
`class="svg-part wiggle"` (or any loop class) so it turns around its own centre.

## Timing

- Use only CSS animations and transitions (or define `window.renderAt = (t) => { … }` to drive things from
  the scene time `t` in seconds). Don't use `setTimeout`, `setInterval` or `requestAnimationFrame`: the renderer
  steps time itself, so those wouldn't run.
- `window.SCENE_DURATION` holds the scene's length in seconds. Stagger entrances over the first 1–3 s and
  keep something gently moving (float, bob, twinkle) for the rest of the scene.
- The renderer fades each scene in and out; don't add your own fades at the edges.

## Rules for these videos

- **No subtitles**: never put the narration on screen.
- **No progress bar**, timeline, scene counter or page numbers.
- **Little text**: at most two short text elements per scene (a title, a label or a bubble), each about
  2–8 Chinese characters. Explain with pictures, arrows, rings and characters instead of words.
- Text in Traditional Chinese (Taiwan).
- Nothing important within 5vmin of the frame edges.
