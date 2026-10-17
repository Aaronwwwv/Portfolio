import gsap from 'gsap';
import { createNoise3D } from 'simplex-noise';

// Particle swarm behind the page: it drifts on a flow field, spells AARON in the intro and each page title, then settles into a faint blurred tornado.
const PARTICLES = 1500; // desktop budget
const SMALL_SCREEN = 760; // px, below this width the small budget applies (decided once, at load)
const SMALL_PARTICLES = 400;
const BACKGROUND_SHARE = 0.35; // share of the particles still drawn in background mode
// Background: the visible particles follow a side-view tornado (the motion of the former blurred sprite background).
// Each one eases toward its own point on the funnel, so letters melt into the funnel without a jump.
const TORNADO_MAX_PARTICLES = 600; // cap on the particles drawn in the background, desktop
const TORNADO_MAX_SMALL = 250; // same, small screens
const TORNADO_IDLE_SPEED = 0.35; // rad/s, base spin; the top turns at 0.5x this, the bottom at 2.7x
const TORNADO_R_TOP_PCT = 34; // funnel radius at the top, in % of the viewport width
const TORNADO_R_BOTTOM_PCT = 1.5; // funnel radius at the bottom, in % of the viewport width
const TORNADO_SWAY = 1; // multiplier on the sideways swing of the funnel (0 = straight axis)
const TORNADO_ROUGHNESS = 0.22; // how far the radius strays from the clean profile
const TORNADO_BREATH = 0.08; // the top radius swells and shrinks by this share
const TORNADO_BREATH_PERIOD = 14; // s
const TORNADO_FLATTEN = 0.16; // height of an orbit relative to its width: the side-view projection
const TORNADO_BASE_X = 0.68; // funnel axis, as a fraction of the viewport width
const TORNADO_FOLLOW = 0.05; // share of the distance to its funnel point a particle covers per frame at 60 fps
const TORNADO_SETTLE = 1.6; // s, fade from a title to the background
const TORNADO_FAR_ALPHA = 0.45; // alpha factor on the far half of an orbit
const TORNADO_NEAR_SIZE = 1.15; // dot size factor on the near half of an orbit
const TORNADO_FAR_SIZE = 0.85; // same, far half
// Intro, on a full load of the home page only: 0.2 s of free swarm, AARON formed across the screen by 1.1 s, held until
// 1.7 s, then the content comes back and the particles regroup into the home title in the band, formed by about 2.7 s.
const INTRO_WORD = 'AARON';
const INTRO_HASHES = ['', '#accueil']; // any other hash on load skips the intro and forms that page's title directly
const INTRO_SWARM_MS = 200; // free swarm before AARON
const INTRO_FORM_MS = 900; // AARON forms within this window: INTRO_SPREAD + INTRO_DURATION_MAX
const INTRO_HOLD_MS = 600; // AARON held before the release
const INTRO_SPREAD = 0.3; // s between the first and the last particle's start in an intro move, whatever the particle count
const INTRO_DURATION_MIN = 0.45; // s, each particle's move into AARON
const INTRO_DURATION_MAX = 0.6;
const REGROUP_DURATION_MIN = 0.55; // s, each particle's move from AARON into the band; with INTRO_SPREAD, formed 1 s after the release
const REGROUP_DURATION_MAX = 0.7;
const SKIP_SHOW_MS = 300; // the Passer button appears this long after the intro starts
const SKIP_IGNORED_KEYS = ['Tab', 'Shift']; // keys that move the focus (to Passer, for one) rather than skip
const TITLE_HOLD_MS = 1500;
const INTRO_CLASS = 'is-intro'; // on <html> while the intro runs: style.css hides <main> so the word never crosses body text
const INTRO_FALLBACK_MS = 500; // the release happens at the latest this long after it should have
const FONT_LOAD = '700 120px "Big Shoulders Stencil Display"';
const FONT_FAMILY = '"Big Shoulders Stencil Display", Impact, sans-serif';
const TEXT_WIDTH = 0.7; // share of the viewport width a page title may take
const INTRO_WIDTH = 0.92; // share of the viewport width for AARON
const INTRO_HEIGHT = 0.6; // share of the viewport height AARON may take, centred
const BAND_TOP = 24; // px from the top of the viewport to the title band; the band height is --title-band in style.css
const SWARM_CLASS = 'swarm-on'; // on <html> while the swarm runs: style.css then hides the headings the swarm spells
const TEXT_FIT = 0.8; // share of the band height the title letters may take, centred in the band
const BAND_SIDE_CLEAR = 96; // px kept free on each side of a page title, so it never meets the fixed Retour link (16..80 px)
const SAMPLE_REFINE = 0.9; // the grid step shrinks by this factor until the letters hold one point per particle
const ALPHA_THRESHOLD = 128;
const DURATION_MIN = 1.1; // s, each particle's move
const DURATION_MAX = 1.7;
const EASE = 'power3.inOut';
const STAGGER = 0.002; // s between the starts of two particles' moves
const BREATH = 0.6; // px, maximum offset of a formed particle
const BREATH_SPEED = 1.8; // rad/s
const SWARM_SPEED = 1.4; // px per frame at 60 fps
const NOISE_SCALE = 0.0018; // flow field frequency, per px
const NOISE_TIME = 0.06; // flow field evolution, per second
const SWARM_ALPHA = 0.55;
const FORMED_ALPHA = 0.9;
const BACKGROUND_ALPHA = 0.25;
const TRAIL_FADE = 0.16; // alpha of the erase pass each frame; formed text clears fully instead
const BACKGROUND_BLUR = 'blur(6px)';
const DOT_RADIUS = 1; // px, half the side of a particle
const DOT_RADIUS_FORMED = 1.4; // px, same while particles form or hold a word, for legibility
const COLOR = '#C9A96A';
const ERASE = '#000';
const MAX_DPR = 2;
const RESIZE_DELAY = 200; // ms

