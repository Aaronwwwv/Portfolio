import gsap from 'gsap';

// Tunnel zoom between a list page and one of its detail pages. Forward, the list rushes past the viewer around the point
// that was clicked while rings of the destination's accent fly out of it, then the detail page arrives from the depth;
// back is the same move reversed. sections.js decides when to use it and applies the route at the swap.
export const TUNNEL_FORWARD_MS = 1100;
export const TUNNEL_BACK_MS = 900;
const FORWARD_OUT_MS = 500; // outgoing page, then the route is applied and the incoming page takes the rest
const BACK_OUT_MS = 400;
const NEAR_SCALE = 1.35; // a page close to the viewer
const FAR_SCALE = 0.7; // a page deep in the tunnel
const EASE_OUT = 'expo.out'; // strong ease-out for the page that arrives
const EASE_AWAY = 'power2.inOut'; // the page that leaves keeps moving on screen until it is gone
const RINGS = 12;
const RING_PERIOD = 0.9; // s for one ring to travel from the vanishing point past the edge of the viewport
const RING_GROW = 2.6; // perspective: a ring's size is its progress to this power, so it accelerates as it nears
const RING_REACH = 1.2; // size of a ring at the end of its travel, relative to what covers the viewport from the origin
const RING_RADIUS = 0.06; // corner radius, as a share of the ring's smaller side
const RING_WIDTH = 1.5; // px
const RING_ALPHA = 0.6;
const RING_APPEAR = 0.08; // share of the travel over which a new ring fades in at the vanishing point
const TUNNEL_FADE_IN_MS = 150;
const TUNNEL_FADE_OUT_MS = 400; // the rings are gone by the end of the transition
const CLICK_GUARD_MS = 500; // a click that skipped the tunnel is not passed on to the page it lands on
const MAX_DPR = 2;
const CLEAR_PROPS = 'transform,opacity,transformOrigin,willChange';

// The default accent, read before any theme is set on <html>; a theme's accent comes from a probe carrying that theme.
const defaultAccent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
const probe = document.createElement('span');
probe.hidden = true;
document.body.append(probe);

const canvas = document.createElement('canvas');
canvas.id = 'tunnel-canvas';
canvas.setAttribute('aria-hidden', 'true');
document.body.append(canvas);
const context = canvas.getContext('2d');

// The rings: one shared state, set at the start of a tunnel and read by tick().
const rings = { alpha: 0, color: defaultAccent, x: 0, y: 0, width: 0, height: 0, start: 0, backward: false };
let timeline = null;
let pages = [];
let guardTimer = 0;

function accentOf(theme) {
  if (!theme) return defaultAccent;
  probe.dataset.theme = theme;
  return getComputedStyle(probe).getPropertyValue('--accent').trim() || defaultAccent;
}

function resize() {
  const ratio = Math.min(window.devicePixelRatio || 1, MAX_DPR);
  canvas.width = Math.round(window.innerWidth * ratio);
  canvas.height = Math.round(window.innerHeight * ratio);
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function roundedRect(x, y, width, height, radius) {
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}

function tick(time) {
  context.clearRect(0, 0, window.innerWidth, window.innerHeight);
  if (rings.alpha <= 0) return;
  const elapsed = time - rings.start;
  context.strokeStyle = rings.color;
  context.lineWidth = RING_WIDTH;
  for (let index = 0; index < RINGS; index += 1) {
    let progress = (elapsed / RING_PERIOD + index / RINGS) % 1;
    if (rings.backward) progress = 1 - progress; // the rings contract toward the vanishing point
    const size = progress ** RING_GROW;
    const width = rings.width * size;
    const height = rings.height * size;
    if (width < 1) continue;
    // Born faint at the vanishing point, fading out as it grows past the viewer.
    const fade = Math.min(1, progress / RING_APPEAR) * (1 - progress);
    context.globalAlpha = rings.alpha * RING_ALPHA * fade;
    context.beginPath();
    roundedRect(rings.x - width / 2, rings.y - height / 2, width, height, Math.min(width, height) * RING_RADIUS);
    context.stroke();
  }
}

function swallow(event) {
  event.preventDefault();
  event.stopImmediatePropagation();
}

// Any key or press during a tunnel ends it at once, in its end state; the event itself goes no further.
function skip(event) {
  swallow(event);
  if (event.type === 'pointerdown') {
    window.addEventListener('click', swallow, { capture: true, once: true });
    guardTimer = window.setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), CLICK_GUARD_MS);
  }
  finishTunnel();
}

