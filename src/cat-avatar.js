const ATTENTION_STATUSES = new Set([
  "paused",
  "waiting_for_confirmation",
  "error",
  "stuck",
  "deleting",
]);

/** Decorative pose only; the adjacent controls remain the source of status text. */
export function catPose({ voice = {}, controller, busy = false } = {}) {
  if (
    voice.error ||
    voice.status === "error" ||
    ATTENTION_STATUSES.has(controller?.execution_status)
  )
    return "attention";
  if (voice.status === "speaking") return "speaking";
  if (
    busy ||
    voice.requestPending ||
    voice.status === "thinking" ||
    controller?.execution_status === "running"
  )
    return "working";
  if (voice.status === "connecting") return "waking";
  if (voice.status === "listening") return voice.muted ? "waking" : "listening";
  return "sleeping";
}

/** No IDs, external resources, or interpolated content: safe to mount more than once. */
export function catAvatarMarkup() {
  return `<svg viewBox="0 0 160 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
  <ellipse class="cat-avatar-rest" cx="81" cy="100" rx="64" ry="10"/>
  <ellipse class="cat-avatar-shadow" cx="82" cy="97" rx="48" ry="5"/>
  <g class="cat-avatar-body">
    <path class="cat-avatar-fur" d="M32 79C28 60 43 47 66 47C84 40 111 43 124 59C136 73 134 89 122 95C105 103 48 100 37 92C34 90 32 85 32 79Z"/>
    <path class="cat-avatar-haunch" d="M100 57C120 57 129 72 123 85C120 91 114 92 109 91"/>
    <path class="cat-avatar-stripe" d="M87 47L88 57M99 49L101 58M110 53L111 61"/>
  </g>
  <g class="cat-avatar-head">
    <g class="cat-avatar-ear cat-avatar-ear-left">
      <path class="cat-avatar-fur" d="M32 54L31 31Q31 27 35 29L51 43Z"/>
      <path class="cat-avatar-ear-inner" d="M36 46L35 35L45 43Z"/>
    </g>
    <g class="cat-avatar-ear cat-avatar-ear-right">
      <path class="cat-avatar-fur" d="M64 42L78 28Q82 25 82 31L79 55Z"/>
      <path class="cat-avatar-ear-inner" d="M70 43L78 34L77 47Z"/>
    </g>
    <path class="cat-avatar-fur" d="M31 55C32 44 43 38 55 39C69 37 81 45 82 58C83 73 72 84 56 84C40 84 29 73 31 55Z"/>
    <path class="cat-avatar-cheek" d="M36 64C40 59 48 60 55 64C62 60 72 60 77 65C74 77 66 80 56 80C45 80 38 74 36 64Z"/>
    <path class="cat-avatar-stripe" d="M51 40L53 48M61 40L59 48"/>
    <g class="cat-avatar-eyes-sleep cat-avatar-ink">
      <path d="M38 61Q43 66 48 61M63 61Q68 66 73 61"/>
    </g>
    <g class="cat-avatar-eyes-awake">
      <ellipse class="cat-avatar-eye" cx="44" cy="60" rx="2.8" ry="4"/>
      <ellipse class="cat-avatar-eye" cx="68" cy="60" rx="2.8" ry="4"/>
      <circle class="cat-avatar-glint" cx="45" cy="59" r=".8"/>
      <circle class="cat-avatar-glint" cx="69" cy="59" r=".8"/>
    </g>
    <path class="cat-avatar-brows cat-avatar-ink" d="M39 53L47 55M64 55L72 53"/>
    <path class="cat-avatar-nose" d="M52 67Q56 65 60 67L56 70Z"/>
    <path class="cat-avatar-mouth cat-avatar-ink" d="M56 70V72M50 72Q53 75 56 72Q59 75 62 72"/>
    <ellipse class="cat-avatar-mouth-speaking" cx="56" cy="74" rx="3" ry="2.4"/>
    <path class="cat-avatar-whiskers cat-avatar-ink" d="M41 69L26 66M40 73L25 74M71 69L86 66M72 73L87 74"/>
  </g>
  <g class="cat-avatar-paws">
    <path class="cat-avatar-paw" d="M48 86C45 82 38 83 36 88C34 93 38 96 47 95H60C63 90 57 85 48 86Z"/>
    <path class="cat-avatar-toes cat-avatar-ink" d="M41 90V93M46 90V93"/>
  </g>
  <path class="cat-avatar-tail" d="M120 72C138 75 138 96 116 99C101 101 82 98 74 95C69 93 72 87 78 88L102 91"/>
  <g class="cat-avatar-listening cat-avatar-ink">
    <path d="M100 29Q107 34 104 42M108 23Q120 32 114 47"/>
  </g>
  <g class="cat-avatar-working">
    <circle cx="108" cy="32" r="2"/><circle cx="118" cy="30" r="2"/><circle cx="128" cy="32" r="2"/>
  </g>
  <g class="cat-avatar-attention">
    <path d="M115 20L123 28L115 36L107 28Z"/>
    <path class="cat-avatar-ink" d="M115 24V29M115 32V32.1"/>
  </g>
</svg>`;
}

