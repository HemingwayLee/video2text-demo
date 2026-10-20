/* Anime-style SVG characters and props as custom elements (light DOM, so CSS animations reach them).

   <a-chibi expression="happy" pose="wave" hat="#fff" shirt="#6fa8dc" check flip></a-chibi>
     expression: smile | happy | surprised | thinking | wink | proud     (default smile)
     pose:       idle | wave | point | thumbs | cheer                    (default idle)
     hat:        hat colour, or "none"; hair: hair colour when there's no hat (default grey, an elder)
     shirt:      shirt colour; check: checked shirt; flip: face the other way
   <a-sun></a-sun>  <a-cloud></a-cloud>  <a-sparkle color="#ffd23f"></a-sparkle>  <a-sweat></a-sweat>
   <a-heart></a-heart>  <a-arrow color="#ffd23f"></a-arrow> (points right; rotate it with CSS)
   Size any of them with a width class (.w-30) or style="width: 30vmin". */

(() => {
  const INK = "#2b2118";
  const SKIN = "#ffe0c2";
  let uid = 0;

  const attr = (el, name, fallback) => (el.hasAttribute(name) ? el.getAttribute(name) || fallback : fallback);

  function define(name, render) {
    if (customElements.get(name)) return;
    customElements.define(
      name,
      class extends HTMLElement {
        connectedCallback() {
          this.innerHTML = render(this);
        }
      }
    );
  }

  // ---------- chibi farmer ----------

  const ARM_ENDS = {
    idle: [[54, 214], [146, 214]],
    wave: [[54, 214], [174, 104]],
    point: [[54, 214], [192, 160]],
    thumbs: [[54, 214], [164, 146]],
    cheer: [[26, 104], [174, 104]],
  };

  function arm([sx, sy], [ex, ey], shirt) {
    const cx = (sx + ex) / 2 + (ex > sx ? 6 : -6);
    const cy = Math.max(sy, ey) + 6;
    const d = `M${sx} ${sy} Q${cx} ${cy} ${ex} ${ey}`;
    return `<path d="${d}" fill="none" stroke="${INK}" stroke-width="25" stroke-linecap="round"/>
      <path d="${d}" fill="none" stroke="${shirt}" stroke-width="17" stroke-linecap="round"/>
      <circle cx="${ex}" cy="${ey}" r="11" fill="${SKIN}" class="ink"/>`;
  }

  function eyes(expression) {
    const open = (x, dy = 0, big = false) =>
      `<ellipse cx="${x}" cy="${104 + dy}" rx="${big ? 9.5 : 8}" ry="${big ? 13 : 11}" fill="${INK}"/>
       <circle cx="${x - 3}" cy="${99 + dy}" r="3.6" fill="#fff"/><circle cx="${x + 3}" cy="${109 + dy}" r="1.7" fill="#fff"/>`;
    const arcUp = (x) => `<path d="M${x - 10} 107 Q${x} 94 ${x + 10} 107" fill="none" class="ink" stroke-width="5"/>`;
    const arcDown = (x) => `<path d="M${x - 10} 101 Q${x} 111 ${x + 10} 101" fill="none" class="ink" stroke-width="5"/>`;
    switch (expression) {
      case "happy": return arcUp(78) + arcUp(122);
      case "proud": return arcDown(78) + arcDown(122);
      case "wink": return open(78) + arcUp(122);
      case "surprised": return open(78, 0, true) + open(122, 0, true);
      case "thinking": return open(78, -3) + open(122, -3);
      default: return open(78) + open(122);
    }
  }

  function mouth(expression) {
    switch (expression) {
      case "happy":
      case "wink":
        return `<path d="M86 122 Q100 144 114 122 Z" fill="#d9534f" class="ink"/>`;
      case "surprised":
        return `<ellipse cx="100" cy="131" rx="7" ry="9" fill="#d9534f" class="ink"/>`;
      case "thinking":
        return `<path d="M91 131 Q96 127 100 131 T109 131" fill="none" class="ink"/>`;
      case "proud":
        return `<path d="M86 124 Q100 138 114 124" fill="none" class="ink" stroke-width="5"/>`;
      default:
        return `<path d="M89 124 Q100 135 111 124" fill="none" class="ink"/>`;
    }
  }

  define("a-chibi", (el) => {
    const id = `chibi${uid++}`;
    const expression = attr(el, "expression", "smile");
    const pose = ARM_ENDS[attr(el, "pose", "idle")] ? attr(el, "pose", "idle") : "idle";
    const hat = attr(el, "hat", "#ffffff");
    const hair = attr(el, "hair", "#d9d9d9");
    const shirt = attr(el, "shirt", "#6fa8dc");
    const check = el.hasAttribute("check");
    const flip = el.hasAttribute("flip") ? ` style="transform: scaleX(-1)"` : "";
    const [left, right] = ARM_ENDS[pose];
    const shirtFill = check ? `url(#${id}-check)` : shirt;
    const brows =
      expression === "thinking"
        ? `<path d="M68 84 Q78 78 88 84" fill="none" stroke="#8a8a8a" stroke-width="5" stroke-linecap="round"/>
           <path d="M112 80 Q122 72 132 78" fill="none" stroke="#8a8a8a" stroke-width="5" stroke-linecap="round"/>`
        : `<path d="M68 85 Q78 80 88 85" fill="none" stroke="#8a8a8a" stroke-width="5" stroke-linecap="round"/>
           <path d="M112 85 Q122 80 132 85" fill="none" stroke="#8a8a8a" stroke-width="5" stroke-linecap="round"/>`;
    const head =
      hat === "none"
        ? `<path d="M46 92 Q48 40 100 40 Q152 40 154 92 Q140 66 100 64 Q60 66 46 92 Z" fill="${hair}" class="ink"/>`
        : `<ellipse cx="100" cy="62" rx="76" ry="15" fill="${hat}" class="ink"/>
           <path d="M56 62 C56 20 144 20 144 62 Z" fill="${hat}" class="ink"/>
           <path d="M57 52 Q100 60 143 52 L144 61 Q100 69 56 61 Z" fill="#c9a66b" class="ink" stroke-width="3"/>`;
    return `<svg viewBox="0 0 200 272"${flip}>
      <defs><pattern id="${id}-check" width="16" height="16" patternUnits="userSpaceOnUse">
        <rect width="16" height="16" fill="${shirt}"/><rect width="8" height="16" fill="#fff" opacity=".28"/>
        <rect width="16" height="8" fill="#fff" opacity=".28"/></pattern></defs>
      <rect x="70" y="232" width="26" height="26" rx="8" fill="#5b6b7d" class="ink"/>
      <rect x="104" y="232" width="26" height="26" rx="8" fill="#5b6b7d" class="ink"/>
      <ellipse cx="82" cy="262" rx="17" ry="7" fill="${INK}"/><ellipse cx="118" cy="262" rx="17" ry="7" fill="${INK}"/>
      ${arm([68, 164], left, shirtFill)}
      <path d="M64 150 C58 185 60 220 66 240 L134 240 C140 220 142 185 136 150 Q100 140 64 150 Z" fill="${shirtFill}" class="ink"/>
      <path d="M86 148 L100 168 L114 148 Z" fill="#fff" class="ink" stroke-width="3"/>
      <circle cx="100" cy="186" r="3" fill="${INK}"/><circle cx="100" cy="206" r="3" fill="${INK}"/>
      ${arm([132, 164], right, shirtFill)}
      ${pose === "thumbs" ? `<rect x="158" y="124" width="10" height="20" rx="5" fill="${SKIN}" class="ink" stroke-width="3"/>` : ""}
      <circle cx="44" cy="106" r="11" fill="${SKIN}" class="ink"/><circle cx="156" cy="106" r="11" fill="${SKIN}" class="ink"/>
      <circle cx="100" cy="100" r="56" fill="${SKIN}" class="ink"/>
      ${brows}${eyes(expression)}
      <ellipse cx="64" cy="122" rx="10" ry="5" fill="#ff9aa8" opacity=".75"/>
      <ellipse cx="136" cy="122" rx="10" ry="5" fill="#ff9aa8" opacity=".75"/>
      ${mouth(expression)}
      ${head}
    </svg>`;
  });

  // ---------- props ----------

  define("a-sun", () => {
    const rays = Array.from({ length: 12 }, (_, i) => {
      const a = (i * 30 * Math.PI) / 180;
      const p = (r, da) => `${100 + r * Math.cos(a + da)} ${100 + r * Math.sin(a + da)}`;
      return `<path d="M${p(52, -0.12)} L${p(84, 0)} L${p(52, 0.12)} Z" fill="#ffb627" class="ink" stroke-width="3"/>`;
    }).join("");
    return `<svg viewBox="0 0 200 200"><g class="svg-part spin">${rays}</g>
      <circle cx="100" cy="100" r="46" fill="#ffd23f" class="ink"/>
      <path d="M78 96 Q85 88 92 96 M108 96 Q115 88 122 96" fill="none" class="ink"/>
      <ellipse cx="74" cy="110" rx="7" ry="4" fill="#ff9aa8"/><ellipse cx="126" cy="110" rx="7" ry="4" fill="#ff9aa8"/>
      <path d="M88 112 Q100 124 112 112" fill="none" class="ink"/></svg>`;
  });

  define("a-cloud", () =>
    `<svg viewBox="0 0 220 124"><path d="M44 108 A30 30 0 0 1 52 50 A42 42 0 0 1 128 36 A34 34 0 0 1 186 62 A26 26 0 0 1 180 108 Z"
      fill="#fff" class="ink"/></svg>`);

  define("a-sparkle", (el) =>
    `<svg viewBox="0 0 100 100"><path d="M50 2 Q57 43 98 50 Q57 57 50 98 Q43 57 2 50 Q43 43 50 2 Z"
      fill="${attr(el, "color", "#ffd23f")}" class="ink"/></svg>`);

  define("a-sweat", () =>
    `<svg viewBox="0 0 60 90"><path d="M30 4 Q58 50 52 64 A23 23 0 0 1 8 64 Q2 50 30 4 Z" fill="#9bd8ff" class="ink"/>
      <ellipse cx="22" cy="60" rx="5" ry="9" fill="#fff" opacity=".8"/></svg>`);

  define("a-heart", (el) =>
    `<svg viewBox="0 0 100 90"><path d="M50 84 C10 58 4 36 14 20 C26 2 46 8 50 24 C54 8 74 2 86 20 C96 36 90 58 50 84 Z"
      fill="${attr(el, "color", "#ff6b8b")}" class="ink"/></svg>`);

  define("a-arrow", (el) =>
    `<svg viewBox="0 0 200 80"><path d="M8 28 H128 V8 L192 40 L128 72 V52 H8 Z"
      fill="${attr(el, "color", "#ffd23f")}" class="ink" stroke-width="5"/></svg>`);

  // The renderer injects its own __seek; this one makes scenes previewable in a normal browser too.
  if (!window.__seek) {
    window.__seek = (t) => {
      for (const a of document.getAnimations()) {
        a.pause();
        a.currentTime = t * 1000;
      }
      if (typeof window.renderAt === "function") window.renderAt(t);
    };
  }
})();