const TAU = Math.PI * 2;
const random = (min, max) => min + Math.random() * (max - min);
const noise3D = createNoise3D();
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let canvas = null;
let context = null;
let sampler = null;
let width = 0; // viewport, in CSS px
let height = 0;
let titleBand = 0; // px, read on each resize
let particles = [];
let backgroundCount = 0; // particles kept in the background, the first ones of the list
let tornadoClock = 0; // s of tornado animation
let state = 'swarm';
let timeline = null;
let running = false;
let fontReady = null;
let requests = 0; // the latest request wins when titles arrive faster than the font promise resolves
let lastTitle = null; // last title received from the page
let shown = null; // { text, zone } currently formed or forming, for a re-layout on resize
let introTimeline = null;
let introTimer = 0;

// Recorded before initSwarm too: the first title, sent while the page loads, must not be animated over the intro.
window.addEventListener('section:change', ({ detail }) => {
  if (detail.title === lastTitle) return;
  lastTitle = detail.title;
  if (canvas) setSwarmTitle(lastTitle);
});

// The band is as tall as the space style.css reserves above the page content.
function readLayout() {
  titleBand = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--title-band')) || 0;
}

function zoneBox(zone) {
  const boxWidth = zone === 'center' ? width * INTRO_WIDTH : Math.min(width * TEXT_WIDTH, width - 2 * BAND_SIDE_CLEAR);
  const boxHeight = zone === 'center' ? height * INTRO_HEIGHT : titleBand * TEXT_FIT;
  const top = zone === 'center' ? (height - boxHeight) / 2 : BAND_TOP + (titleBand - boxHeight) / 2;
  return { x: (width - boxWidth) / 2, y: top, width: boxWidth, height: boxHeight };
}

// Text drawn to fit the box: font size, ink size and the offsets that put the ink at the top left of its own box.
function fitText(target, text, box) {
  target.font = FONT_LOAD;
  const metrics = target.measureText(text);
  const inkWidth = metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight;
  const inkHeight = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
  const scale = Math.min(box.width / inkWidth, box.height / inkHeight);
  return {
    font: `700 ${120 * scale}px ${FONT_FAMILY}`,
    inkWidth: Math.ceil(inkWidth * scale),
    inkHeight: Math.ceil(inkHeight * scale),
    left: metrics.actualBoundingBoxLeft * scale,
    ascent: metrics.actualBoundingBoxAscent * scale,
  };
}