function end() {
  gsap.set(pages, { clearProps: CLEAR_PROPS });
  pages = [];
  rings.alpha = 0;
  gsap.ticker.remove(tick);
  context.clearRect(0, 0, window.innerWidth, window.innerHeight);
  canvas.classList.remove('is-running');
  window.removeEventListener('pointerdown', skip, true);
  window.removeEventListener('keydown', skip, true);
  timeline = null;
}

export function tunnelRunning() {
  return timeline !== null;
}

// Jumps a running tunnel to its end: the route is applied if it was not yet, and the pages are left at rest.
export function finishTunnel() {
  if (timeline) timeline.progress(1);
}

function originOf(element, origin) {
  const box = element.getBoundingClientRect();
  return `${origin.x - box.left}px ${origin.y - box.top}px`;
}

// direction 1 goes deeper (list to detail), -1 comes back. swap() applies the route; incoming is the page it reveals.
export function runTunnel({ direction, outgoing, incoming, origin, theme, swap }) {
  finishTunnel();
  window.clearTimeout(guardTimer);
  const forward = direction > 0;
  const total = (forward ? TUNNEL_FORWARD_MS : TUNNEL_BACK_MS) / 1000;
  const away = (forward ? FORWARD_OUT_MS : BACK_OUT_MS) / 1000;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  // Ring geometry for the whole tunnel: large enough at the end of its travel to clear the viewport from the origin.
  Object.assign(rings, {
    color: accentOf(theme),
    x: origin.x,
    y: origin.y,
    width: 2 * Math.max(origin.x, viewportWidth - origin.x) * RING_REACH,
    height: 2 * Math.max(origin.y, viewportHeight - origin.y) * RING_REACH,
    start: gsap.ticker.time,
    backward: !forward,
    alpha: 0,
  });
  pages = [outgoing, incoming];
  canvas.classList.add('is-running');
  gsap.ticker.add(tick);
  window.addEventListener('pointerdown', skip, true);
  window.addEventListener('keydown', skip, true);

  gsap.set(outgoing, { transformOrigin: originOf(outgoing, origin), willChange: 'transform, opacity' });
  timeline = gsap.timeline({ onComplete: end })
    .to(rings, { alpha: 1, duration: TUNNEL_FADE_IN_MS / 1000, ease: 'power1.out' }, 0)
    .to(outgoing, { scale: forward ? NEAR_SCALE : FAR_SCALE, opacity: 0, duration: away, ease: EASE_AWAY }, 0)
    .add(() => {
      gsap.set(outgoing, { clearProps: CLEAR_PROPS });
      swap();
      // Measured once shown, so it grows around the same point of the screen.
      gsap.set(incoming, { transformOrigin: originOf(incoming, origin), willChange: 'transform, opacity' });
    }, away)
    .fromTo(
      incoming,
      { scale: forward ? FAR_SCALE : NEAR_SCALE, opacity: 0 },
      { scale: 1, opacity: 1, duration: total - away, ease: EASE_OUT, immediateRender: false },
      away,
    )
    .to(rings, { alpha: 0, duration: TUNNEL_FADE_OUT_MS / 1000, ease: 'power1.in' }, total - TUNNEL_FADE_OUT_MS / 1000);
}

resize();
window.addEventListener('resize', resize);

// Dev server only (Vite drops this from the build): lets a test hold the tunnel at a given time for screenshots.
if (import.meta.env.DEV) window.__tunnelDebug = { timeline: () => timeline };
