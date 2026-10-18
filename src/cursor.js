import gsap from 'gsap';

// Paint blob that trails the pointer like a drop of thick paint: it lags, resists fast moves, stretches along its motion
// and swells over anything clickable. The real cursor stays visible. Fine pointers only, never under reduced motion.
// cursorState is shared with the swarm and the RUGTRAAK contour lines, which read the blob, not the raw pointer.
const CURSOR_SIZE = 22; // px, diameter at rest; style.css draws the blob at this size
const CURSOR_FOLLOW = 0.2; // share of the distance to the pointer covered per frame at 60 fps, at rest
const CURSOR_VISCOSITY = 0.029; // the follow share is divided by 1 + this * pointer speed (px per frame)
const CURSOR_SPEED_SMOOTHING = 0.25; // share of a new pointer speed reading taken per frame
const CURSOR_STRETCH_MAX = 1.5; // longest stretch along the motion
const CURSOR_STRETCH_GAIN = 0.03; // stretch per px per frame of blob speed
const CURSOR_SQUASH = 0.4; // the width shrinks by this share of the stretch: 0.8 at the longest stretch
const CURSOR_SETTLE = 0.22; // share of the way back to its target stretch per frame: round again within about 0.3 s
const CURSOR_TURN_MIN_SPEED = 0.15; // px per frame below which the stretch keeps its last direction
const HOVER_SCALE = 1.8; // over something clickable
const HOVER_FOLLOW = 0.2; // share of the way to the hover scale per frame
const CHARGE_GROWTH = 0.25; // fully charged, the blob is this much larger
const CHARGE_STEP = 0.004; // the glow is written only when the charge moved by more than this
const HOVER_SELECTOR = 'a, button, .menu-btn, .exp-link, #bubble-stage';
const VISIBLE_CLASS = 'is-visible';
const HOVER_CLASS = 'is-hover';

// x, y: the lagging blob centre in viewport px; vx, vy: its velocity in px per frame; active: a fine pointer was seen;
// charge: 0..1, set by the swarm when particles dock in the blob.
export const cursorState = { x: window.innerWidth / 2, y: window.innerHeight / 2, vx: 0, vy: 0, active: false, charge: 0 };