// Viewport points inside the letters on an even grid, shuffled. The step starts from the ink area so the grid holds
// about one point per particle: the dots spread evenly over the letters instead of clumping.
function sampleText(text, box) {
  const target = sampler.getContext('2d', { willReadFrequently: true });
  const fit = fitText(target, text, box);
  if (!(fit.inkWidth > 0 && fit.inkHeight > 0)) return [];
  sampler.width = fit.inkWidth;
  sampler.height = fit.inkHeight;
  target.font = fit.font;
  target.fillStyle = '#fff';
  target.fillText(text, fit.left, fit.ascent);
  const { data } = target.getImageData(0, 0, fit.inkWidth, fit.inkHeight);
  const originX = box.x + (box.width - fit.inkWidth) / 2;
  const originY = box.y + (box.height - fit.inkHeight) / 2;

  let ink = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > ALPHA_THRESHOLD) ink += 1;
  let step = Math.max(1, Math.sqrt(ink / particles.length));
  let points = [];
  for (;;) {
    points = [];
    for (let y = step / 2; y < fit.inkHeight; y += step) {
      const row = Math.floor(y);
      for (let x = step / 2; x < fit.inkWidth; x += step) {
        const column = Math.floor(x);
        if (data[(row * fit.inkWidth + column) * 4 + 3] > ALPHA_THRESHOLD) points.push({ x: originX + column, y: originY + row });
      }
    }
    if (points.length >= particles.length || step === 1) break;
    step = Math.max(1, step * SAMPLE_REFINE);
  }
  for (let i = points.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [points[i], points[j]] = [points[j], points[i]];
  }
  return points.slice(0, particles.length);
}

function setState(next) {
  state = next;
  canvas.dataset.state = next;
  // Set once per change; the CSS transition eases it in and out.
  canvas.style.filter = next === 'dispersing' || next === 'background' ? BACKGROUND_BLUR : 'none';
}

function release(next) {
  particles.forEach((particle) => { particle.free = true; });
  setState(next);
}

// Move timings: page titles stagger by a fixed step, the intro spreads its starts over a fixed time.
const introStagger = (count) => INTRO_SPREAD / Math.max(1, count - 1);
const TITLE_TIMING = { stagger: () => STAGGER, min: DURATION_MIN, max: DURATION_MAX };
const INTRO_TIMING = { stagger: introStagger, min: INTRO_DURATION_MIN, max: INTRO_DURATION_MAX };
const REGROUP_TIMING = { stagger: introStagger, min: REGROUP_DURATION_MIN, max: REGROUP_DURATION_MAX };
const INTRO_RELEASE = (INTRO_SWARM_MS + INTRO_FORM_MS + INTRO_HOLD_MS) / 1000; // s into the intro timeline

let introActive = false;
let skipTimer = 0;
const skipButton = document.getElementById('skip-intro');

// Safety net for a timeline that never reaches the release (tab hidden, timeline lost): the content comes back anyway.
function armIntroFallback(seconds) {
  window.clearTimeout(introTimer);
  introTimer = window.setTimeout(releaseIntro, seconds * 1000 + INTRO_FALLBACK_MS);
}

function onSkipKey(event) {
  if (!SKIP_IGNORED_KEYS.includes(event.key)) releaseIntro();
}

function beginIntro() {
  introActive = true;
  document.documentElement.classList.add(INTRO_CLASS);
  skipTimer = window.setTimeout(() => { if (skipButton) skipButton.hidden = false; }, SKIP_SHOW_MS);
  window.addEventListener('pointerdown', releaseIntro, true);
  window.addEventListener('keydown', onSkipKey, true);
  skipButton?.addEventListener('click', releaseIntro);
  armIntroFallback(INTRO_RELEASE);
}

function endIntro() {
  introActive = false;
  window.clearTimeout(introTimer);
  window.clearTimeout(skipTimer);
  introTimeline = null;
  document.documentElement.classList.remove(INTRO_CLASS);
  if (skipButton) skipButton.hidden = true;
  window.removeEventListener('pointerdown', releaseIntro, true);
  window.removeEventListener('keydown', onSkipKey, true);
  skipButton?.removeEventListener('click', releaseIntro);
}

// The 1.7 s step, also reached at once by a skip: the content comes back and the particles regroup into the page title.
function releaseIntro() {
  if (!introActive) return;
  endIntro();
  setSwarmTitle(lastTitle, { timing: REGROUP_TIMING }); // also makes a playIntro still waiting for the font give up
}

function stop() {
  // A page title cutting the intro short brings the content back at once.
  if (timeline && timeline === introTimeline) endIntro();
  timeline?.kill();
  timeline = null;
  particles.forEach((particle) => { particle.free = true; });
}

// A particle leaves the flow field when its own move starts, so the ones still waiting keep drifting.
function claim() {
  this.targets()[0].free = false;
}

