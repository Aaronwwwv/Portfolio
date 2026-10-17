import gsap from 'gsap';
import { lenis } from './scroll.js';
import { runTunnel, finishTunnel } from './tunnel.js';

// Hash routing: "#parcours" shows one page, "#projets/rugtraak" a project detail page, "#parcours/auxiga" an experience one.
// Pages are reached from the home menu and left with Retour, Escape or the browser history.
const ROUTES = ['accueil', 'parcours', 'projets', 'contact'];
const HOME = 'accueil';
const FADE_OUT = 0.25; // s
const FADE_IN = 0.35; // s
// Page title the swarm spells for each page, by section id; "\n" is where it breaks on narrow screens.
const TITLES = {
  accueil: 'PORTFOLIO',
  parcours: 'À PROPOS\nDE MOI',
  projets: 'PROJETS',
  contact: 'CONTACT',
  'projet-rugtraak': 'RUGTRAAK',
  'projet-sqkeys': 'SQ KEYS',
  'exp-mercor': 'MERCOR',
  'exp-auxiga': 'AUXIGA',
  'exp-tutorat': 'AARON\nTUTORAT',
};
// Theme of each detail page, set as data-theme on <html>; every other page keeps the default theme.
const THEMES = {
  'exp-mercor': 'mercor',
  'exp-auxiga': 'auxiga',
  'exp-tutorat': 'tutorat',
  'projet-rugtraak': 'rugtraak',
  'projet-sqkeys': 'sqkeys',
  'projet-admp': 'admp',
};
// Pages with detail pages: the id prefix of their details and the list the details replace.
const DETAILS = {
  projets: { prefix: 'projet', list: document.getElementById('projets-liste') },
  parcours: { prefix: 'exp', list: document.getElementById('parcours-liste') },
};

// Depth of a page: home 0, the three menu pages 1, every detail page 2. Moving between a list and one of its details
// runs the tunnel, forward when going deeper; every other move keeps the fade.
const depthOf = (route) => (route.view === HOME ? 0 : route.detail ? 2 : 1);

const views = document.querySelectorAll('main > section');
const detailPages = document.querySelectorAll('.detail-page');
const backHome = document.getElementById('back-home');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

let current = readRoute();
let timeline = null;
let pendingOrigin = null; // viewport point of the click that leads into a detail page
let lastOrigin = null; // origin of the last forward tunnel, where the way back returns to

function readRoute() {
  const [view, detail] = window.location.hash.replace(/^#/, '').split('/');
  const route = { view: ROUTES.includes(view) ? view : HOME, detail };
  // A detail that names no page shows its parent page, which Escape then leaves for home.
  if (!detailOf(route)) delete route.detail;
  return route;
}

function detailOf(route) {
  const page = route.detail && DETAILS[route.view] ? document.getElementById(`${DETAILS[route.view].prefix}-${route.detail}`) : null;
  return page?.classList.contains('detail-page') ? page : null;
}

// Puts the DOM in the state of the route, at once, scrolled back to the top.
function apply(route) {
  const detail = detailOf(route);
  views.forEach((section) => { section.hidden = section.id !== route.view; });
  Object.entries(DETAILS).forEach(([view, { list }]) => { list.hidden = view === route.view && detail !== null; });
  detailPages.forEach((section) => { section.hidden = section !== detail; });
  // Retour leads home from the three menu pages; the detail pages keep their own button back to their page.
  backHome.hidden = route.view === HOME || detail !== null;
  // style.css sizes the title band per page from this (a two-line title needs a taller band on narrow screens).
  document.documentElement.dataset.page = detail ? detail.id : route.view;
  // Set before section:change, so the swarm reads the new theme's colour.
  const theme = detail && THEMES[detail.id];
  if (theme) document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
  lenis.scrollTo(0, { immediate: true, force: true });
  window.dispatchEvent(new CustomEvent('section:change', { detail: { title: TITLES[detail ? detail.id : route.view] } }));
  return detail;
}

const viewportCentre = () => ({ x: window.innerWidth / 2, y: window.innerHeight / 2 });

// The page a route shows inside its section: the list, or the detail page that replaces it.
function pageOf(route) {
  return detailOf(route) || DETAILS[route.view].list;
}

// A move between a list and one of its own detail pages, in either direction.
function isTunnelMove(from, to) {
  return from.view === to.view && DETAILS[to.view] && Math.abs(depthOf(from) - depthOf(to)) === 1;
}

// Every hash change fades the page out, swaps it and fades the new one in, or goes through the tunnel.
function navigate(route) {
  const previous = current;
  current = route;
  // A tunnel or a fade cut short ends in its end state, so the DOM always starts from a page at rest.
  finishTunnel();
  timeline?.kill();
  timeline = null;
  gsap.set(views, { clearProps: 'opacity' });
  const origin = pendingOrigin;
  pendingOrigin = null;
  const tunnel = isTunnelMove(previous, route);

  if (tunnel && !reducedMotion.matches) {
    const forward = depthOf(route) > depthOf(previous);
    if (forward) lastOrigin = origin || viewportCentre();
    const detail = detailOf(forward ? route : previous);
    runTunnel({
      direction: forward ? 1 : -1,
      outgoing: pageOf(previous),
      incoming: pageOf(route),
      origin: forward ? lastOrigin : lastOrigin || viewportCentre(),
      theme: forward ? THEMES[detail.id] : undefined,
      swap: () => apply(route),
    });
    return;
  }
  // Reduced motion: no movement; a list and its detail still crossfade, every other move is immediate.
  if (reducedMotion.matches && !tunnel) {
    apply(route);
    return;
  }
  const outgoing = [...views].find((section) => !section.hidden);
  const incoming = document.getElementById(route.view);
  timeline = gsap.timeline({ onComplete: () => { timeline = null; } })
    .to(outgoing, { opacity: 0, duration: FADE_OUT, ease: 'power2.in' })
    .add(() => {
      apply(route);
      gsap.set(outgoing, { clearProps: 'opacity' });
    })
    .fromTo(
      incoming,
      { opacity: 0 },
      { opacity: 1, duration: FADE_IN, ease: 'power2.out', clearProps: 'opacity' },
    );
}

// Escape climbs one level: a detail page goes back to its page, a menu page goes home.
function onKeyDown(event) {
  if (event.key !== 'Escape' || event.defaultPrevented) return;
  if (event.target.closest?.('input, textarea, select, [contenteditable]')) return;
  if (current.detail) window.location.hash = current.view;
  else if (current.view !== HOME) window.location.hash = HOME;
}

// The tunnel into an experience starts from the middle of the link that was clicked (or activated from the keyboard).
document.querySelectorAll('a.exp-link').forEach((link) => {
  link.addEventListener('click', () => {
    const box = link.getBoundingClientRect();
    pendingOrigin = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  });
});
// Project bubbles send the point they were clicked at, just before they change the hash.
window.addEventListener('tunnel:origin', ({ detail }) => { pendingOrigin = { x: detail.x, y: detail.y }; });

document.querySelectorAll('.detail-page .back').forEach((button) => {
  button.addEventListener('click', () => { window.location.hash = button.closest('main > section').id; });
});

window.addEventListener('hashchange', () => navigate(readRoute()));
window.addEventListener('keydown', onKeyDown);

apply(current);
