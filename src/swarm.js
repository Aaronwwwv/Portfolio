import gsap from 'gsap';
import { createNoise3D } from 'simplex-noise';

// Particle swarm behind the page: it drifts on a flow field, spells the intro words and each page title, then settles as a faint blurred background.
const PARTICLES = 1500; // desktop budget
const SMALL_SCREEN = 760; // px, below this width the small budget applies (decided once, at load)
const SMALL_PARTICLES = 400;
const BACKGROUND_SHARE = 0.35; // share of the particles still drawn in background mode
const INTRO_WORDS = ['AARON', 'PORTFOLIO']; // the second word forms straight from the first, with no swarm phase between
const INTRO_SWARM_MS = 500; // free swarming before the first intro word
const INTRO_HOLD_MS = 1500; // each intro word, once formed
const INTRO_SPREAD = 0.9; // s between the first and the last particle's start in an intro move, whatever the particle count
const INTRO_DURATION_MIN = 0.9; // s, each particle's move during the intro
const INTRO_DURATION_MAX = 1.3;
const INTRO_SKIP_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchmove']; // a click, a key or a scroll gesture ends the intro
const TITLE_HOLD_MS = 1500;
const INTRO_CLASS = 'is-intro'; // on <html> while the intro runs: style.css hides <main> so the words never cross body text
const INTRO_FALLBACK_MS = 500; // the class goes at the latest this long after the intro should have ended
const FONT_LOAD = '700 120px "Big Shoulders Stencil Display"';
const FONT_FAMILY = '"Big Shoulders Stencil Display", Impact, sans-serif';
const TEXT_WIDTH = 0.7; // share of the viewport width the text may take
const INTRO_HEIGHT = 0.4; // share of the viewport height for the intro words, centred
const BAND_OFFSET = 12; // px between the header and the top of the title band; the band height is --title-band in style.css
const TEXT_FIT = 0.8; // share of the band height the title letters may take, centred in the band
const SAMPLE_REFINE = 0.9; // the grid step shrinks by this factor until the letters hold one point per particle
const ALPHA_THRESHOLD = 128;
const DURATION_MIN = 1.1; // s, each particle's move
const DURATION_MAX = 1.7;
const EASE = 'power3.inOut';
const STAGGER = 0.002; // s between the starts of two particles' moves
const BREATH = 0.6; // px, maximum offset of a formed particle
const BREATH_SPEED = 1.8; // rad/s
const SWARM_SPEED = 1.4; // px per frame at 60 fps
const BACKGROUND_SPEED = 0.35;
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
let headerHeight = 0; // px, read with the title band on each resize
let titleBand = 0;
let particles = [];
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

// The band sits right under the header and is as tall as the space style.css reserves above the page content.
function readLayout() {
  const header = document.querySelector('.site-header');
  headerHeight = header ? parseFloat(getComputedStyle(header).height) || 0 : 0;
  titleBand = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--title-band')) || 0;
}