// One tween per particle, starts staggered by the timing. Returns the time the last particle lands.
function addMoves(tl, start, place, timing) {
  const stagger = timing.stagger(particles.length);
  let end = start;
  particles.forEach((particle, index) => {
    const duration = random(timing.min, timing.max);
    const at = start + index * stagger;
    tl.to(particle, { ...place(index), duration, ease: EASE, onStart: claim }, at);
    end = Math.max(end, at + duration);
  });
  return end;
}

function addForm(tl, start, points, timing = TITLE_TIMING) {
  tl.call(setState, ['forming'], start);
  const end = addMoves(tl, start, (index) => {
    const point = points[index % points.length];
    return { x: point.x, y: point.y, a: FORMED_ALPHA };
  }, timing);
  tl.call(setState, ['formed'], end);
  return end;
}

// The particles are let go to the tornado at once; the ones kept for the background fade to their alpha, the rest out.
function addDisperse(tl, start) {
  tl.call(() => { shown = null; release('dispersing'); }, null, start);
  tl.to(particles, { a: (index) => (index < backgroundCount ? BACKGROUND_ALPHA : 0), duration: TORNADO_SETTLE, ease: 'power1.inOut' }, start);
  tl.call(setState, ['background'], start + TORNADO_SETTLE);
  return start + TORNADO_SETTLE;
}

export async function setSwarmTitle(text, { zone = 'band', hold = TITLE_HOLD_MS, timing = TITLE_TIMING } = {}) {
  const request = ++requests;
  await fontReady;
  if (request !== requests || !canvas) return;
  stop();
  const points = text ? sampleText(text, zoneBox(zone)) : [];
  const tl = gsap.timeline();
  let at = 0;
  if (points.length) {
    shown = { text, zone, hold };
    at = addForm(tl, at, points, timing) + hold / 1000;
  }
  addDisperse(tl, at);
  timeline = tl;
}

async function playIntro() {
  const request = ++requests;
  await fontReady;
  if (request !== requests) {
    endIntro(); // a page title arrived first and takes over
    return;
  }
  stop();
  const tl = gsap.timeline();
  tl.call(release, ['swarm'], 0);
  const points = sampleText(INTRO_WORD, zoneBox('center'));
  if (points.length) addForm(tl, INTRO_SWARM_MS / 1000, points, INTRO_TIMING);
  tl.call(releaseIntro, null, INTRO_RELEASE);
  timeline = tl;
  introTimeline = tl;
}

// Three sines of unrelated frequencies, normalised to -1..1: the roughness of the funnel radius.
function wobble(x) {
  return (Math.sin(x) + 0.6 * Math.sin(x * 2.3 + 1.7) + 0.35 * Math.sin(x * 4.1 + 4.2)) / 1.95;
}

