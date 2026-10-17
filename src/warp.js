import gsap from 'gsap';
import { startWarp, finishWarp, WARP_FORWARD_MS, WARP_BACK_MS } from './swarm.js';

// Starfield warp between a list page and one of its detail pages. The swarm's particles become the stars (swarm.js);
// here the outgoing page drifts toward the viewer and fades, the route is applied at the swap, and the incoming page
// settles in from the depth. Back is the same move mirrored. sections.js decides when to use it.
const FORWARD_SWAP_MS = 500; // the route is applied here, so the swarm takes the new page's colour mid-flight
const BACK_SWAP_MS = 400;
const FORWARD_OUT_MS = 450; // the outgoing page is gone by then
const BACK_OUT_MS = 350;
const FORWARD_IN_AT_MS = 600; // the incoming page starts to appear here and lands at the end of the warp
const BACK_IN_AT_MS = 500;
const PAGE_SCALE = 1.15; // a page close to the viewer
const PAGE_DEPTH = 0.9; // a page far in the field
const EASE_ARRIVE = 'expo.out'; // strong ease-out for the page that arrives
const EASE_LEAVE = 'power2.inOut'; // the page that leaves keeps moving on screen until it is gone
const CLICK_GUARD_MS = 500; // a click that skipped the warp is not passed on to the page it lands on
const CLEAR_PROPS = 'transform,opacity,transformOrigin,willChange';
const END_EVENT = 'warp:end'; // sent on window once a warp has settled, for work that would cost frames during it

let timeline = null;
let pages = [];
let guardTimer = 0;

function swallow(event) {
  event.preventDefault();
  event.stopImmediatePropagation();
}

// Any key or press during a warp ends it at once, in its end state; the event itself goes no further.
function skip(event) {
  swallow(event);
  if (event.type === 'pointerdown') {
    window.addEventListener('click', swallow, { capture: true, once: true });
    guardTimer = window.setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), CLICK_GUARD_MS);
  }
  finishTransition();
}

function end() {
  gsap.set(pages, { clearProps: CLEAR_PROPS });
  pages = [];
  window.removeEventListener('pointerdown', skip, true);
  window.removeEventListener('keydown', skip, true);
  timeline = null;
  window.dispatchEvent(new Event(END_EVENT));
}

export function warpRunning() {
  return timeline !== null;
}

// Jumps a running warp to its end: the route is applied if it was not yet, the stars settle and the pages rest.
export function finishTransition() {
  if (!timeline) return;
  timeline.progress(1);
  finishWarp();
}

function originOf(element, origin) {
  const box = element.getBoundingClientRect();
  return `${origin.x - box.left}px ${origin.y - box.top}px`;
}

// direction 1 goes deeper (list to detail), -1 comes back. swap() applies the route; incoming is the page it reveals.
export function runWarp({ direction, outgoing, incoming, origin, swap }) {
  finishTransition();
  window.clearTimeout(guardTimer);
  const forward = direction > 0;
  const total = (forward ? WARP_FORWARD_MS : WARP_BACK_MS) / 1000;
  const swapAt = (forward ? FORWARD_SWAP_MS : BACK_SWAP_MS) / 1000;
  const away = (forward ? FORWARD_OUT_MS : BACK_OUT_MS) / 1000;
  const arriveAt = (forward ? FORWARD_IN_AT_MS : BACK_IN_AT_MS) / 1000;

  pages = [outgoing, incoming];
  window.addEventListener('pointerdown', skip, true);
  window.addEventListener('keydown', skip, true);
  startWarp(origin.x, origin.y, direction);

  gsap.set(outgoing, { transformOrigin: originOf(outgoing, origin), willChange: 'transform, opacity' });
  timeline = gsap.timeline({ onComplete: end })
    .to(outgoing, { scale: forward ? PAGE_SCALE : PAGE_DEPTH, opacity: 0, duration: away, ease: EASE_LEAVE }, 0)
    .add(() => {
      gsap.set(outgoing, { clearProps: CLEAR_PROPS });
      swap();
      // Measured once shown, so it settles around the same point of the screen; hidden until it starts to appear.
      gsap.set(incoming, { transformOrigin: originOf(incoming, origin), willChange: 'transform, opacity', opacity: 0 });
    }, swapAt)
    .fromTo(
      incoming,
      { scale: forward ? PAGE_DEPTH : PAGE_SCALE, opacity: 0 },
      { scale: 1, opacity: 1, duration: total - arriveAt, ease: EASE_ARRIVE, immediateRender: false },
      arriveAt,
    );
}

// Dev server only (Vite drops this from the build): lets a test hold the warp at a given time for screenshots.
if (import.meta.env.DEV) window.__warpDebug = { timeline: () => timeline };