export const catAvatarStyles = `
.insider-cat-avatar{--cat-fur:#d5c9ac;--cat-fur-light:#eee3cc;--cat-ink:#424b43;--cat-sage:#a9ba9c;display:inline-flex;width:var(--insider-cat-avatar-size,144px);max-width:100%;aspect-ratio:4/3;flex:none;align-items:center;justify-content:center;pointer-events:none;user-select:none}
.insider-cat-avatar svg{display:block;width:100%;height:auto;overflow:visible}
.insider-cat-avatar .cat-avatar-rest{fill:#29322f;opacity:.7}
.insider-cat-avatar .cat-avatar-shadow{fill:#101915;opacity:.3}
.insider-cat-avatar .cat-avatar-fur{fill:var(--cat-fur)}
.insider-cat-avatar .cat-avatar-cheek,.insider-cat-avatar .cat-avatar-paw{fill:var(--cat-fur-light)}
.insider-cat-avatar .cat-avatar-ear-inner{fill:#b99786}
.insider-cat-avatar .cat-avatar-haunch{fill:none;stroke:#b3aa8f;stroke-width:2;stroke-linecap:round}
.insider-cat-avatar .cat-avatar-stripe{fill:none;stroke:#aa9f82;stroke-width:3;stroke-linecap:round;opacity:.6}
.insider-cat-avatar .cat-avatar-ink{fill:none;stroke:var(--cat-ink);stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
.insider-cat-avatar .cat-avatar-eye,.insider-cat-avatar .cat-avatar-mouth-speaking{fill:var(--cat-ink)}
.insider-cat-avatar .cat-avatar-glint{fill:var(--cat-fur-light)}
.insider-cat-avatar .cat-avatar-nose{fill:#a77f70}
.insider-cat-avatar .cat-avatar-whiskers{opacity:.55;stroke-width:1.1}
.insider-cat-avatar .cat-avatar-tail{fill:none;stroke:#bdb495;stroke-width:11;stroke-linecap:round;stroke-linejoin:round;transform-origin:120px 73px}
.insider-cat-avatar .cat-avatar-body{transform-origin:82px 98px}
.insider-cat-avatar .cat-avatar-head{transform-origin:57px 78px;transform:translateY(7px) rotate(-8deg);transition:transform .55s ease}
.insider-cat-avatar .cat-avatar-ear-left{transform-origin:41px 49px;transform:rotate(-10deg)}
.insider-cat-avatar .cat-avatar-ear-right{transform-origin:72px 49px;transform:rotate(12deg)}
.insider-cat-avatar .cat-avatar-ear{transition:transform .55s ease}
.insider-cat-avatar .cat-avatar-eyes-awake,.insider-cat-avatar .cat-avatar-mouth-speaking,.insider-cat-avatar .cat-avatar-brows,.insider-cat-avatar .cat-avatar-listening,.insider-cat-avatar .cat-avatar-working,.insider-cat-avatar .cat-avatar-attention{opacity:0}
.insider-cat-avatar .cat-avatar-listening{stroke:var(--cat-sage);stroke-width:2}
.insider-cat-avatar .cat-avatar-working{fill:var(--cat-sage)}
.insider-cat-avatar .cat-avatar-attention{fill:#d6af73}
.insider-cat-avatar[data-pose="sleeping"] .cat-avatar-body{animation:insider-cat-breathe 4.8s ease-in-out infinite}
.insider-cat-avatar[data-pose="waking"] .cat-avatar-head,.insider-cat-avatar[data-pose="listening"] .cat-avatar-head,.insider-cat-avatar[data-pose="speaking"] .cat-avatar-head,.insider-cat-avatar[data-pose="working"] .cat-avatar-head,.insider-cat-avatar[data-pose="attention"] .cat-avatar-head{transform:translateY(-2px)}
.insider-cat-avatar:not([data-pose="sleeping"]) .cat-avatar-ear{transform:rotate(0deg)}
.insider-cat-avatar:not([data-pose="sleeping"]) .cat-avatar-eyes-sleep{opacity:0}
.insider-cat-avatar:not([data-pose="sleeping"]) .cat-avatar-eyes-awake{opacity:1}
.insider-cat-avatar[data-pose="listening"] .cat-avatar-head{transform:translateY(-2px) rotate(5deg)}
.insider-cat-avatar[data-pose="listening"] .cat-avatar-listening{opacity:.8;animation:insider-cat-listen 2.8s ease-in-out infinite}
.insider-cat-avatar[data-pose="speaking"] .cat-avatar-mouth{opacity:0}
.insider-cat-avatar[data-pose="speaking"] .cat-avatar-mouth-speaking{opacity:1;transform-origin:56px 74px;animation:insider-cat-speak .75s ease-in-out infinite}
.insider-cat-avatar[data-pose="speaking"] .cat-avatar-head{animation:insider-cat-talk 2.4s ease-in-out infinite}
.insider-cat-avatar[data-pose="working"] .cat-avatar-brows,.insider-cat-avatar[data-pose="working"] .cat-avatar-working{opacity:1}
.insider-cat-avatar[data-pose="working"] .cat-avatar-tail{animation:insider-cat-tail 3.6s ease-in-out infinite}
.insider-cat-avatar[data-pose="working"] .cat-avatar-working circle{animation:insider-cat-think 2.1s ease-in-out infinite}
.insider-cat-avatar[data-pose="working"] .cat-avatar-working circle:nth-child(2){animation-delay:.2s}
.insider-cat-avatar[data-pose="working"] .cat-avatar-working circle:nth-child(3){animation-delay:.4s}
.insider-cat-avatar[data-pose="attention"] .cat-avatar-attention{opacity:1}
.insider-cat-avatar[data-pose="attention"] .cat-avatar-head{transform:translateY(-4px) rotate(-4deg)}
@keyframes insider-cat-breathe{0%,100%{transform:scaleY(1)}50%{transform:scaleY(1.025)}}
@keyframes insider-cat-listen{0%,100%{opacity:.45}50%{opacity:1}}
@keyframes insider-cat-speak{0%,100%{transform:scaleY(.6)}50%{transform:scaleY(1.1)}}
@keyframes insider-cat-talk{0%,100%{transform:translateY(-2px)}50%{transform:translateY(-3px) rotate(-2deg)}}
@keyframes insider-cat-tail{0%,100%{transform:rotate(0deg)}50%{transform:rotate(-3deg)}}
@keyframes insider-cat-think{0%,70%,100%{opacity:.4}35%{opacity:1}}
@media(prefers-reduced-motion:reduce){.insider-cat-avatar *{animation:none!important;transition:none!important}}
`;