function tick(time, deltaTime) {
  const elapsed = Math.min(deltaTime, 100); // a long gap (tab in the background, slow frame) must not make anything jump
  const frames = elapsed / (1000 / 60);
  const breathe = state === 'formed';
  const radius = breathe || state === 'forming' ? DOT_RADIUS_FORMED : DOT_RADIUS;
  const side = radius * 2;
  const flowTime = time * NOISE_TIME;

  // Funnel for this frame, shared by every particle.
  const tornado = state === 'dispersing' || state === 'background';
  tornadoClock += elapsed / 1000;
  const rTop = (TORNADO_R_TOP_PCT / 100) * width * (1 + TORNADO_BREATH * Math.sin((tornadoClock / TORNADO_BREATH_PERIOD) * TAU));
  const rBottom = (TORNADO_R_BOTTOM_PCT / 100) * width;
  const swayPhase = tornadoClock * 0.35 + 1.3 * Math.sin(tornadoClock * 0.17);
  const follow = 1 - (1 - TORNADO_FOLLOW) ** frames;

  // Erase pass: a faint fill leaves trails behind moving particles; formed text gets a clean frame.
  if (breathe) {
    context.clearRect(0, 0, width, height);
  } else {
    context.globalCompositeOperation = 'destination-out';
    context.globalAlpha = TRAIL_FADE;
    context.fillStyle = ERASE;
    context.fillRect(0, 0, width, height);
    context.globalCompositeOperation = 'source-over';
  }
  context.fillStyle = COLOR;

  for (let index = 0; index < particles.length; index += 1) {
    const particle = particles[index];
    if (particle.a <= 0) continue;
    let alpha = particle.a;
    let dot = radius;
    if (particle.free && tornado) {
      // Its point on the funnel: height t, orbit angle, and the near half of the orbit brighter and larger.
      const { t } = particle;
      const orbit = (rTop * particle.profile + rBottom) * (1 + TORNADO_ROUGHNESS * wobble(t * 3 + tornadoClock * 0.15));
      const axis = TORNADO_BASE_X * width + TORNADO_SWAY * (0.04 + 0.1 * t) * width * Math.sin(t * 4.2 + swayPhase);
      const angle = particle.theta0 + TORNADO_IDLE_SPEED * (0.5 + 2.2 * t) * tornadoClock;
      const depth = Math.sin(angle);
      particle.x += (axis + orbit * particle.jitter * Math.cos(angle) - particle.x) * follow;
      particle.y += (t * height + orbit * TORNADO_FLATTEN * depth - particle.y) * follow;
      if (depth <= 0) alpha *= TORNADO_FAR_ALPHA;
      dot = radius * (depth > 0 ? TORNADO_NEAR_SIZE : TORNADO_FAR_SIZE);
    } else if (particle.free) {
      const angle = noise3D(particle.x * NOISE_SCALE, particle.y * NOISE_SCALE, flowTime) * TAU;
      particle.x += Math.cos(angle) * SWARM_SPEED * frames;
      particle.y += Math.sin(angle) * SWARM_SPEED * frames;
      if (particle.x < 0) particle.x += width;
      else if (particle.x > width) particle.x -= width;
      if (particle.y < 0) particle.y += height;
      else if (particle.y > height) particle.y -= height;
    }
    let { x, y } = particle;
    if (breathe) {
      const offset = BREATH * Math.sin(time * BREATH_SPEED + particle.phase);
      x += particle.breathX * offset;
      y += particle.breathY * offset;
    }
    context.globalAlpha = alpha;
    context.fillRect(x - dot, y - dot, dot * 2, dot * 2);
  }
}

function start() {
  if (running || reducedMotion) return;
  running = true;
  gsap.ticker.add(tick);
}

function pause() {
  running = false;
  gsap.ticker.remove(tick);
}

function resize() {
  const ratio = Math.min(window.devicePixelRatio || 1, MAX_DPR);
  const widthChanged = width !== window.innerWidth;
  width = window.innerWidth;
  height = window.innerHeight;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  readLayout();
  // Formed text follows the new layout; mobile address bars only change the height, which is left alone.
  if (widthChanged && shown && (state === 'forming' || state === 'formed')) setSwarmTitle(shown.text, shown);
}

// Reduced motion: no swarm at all, the page stays static with its headings visible.
export function initSwarm() {
  if (canvas || reducedMotion) return;
  canvas = document.createElement('canvas');
  canvas.id = 'swarm-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.pointerEvents = 'none';
  document.body.prepend(canvas);
  context = canvas.getContext('2d');
  sampler = document.createElement('canvas');
  fontReady = document.fonts.load(FONT_LOAD).catch(() => {});
  resize();

  const small = window.innerWidth < SMALL_SCREEN;
  const count = small ? SMALL_PARTICLES : PARTICLES;
  backgroundCount = Math.min(Math.round(count * BACKGROUND_SHARE), small ? TORNADO_MAX_SMALL : TORNADO_MAX_PARTICLES);
  particles = Array.from({ length: count }, () => {
    const direction = random(0, TAU);
    // t is the height in the funnel, 0 at the top and 1 at the bottom; the wide top gets a little more of the particles.
    const t = Math.random() ** 1.3;
    return {
      x: random(0, width),
      y: random(0, height),
      a: SWARM_ALPHA,
      free: true,
      phase: random(0, TAU),
      breathX: Math.cos(direction),
      breathY: Math.sin(direction),
      t,
      profile: (1 - t) ** 0.85, // share of the top radius at this height
      theta0: random(0, TAU),
      jitter: random(0.55, 1.1), // how far from the axis this particle orbits, relative to the funnel radius
    };
  });

  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(resize, RESIZE_DELAY);
  });

  document.documentElement.classList.add(SWARM_CLASS);
  setState('swarm');
  start();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pause();
    else start();
  });
  if (INTRO_HASHES.includes(window.location.hash)) {
    beginIntro();
    playIntro();
  } else {
    setSwarmTitle(lastTitle);
  }
}