const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function createBlob() {
  const blob = document.createElement('div');
  blob.id = 'cursor-blob';
  blob.setAttribute('aria-hidden', 'true');
  document.body.append(blob);

  // The transform is written each frame through CSS Typed OM objects made once and changed in place, so no string is
  // built per frame; browsers without Typed OM get a string instead.
  const typed = 'attributeStyleMap' in blob && typeof CSSTranslate === 'function';
  const translate = typed ? new CSSTranslate(CSS.px(0), CSS.px(0)) : null;
  const rotate = typed ? new CSSRotate(CSS.rad(0)) : null;
  const scale = typed ? new CSSScale(CSS.number(1), CSS.number(1)) : null;
  const transform = typed ? new CSSTransformValue([translate, rotate, scale]) : null;
  // --charge is a registered <number> in style.css, so it takes a typed value too, where the browser allows it.
  const charge = typed ? CSS.number(0) : null;
  let typedCharge = typed;
  try {
    if (typed) blob.attributeStyleMap.set('--charge', charge);
  } catch {
    typedCharge = false;
  }

  let pointerX = cursorState.x;
  let pointerY = cursorState.y;
  let lastPointerX = pointerX;
  let lastPointerY = pointerY;
  let pointerSpeed = 0;
  let stretch = 1;
  let angle = 0;
  let hoverScale = 1;
  let hovering = false;
  let inside = false;
  let visible = false;
  let writtenCharge = 0;

  window.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'touch') return;
    pointerX = event.clientX;
    pointerY = event.clientY;
    if (!cursorState.active) {
      // First sight of the pointer: the blob starts on it rather than flying in from the middle.
      cursorState.x = pointerX;
      cursorState.y = pointerY;
      lastPointerX = pointerX;
      lastPointerY = pointerY;
      cursorState.active = true;
    }
    inside = true;
  }, { passive: true });
  // One delegated listener for the hover state, whatever is under the pointer.
  document.addEventListener('pointerover', (event) => {
    const over = Boolean(event.target.closest?.(HOVER_SELECTOR));
    if (over !== hovering) {
      hovering = over;
      blob.classList.toggle(HOVER_CLASS, over);
    }
  });
  document.addEventListener('pointerout', (event) => {
    if (!event.relatedTarget) inside = false; // left the window
  });

  function tick(time, deltaTime) {
    const frames = Math.min(deltaTime, 100) / (1000 / 60);
    if (frames <= 0) return;
    // Pointer speed, smoothed: the faster the hand, the thicker the paint.
    const moved = Math.hypot(pointerX - lastPointerX, pointerY - lastPointerY) / frames;
    lastPointerX = pointerX;
    lastPointerY = pointerY;
    pointerSpeed += (moved - pointerSpeed) * (1 - (1 - CURSOR_SPEED_SMOOTHING) ** frames);
    const follow = 1 - (1 - CURSOR_FOLLOW / (1 + CURSOR_VISCOSITY * pointerSpeed)) ** frames;
    const nextX = cursorState.active ? cursorState.x + (pointerX - cursorState.x) * follow : cursorState.x;
    const nextY = cursorState.active ? cursorState.y + (pointerY - cursorState.y) * follow : cursorState.y;
    cursorState.vx = (nextX - cursorState.x) / frames;
    cursorState.vy = (nextY - cursorState.y) / frames;
    cursorState.x = nextX;
    cursorState.y = nextY;

    const speed = Math.hypot(cursorState.vx, cursorState.vy);
    if (speed > CURSOR_TURN_MIN_SPEED) angle = Math.atan2(cursorState.vy, cursorState.vx);
    const settle = 1 - (1 - CURSOR_SETTLE) ** frames;
    stretch += (Math.min(CURSOR_STRETCH_MAX, 1 + speed * CURSOR_STRETCH_GAIN) - stretch) * settle;
    hoverScale += ((hovering ? HOVER_SCALE : 1) - hoverScale) * (1 - (1 - HOVER_FOLLOW) ** frames);
    const size = hoverScale * (1 + CHARGE_GROWTH * cursorState.charge);
    const scaleX = size * stretch;
    const scaleY = size * (1 - (stretch - 1) * CURSOR_SQUASH);
    const left = cursorState.x - CURSOR_SIZE / 2;
    const top = cursorState.y - CURSOR_SIZE / 2;

    if (typed) {
      translate.x.value = left;
      translate.y.value = top;
      rotate.angle.value = angle;
      scale.x.value = scaleX;
      scale.y.value = scaleY;
      blob.attributeStyleMap.set('transform', transform);
    } else {
      blob.style.transform = `translate(${left}px, ${top}px) rotate(${angle}rad) scale(${scaleX}, ${scaleY})`;
    }
    if (Math.abs(cursorState.charge - writtenCharge) > CHARGE_STEP || (cursorState.charge === 0 && writtenCharge !== 0)) {
      writtenCharge = cursorState.charge;
      if (typedCharge) {
        charge.value = writtenCharge;
        blob.attributeStyleMap.set('--charge', charge);
      } else {
        blob.style.setProperty('--charge', String(writtenCharge));
      }
    }
    // Shown while the pointer is in the window, or while the swarm charges it before any pointer was seen.
    const show = (cursorState.active && inside) || cursorState.charge > 0;
    if (show !== visible) {
      visible = show;
      blob.classList.toggle(VISIBLE_CLASS, show);
    }
  }

  // First in the ticker, so the swarm and the contour lines read this frame's position.
  gsap.ticker.add(tick, false, true);
}

if (finePointer && !reducedMotion) createBlob();
