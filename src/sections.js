import gsap from 'gsap';
import { lenis } from './scroll.js';

// Hash routing: "#parcours" shows one tab, "#projets/rugtraak" shows a project detail page.
// Wheel, swipe and arrow keys step through the tabs once the current one is scrolled to its edge.
const ORDER = ['accueil', 'parcours', 'projets', 'contact'];
const EDGE_TOLERANCE = 4; // px
const SHIFT = 40; // px travelled by a section as it leaves or enters
const WHEEL_MIN_DELTA = 30;
const WHEEL_LOCK = 900; // ms after a transition during which the wheel is ignored
const WHEEL_QUIET = 150; // ms without any wheel event that ends a gesture (trackpad momentum included)
const SWIPE_MIN = 60; // px

const views = document.querySelectorAll('main > section');
const navLinks = document.querySelectorAll('.site-nav a');
const projectList = document.getElementById('projets-liste');
const projectDetails = document.querySelectorAll('#projets > section');
const bubbleStage = document.getElementById('bubble-stage');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

let current = readRoute();
let shownIndex = ORDER.indexOf(current.view);
let timeline = null;

function readRoute() {
  const [view, detail] = window.location.hash.replace(/^#/, '').split('/');
  return { view: ORDER.includes(view) ? view : ORDER[0], detail };
}

function detailOf(route) {
  return route.view === 'projets' && route.detail ? document.getElementById(`projet-${route.detail}`) : null;
}

function markNav(route) {
  navLinks.forEach((link) => {
    const active = link.getAttribute('href') === `#${route.view}`;
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}

// Puts the DOM in the state of the route, at once, scrolled back to the top.
function apply(route) {
  const detail = detailOf(route);
  views.forEach((section) => { section.hidden = section.id !== route.view; });
  projectList.hidden = detail !== null;
  projectDetails.forEach((section) => { section.hidden = section !== detail; });
  shownIndex = ORDER.indexOf(route.view);
  lenis.scrollTo(0, { immediate: true, force: true });
  return detail;
}

function revealDetail(detail) {
  if (detail && !reducedMotion.matches) gsap.from(detail, { y: 24, opacity: 0, duration: 0.6, ease: 'power2.out' });
}

function navigate(route) {
  const previous = current;
  current = route;
  markNav(route);

  // A transition cut short leaves whichever section was on screen as the one that goes out.
  timeline?.kill();
  timeline = null;
  gsap.set(views, { clearProps: 'transform,opacity' });
  const outgoing = [...views].find((section) => !section.hidden);

  if (outgoing.id === route.view || reducedMotion.matches) {
    const detail = apply(route);
    const sameDetail = previous.view === route.view && previous.detail === route.detail;
    if (!sameDetail) revealDetail(detail);
    if (outgoing.id !== route.view) lockWheel();
    return;
  }

  // Going to a later section moves the content up, like a scroll down, and the other way round.
  const direction = Math.sign(ORDER.indexOf(route.view) - ORDER.indexOf(outgoing.id));
  const incoming = document.getElementById(route.view);
  lockWheel();
  timeline = gsap.timeline({ onComplete: () => { timeline = null; } })
    .to(outgoing, { y: -SHIFT * direction, opacity: 0, duration: 0.3, ease: 'power2.in' })
    .add(() => {
      apply(route);
      gsap.set(outgoing, { clearProps: 'transform,opacity' });
    })
    .fromTo(
      incoming,
      { y: SHIFT * direction, opacity: 0 },
      { y: 0, opacity: 1, duration: 0.4, ease: 'power2.out', clearProps: 'transform,opacity' },
    );
}

// Position in the site as one number: the section index, plus how far that section is scrolled. The background follows it.
export function getSectionProgress() {
  const range = document.documentElement.scrollHeight - window.innerHeight;
  const scrolled = range > 0 ? Math.min(Math.max(window.scrollY / range, 0), 1) : 0;
  return shownIndex + scrolled * 0.99;
}

function atEdge(direction) {
  if (direction < 0) return window.scrollY <= EDGE_TOLERANCE;
  const section = document.getElementById(current.view);
  const range = document.documentElement.scrollHeight - window.innerHeight;
  return section.getBoundingClientRect().bottom <= window.innerHeight + EDGE_TOLERANCE
    || window.scrollY >= range - EDGE_TOLERANCE;
}

// Moves one section forward (1) or back (-1). The hash follows without adding a history entry.
function step(direction) {
  if (current.detail || timeline) return false;
  const target = ORDER[ORDER.indexOf(current.view) + direction];
  if (!target) return false;
  window.history.replaceState(null, '', `#${target}`);
  navigate({ view: target });
  return true;
}

let wheelLocked = false;
let transitionAt = 0;
let lastWheel = 0;
let gestureScrolled = false;

function lockWheel() {
  wheelLocked = true;
  transitionAt = performance.now();
}

// Registered in the capture phase so a swallowed event never reaches Lenis.
function onWheel(event) {
  if (event.ctrlKey) return;
  const now = performance.now();
  const newGesture = now - lastWheel > WHEEL_QUIET;
  lastWheel = now;

  if (wheelLocked) {
    if (newGesture && now - transitionAt >= WHEEL_LOCK) {
      wheelLocked = false;
    } else {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
  }
  if (newGesture) gestureScrolled = false;
  if (current.detail) return;

  const direction = Math.sign(event.deltaY);
  if (direction === 0) return;
  // A gesture that scrolled the page into its edge must end before another one can change section.
  if (!atEdge(direction)) {
    gestureScrolled = true;
    return;
  }
  if (gestureScrolled || Math.abs(event.deltaY) < WHEEL_MIN_DELTA) return;
  if (step(direction)) {
    event.preventDefault();
    event.stopPropagation();
  }
}

let touch = null;

function onTouchStart(event) {
  if (event.touches.length !== 1 || bubbleStage.contains(event.target)) {
    touch = null;
    return;
  }
  const { clientX, clientY } = event.touches[0];
  // The page scrolls under the finger, so the edge has to be reached before the swipe starts.
  touch = { x: clientX, y: clientY, edgeUp: atEdge(-1), edgeDown: atEdge(1) };
}

function onTouchEnd(event) {
  if (!touch) return;
  const start = touch;
  touch = null;
  const { clientX, clientY } = event.changedTouches[0];
  const dx = clientX - start.x;
  const dy = clientY - start.y;
  if (Math.abs(dy) <= SWIPE_MIN || Math.abs(dy) <= Math.abs(dx)) return;
  const direction = dy < 0 ? 1 : -1;
  const wasAtEdge = direction > 0 ? start.edgeDown : start.edgeUp;
  if (wasAtEdge && atEdge(direction)) step(direction);
}

const KEY_DIRECTIONS = { ArrowDown: 1, PageDown: 1, ArrowUp: -1, PageUp: -1 };

function onKeyDown(event) {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if (event.target.closest?.('input, textarea, select, [contenteditable]')) return;
  if (event.key === 'Escape') {
    if (current.detail) window.location.hash = 'projets';
    return;
  }
  const direction = KEY_DIRECTIONS[event.key];
  if (!direction || current.detail || !atEdge(direction)) return;
  if (step(direction)) event.preventDefault();
}

document.querySelectorAll('.back').forEach((button) => {
  button.addEventListener('click', () => { window.location.hash = 'projets'; });
});

window.addEventListener('hashchange', () => navigate(readRoute()));
window.addEventListener('wheel', onWheel, { passive: false, capture: true });
window.addEventListener('touchstart', onTouchStart, { passive: true });
window.addEventListener('touchend', onTouchEnd, { passive: true });
window.addEventListener('touchcancel', () => { touch = null; }, { passive: true });
window.addEventListener('keydown', onKeyDown);

markNav(current);
revealDetail(apply(current));
