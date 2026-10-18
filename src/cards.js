import gsap from 'gsap';
import { cursorState } from './cursor.js';
import { lenis } from './scroll.js';
import { tiltWriter } from './experience.js';
import { warpRunning } from './warp.js';

// Cards of the detail pages lean toward the paint blob (cursorState), not the raw pointer: the side nearest the blob
// sinks, up to CARD_TILT_MAX on each axis, less the further the blob is, flat again once it is out of reach or gone.
// Their tinted shadow slides the other way. Card boxes are read on init, resize, Lenis scroll, page change and at the
// end of a warp, never per frame; the frame only moves the cached boxes by the Lenis scroll since they were read.
// Fine pointers only, never under reduced motion; keyboard focus gets a fixed lift from style.css instead.
const CARD_TILT_MAX = 6; // deg
const CARD_PERSPECTIVE = 900; // px
const CARD_REACH = 320; // px from a card's edge: further than this the blob leaves the card flat
const CARD_FOLLOW = 0.1; // share of the way to the target tilt per frame at 60 fps
const CARD_SETTLED = 0.01; // deg, below this the tilt snaps to its target
const CARD_SHADOW_SHIFT = 8; // px the shadow slides at full tilt

const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

// Per card: its box in page coordinates (top includes the scroll it was read at), the current and target angles.
const cards = [...document.querySelectorAll('.detail .card')].map((element) => ({
  element,
  writer: tiltWriter(element, CARD_PERSPECTIVE),
  left: 0,
  top: 0,
  width: 0,
  height: 0,
  rx: 0,
  ry: 0,
}));

function measure() {
  const scroll = lenis.scroll;
  for (let n = 0; n < cards.length; n += 1) {
    const card = cards[n];
    const box = card.element.getBoundingClientRect();
    card.left = box.left;
    card.top = box.top + scroll;
    card.width = box.width;
    card.height = box.height;
  }
}

// A page change leaves the hidden cards flat at once.
function reset() {
  for (let n = 0; n < cards.length; n += 1) {
    const card = cards[n];
    if (card.rx !== 0 || card.ry !== 0) card.writer.clear();
    card.rx = 0;
    card.ry = 0;
  }
  measure();
}

function tick(time, deltaTime) {
  const follow = 1 - (1 - CARD_FOLLOW) ** (Math.min(deltaTime, 100) / (1000 / 60));
  const lean = finePointer.matches && !reducedMotion.matches && cursorState.active && !warpRunning();
  const scroll = lenis.scroll;
  for (let n = 0; n < cards.length; n += 1) {
    const card = cards[n];
    if (card.width === 0) continue; // on a hidden page
    let tx = 0;
    let ty = 0;
    if (lean) {
      const halfWidth = card.width / 2;
      const halfHeight = card.height / 2;
      const dx = cursorState.x - (card.left + halfWidth);
      const dy = cursorState.y - (card.top - scroll + halfHeight);
      const outX = Math.max(0, Math.abs(dx) - halfWidth);
      const outY = Math.max(0, Math.abs(dy) - halfHeight);
      const fall = Math.max(0, 1 - Math.sqrt(outX * outX + outY * outY) / CARD_REACH);
      if (fall > 0) {
        ty = Math.max(-1, Math.min(1, dx / halfWidth)) * CARD_TILT_MAX * fall;
        tx = -Math.max(-1, Math.min(1, dy / halfHeight)) * CARD_TILT_MAX * fall;
      }
    }
    if (card.rx === tx && card.ry === ty) continue;
    card.rx += (tx - card.rx) * follow;
    card.ry += (ty - card.ry) * follow;
    if (Math.abs(tx - card.rx) < CARD_SETTLED && Math.abs(ty - card.ry) < CARD_SETTLED) {
      card.rx = tx;
      card.ry = ty;
    }
    if (card.rx === 0 && card.ry === 0) card.writer.clear();
    else card.writer.set(card.rx, card.ry, (-card.ry / CARD_TILT_MAX) * CARD_SHADOW_SHIFT, (card.rx / CARD_TILT_MAX) * CARD_SHADOW_SHIFT);
  }
}

if (cards.length) {
  window.addEventListener('resize', measure);
  lenis.on('scroll', measure);
  window.addEventListener('section:change', reset);
  window.addEventListener('warp:end', measure);
  const observer = new ResizeObserver(measure);
  cards.forEach((card) => observer.observe(card.element));
  reducedMotion.addEventListener('change', reset);
  finePointer.addEventListener('change', reset);
  measure();
  gsap.ticker.add(tick);
}
