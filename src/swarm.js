import gsap from 'gsap';
import { createNoise3D } from 'simplex-noise';

// Particle swarm behind the page: it drifts on a flow field, spells the intro words and each page title, then settles as a faint blurred background.
const PARTICLES = 1000; // desktop budget
const SMALL_SCREEN = 760; // px, below this width the small budget applies (decided once, at load)
const SMALL_PARTICLES = 400;
const BACKGROUND_SHARE = 0.35; // share of the particles still drawn in background mode
const INTRO_WORDS = ['AARON', 'PORTFOLIO'];
const INTRO_HOLD_MS = 2000;
const INTRO_SWARM_MS = 900; // free swarming before each intro word
const TITLE_HOLD_MS = 1500;
const FONT_LOAD = '700 120px "Big Shoulders Stencil Display"';
const FONT_FAMILY = '"Big Shoulders Stencil Display", Impact, sans-serif';
const TEXT_WIDTH = 0.7; // share of the viewport width the text may take
const INTRO_HEIGHT = 0.4; // share of the viewport height for the intro words, centred
const BAND_TOP = 96; // px, top edge of the title band, below the 56 px header
const BAND_HEIGHT = 0.18; // share of the viewport height, maximum height of the title band
const SAMPLE_STEP = 3; // px between sampled grid points, refined down to 1 if the text yields too few
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
const FORMED_ALPHA = 1;
const BACKGROUND_ALPHA = 0.25;
const TRAIL_FADE = 0.16; // alpha of the erase pass each frame; formed text clears fully instead
const BACKGROUND_BLUR = 'blur(6px)';
const DOT = 2; // px, side of a particle
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
let particles = [];
let state = 'swarm';
let timeline = null;
let running = false;
let fontReady = null;
let requests = 0; // the latest request wins when titles arrive faster than the font promise resolves
let lastTitle = null; // last title received from the page
let shown = null; // { text, zone } currently formed or forming, for a re-layout on resize

// Recorded before initSwarm too: the first title, sent while the page loads, must not be animated over the intro.
window.addEventListener('section:change', ({ detail }) => {
  if (detail.title === lastTitle) return;
  lastTitle = detail.title;
  if (canvas) setSwarmTitle(lastTitle);
});

function zoneBox(zone) {
  const boxWidth = width * TEXT_WIDTH;
  const boxHeight = zone === 'center' ? height * INTRO_HEIGHT : height * BAND_HEIGHT;
  const top = zone === 'center' ? (height - boxHeight) / 2 : BAND_TOP;
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

// Viewport points inside the letters, shuffled; at least one per particle when the text is large enough.
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

  let points = [];
  for (let step = SAMPLE_STEP; step >= 1; step -= 1) {
    points = [];
    for (let y = 0; y < fit.inkHeight; y += step) {
      for (let x = 0; x < fit.inkWidth; x += step) {
        if (data[(y * fit.inkWidth + x) * 4 + 3] > ALPHA_THRESHOLD) points.push({ x: originX + x, y: originY + y });
      }
    }
    if (points.length >= particles.length) break;
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

function stop() {
  timeline?.kill();
  timeline = null;
  particles.forEach((particle) => { particle.free = true; });
}

// A particle leaves the flow field when its own move starts, so the ones still waiting keep drifting.
function claim() {
  this.targets()[0].free = false;
}

// One tween per particle, starting STAGGER apart. Returns the time the last particle lands.
function addMoves(tl, start, place) {
  let end = start;
  particles.forEach((particle, index) => {
    const duration = random(DURATION_MIN, DURATION_MAX);
    const at = start + index * STAGGER;
    tl.to(particle, { ...place(index), duration, ease: EASE, onStart: claim }, at);
    end = Math.max(end, at + duration);
  });
  return end;
}

function addForm(tl, start, points) {
  tl.call(setState, ['forming'], start);
  const end = addMoves(tl, start, (index) => {
    const point = points[index % points.length];
    return { x: point.x, y: point.y, a: FORMED_ALPHA };
  });
  tl.call(setState, ['formed'], end);
  return end;
}

function addSwarm(tl, start) {
  tl.call(release, ['swarm'], start);
  tl.to(particles, { a: SWARM_ALPHA, duration: 0.4 }, start);
  return start + INTRO_SWARM_MS / 1000;
}

function addDisperse(tl, start) {
  const visible = Math.round(particles.length * BACKGROUND_SHARE);
  tl.call(() => { shown = null; setState('dispersing'); }, null, start);
  const end = addMoves(tl, start, (index) => ({
    x: random(0, width),
    y: random(0, height),
    a: index < visible ? BACKGROUND_ALPHA : 0,
  }));
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
  if (request !== requests) return; // a page title arrived first and takes over
  stop();
  const tl = gsap.timeline();
  let at = 0;
  INTRO_WORDS.forEach((word) => {
    at = addSwarm(tl, at);
    const points = sampleText(word, zoneBox('center'));
    if (points.length) at = addForm(tl, at, points) + INTRO_HOLD_MS / 1000;
  });
  addDisperse(tl, at);
  timeline = tl;
}

function tick(time, deltaTime) {
  const frames = Math.min(deltaTime, 100) / (1000 / 60);
  const speed = state === 'background' ? BACKGROUND_SPEED : SWARM_SPEED;
  const breathe = state === 'formed';
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
    context.fillRect(x - DOT / 2, y - DOT / 2, DOT, DOT);
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
  playIntro();
}
