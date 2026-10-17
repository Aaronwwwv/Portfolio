import gsap from 'gsap';
import { lenis } from './scroll.js';

// Hash routing: "#parcours" shows one page, "#projets/rugtraak" shows a project detail page.
// Pages are reached from the home menu and left with Retour, Escape or the browser history.
const ROUTES = ['accueil', 'parcours', 'projets', 'contact'];
const HOME = 'accueil';
const FADE_OUT = 0.25; // s
const FADE_IN = 0.35; // s
// Page title the swarm spells for each page, by section id.
const TITLES = {
  accueil: 'PORTFOLIO',
  parcours: 'À PROPOS',
  projets: 'PROJETS',
  contact: 'CONTACT',
  'projet-rugtraak': 'RUGTRAAK',
  'projet-sqkeys': 'SQ KEYS',
};

const views = document.querySelectorAll('main > section');
const projectList = document.getElementById('projets-liste');
const projectDetails = document.querySelectorAll('#projets > section');
const backHome = document.getElementById('back-home');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

let current = readRoute();
let timeline = null;

function readRoute() {
  const [view, detail] = window.location.hash.replace(/^#/, '').split('/');
  return { view: ROUTES.includes(view) ? view : HOME, detail };
}

function detailOf(route) {
  return route.view === 'projets' && route.detail ? document.getElementById(`projet-${route.detail}`) : null;
}

// Puts the DOM in the state of the route, at once, scrolled back to the top.
function apply(route) {
  const detail = detailOf(route);
  views.forEach((section) => { section.hidden = section.id !== route.view; });
  projectList.hidden = detail !== null;
  projectDetails.forEach((section) => { section.hidden = section !== detail; });
  // Retour leads home from the three menu pages; the detail pages keep their own button back to the list.
  backHome.hidden = route.view === HOME || detail !== null;
  lenis.scrollTo(0, { immediate: true, force: true });
  window.dispatchEvent(new CustomEvent('section:change', { detail: { title: TITLES[detail ? detail.id : route.view] } }));
  return detail;
}

// Every hash change fades the page out, swaps it and fades the new one in.
function navigate(route) {
  current = route;
  // A transition cut short leaves whichever section was on screen as the one that goes out.
  timeline?.kill();
  timeline = null;
  gsap.set(views, { clearProps: 'opacity' });

  if (reducedMotion.matches) {
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

// Escape climbs one level: a project detail goes back to the list, a menu page goes home.
function onKeyDown(event) {
  if (event.key !== 'Escape' || event.defaultPrevented) return;
  if (event.target.closest?.('input, textarea, select, [contenteditable]')) return;
  if (current.detail) window.location.hash = 'projets';
  else if (current.view !== HOME) window.location.hash = HOME;
}

document.querySelectorAll('.detail-page .back').forEach((button) => {
  button.addEventListener('click', () => { window.location.hash = 'projets'; });
});

window.addEventListener('hashchange', () => navigate(readRoute()));
window.addEventListener('keydown', onKeyDown);

apply(current);