function zoneBox(zone) {
  const boxWidth = width * TEXT_WIDTH;
  const boxHeight = zone === 'center' ? height * INTRO_HEIGHT : titleBand * TEXT_FIT;
  const top = zone === 'center' ? (height - boxHeight) / 2 : headerHeight + BAND_OFFSET + (titleBand - boxHeight) / 2;
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
const TITLE_TIMING = { stagger: () => STAGGER, min: DURATION_MIN, max: DURATION_MAX };
const INTRO_TIMING = { stagger: (count) => INTRO_SPREAD / Math.max(1, count - 1), min: INTRO_DURATION_MIN, max: INTRO_DURATION_MAX };

// Longest the intro can take, in seconds, before the font wait: the content comes back when the dispersal starts.
function introLength() {
  return INTRO_SWARM_MS / 1000 + INTRO_WORDS.length * (INTRO_SPREAD + INTRO_DURATION_MAX + INTRO_HOLD_MS / 1000);
}

// Safety net for a timeline that never reaches its end (tab hidden, timeline lost): the content comes back anyway.
function armIntroFallback(seconds) {
  window.clearTimeout(introTimer);
  introTimer = window.setTimeout(endIntro, seconds * 1000 + INTRO_FALLBACK_MS);
}

function endIntro() {
  window.clearTimeout(introTimer);
  introTimeline = null;
  document.documentElement.classList.remove(INTRO_CLASS);
  INTRO_SKIP_EVENTS.forEach((type) => window.removeEventListener(type, skipIntro, true));
}

// Skip: the content comes back at once and the swarm disperses to the background, even if the font is still loading.
function skipIntro() {
  requests += 1; // a playIntro still waiting for the font gives up
  endIntro();
  stop();
  const tl = gsap.timeline();
  addDisperse(tl, 0, INTRO_TIMING);
  timeline = tl;
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

function addSwarm(tl, start) {
  tl.call(release, ['swarm'], start);
  tl.to(particles, { a: SWARM_ALPHA, duration: 0.4 }, start);
  return start + INTRO_SWARM_MS / 1000;
}

function addDisperse(tl, start, timing = TITLE_TIMING) {
  const visible = Math.round(particles.length * BACKGROUND_SHARE);
  tl.call(() => { shown = null; setState('dispersing'); }, null, start);
  const end = addMoves(tl, start, (index) => ({
    x: random(0, width),
    y: random(0, height),
    a: index < visible ? BACKGROUND_ALPHA : 0,
  }), timing);
  tl.call(release, ['background'], end);
  return end;
}

// Reduced motion: the title as plain text in the band, drawn once.
function drawStatic(text) {
  context.clearRect(0, 0, width, height);
  if (!text) return;
  const box = zoneBox('band');
  const fit = fitText(context, text, box);
  context.font = fit.font;
  context.fillStyle = COLOR;
  context.globalAlpha = 1;
  context.fillText(text, box.x + (box.width - fit.inkWidth) / 2 + fit.left, box.y + (box.height - fit.inkHeight) / 2 + fit.ascent);
}

export async function setSwarmTitle(text, { zone = 'band', hold = TITLE_HOLD_MS } = {}) {
  const request = ++requests;
  await fontReady;
  if (request !== requests || !canvas) return;
  if (reducedMotion) {
    drawStatic(text);
    return;
  }
  stop();
  const points = sampleText(text, zoneBox(zone));
  const tl = gsap.timeline();
  let at = 0;
  if (points.length) {
    shown = { text, zone, hold };
    at = addForm(tl, at, points) + hold / 1000;
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
  let at = addSwarm(tl, 0);
  INTRO_WORDS.forEach((word) => {
    const points = sampleText(word, zoneBox('center'));
    if (points.length) at = addForm(tl, at, points, INTRO_TIMING) + INTRO_HOLD_MS / 1000;
  });
  // The content fades back as the dispersal starts.
  tl.call(endIntro, null, at);
  addDisperse(tl, at, INTRO_TIMING);
  timeline = tl;
  introTimeline = tl;
  armIntroFallback(at);
}

function tick(time, deltaTime) {
  const frames = Math.min(deltaTime, 100) / (1000 / 60);
  const speed = state === 'background' ? BACKGROUND_SPEED : SWARM_SPEED;
  const breathe = state === 'formed';
  const radius = breathe || state === 'forming' ? DOT_RADIUS_FORMED : DOT_RADIUS;
  const side = radius * 2;
  const flowTime = time * NOISE_TIME;

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
    if (particle.free) {
      const angle = noise3D(particle.x * NOISE_SCALE, particle.y * NOISE_SCALE, flowTime) * TAU;
      particle.x += Math.cos(angle) * speed * frames;
      particle.y += Math.sin(angle) * speed * frames;
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
    context.globalAlpha = particle.a;
    context.fillRect(x - radius, y - radius, side, side);
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
  if (reducedMotion) drawStatic(lastTitle);
  // Formed text follows the new layout; mobile address bars only change the height, which is left alone.
  else if (widthChanged && shown && (state === 'forming' || state === 'formed')) setSwarmTitle(shown.text, shown);
}

export function initSwarm() {
  if (canvas) return;
  canvas = document.createElement('canvas');
  canvas.id = 'swarm-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.pointerEvents = 'none';
  document.body.prepend(canvas);
  context = canvas.getContext('2d');
  sampler = document.createElement('canvas');
  fontReady = document.fonts.load(FONT_LOAD).catch(() => {});
  resize();

  const count = window.innerWidth < SMALL_SCREEN ? SMALL_PARTICLES : PARTICLES;
  particles = Array.from({ length: count }, () => {
    const direction = random(0, TAU);
    return {
      x: random(0, width),
      y: random(0, height),
      a: SWARM_ALPHA,
      free: true,
      phase: random(0, TAU),
      breathX: Math.cos(direction),
      breathY: Math.sin(direction),
    };
  });

  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(resize, RESIZE_DELAY);
  });

  if (reducedMotion) {
    setSwarmTitle(lastTitle);
    return;
  }
  setState('swarm');
  start();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pause();
    else start();
  });
  document.documentElement.classList.add(INTRO_CLASS);
  INTRO_SKIP_EVENTS.forEach((type) => window.addEventListener(type, skipIntro, { capture: true, passive: true }));
  armIntroFallback(introLength());
  playIntro();
}
