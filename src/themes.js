import gsap from 'gsap';
import { createNoise3D } from 'simplex-noise';

// Background effects of the themed detail pages, on one fixed canvas under the swarm. Each effect is drawn only while its
// theme is set on <html>, from the shared gsap.ticker; everything it draws is laid out on show and resize, never per frame.
// sqkeys: a halftone grid whose dots swell and shrink with a slow noise field.
// admp: a fan of random-walk price paths, each drawn from left to right, then faded and redrawn from the next seed.
// rugtraak would show falling Solana tokens, but src/assets/logos has no Solana logo yet, so it has no effect for now.
const SMALL_SCREEN = 760; // px, below this width every count is halved (decided once, at load)
const MAX_DPR = 2;
const FADE_MS = 500; // canvas fade when an effect starts or stops, matching the paper crossfade
// The canvas itself is shown at this opacity, so overlapping strokes can never add up past it; the alphas below are the
// visible ones and are divided by it when drawing.
const EFFECT_OPACITY = 0.3;
// Under the reading column the effect keeps only this share, so every text colour stays at 7:1 or more over it.
const COLUMN_KEEP = 0.25;
const COLUMN_EDGE = 72; // px, soft edge of the column on each side
const TAU = Math.PI * 2;

const HALFTONE_COLUMNS = 36;
const HALFTONE_ROWS = 20;
const HALFTONE_SMALL_COLUMNS = 24;
const HALFTONE_SMALL_ROWS = 14;
const HALFTONE_COLOR = '#F85830'; // Swissquote orange, from the logo
const HALFTONE_ALPHA = 0.16;
const HALFTONE_MAX_RADIUS = 0.36; // largest dot radius, as a share of the cell
const HALFTONE_MIN_RADIUS = 0.6; // px, smaller dots are skipped
const HALFTONE_NOISE_SCALE = 0.12; // noise frequency, per cell
const HALFTONE_NOISE_SPEED = 0.06; // noise evolution, per second

const PATH_COUNT = 14;
const PATH_POINTS = 200;
const PATH_COLOR = '#B87333'; // copper
const PATH_ALPHA_MIN = 0.12;
const PATH_ALPHA_MAX = 0.3;
const PATH_WIDTH = 1.2; // px
const PATH_REVEAL_MIN = 8; // s, time a path takes to draw from left to right
const PATH_REVEAL_MAX = 12;
const PATH_FADE = 1.6; // s, fade once fully drawn
const PATH_START_SPREAD = 6; // s, first starts are spread over this so the fan never appears all at once
const PATH_SEED = 2027;
const PATH_ORIGIN_Y = 0.62; // the fan starts here on the left edge, as a share of the height
const PATH_STEP = 0.011; // random-walk step, as a share of the height
const PATH_DRIFT = 0.0025; // largest trend per step, as a share of the height; it opens the fan
const PATH_MIN_Y = 0.06;
const PATH_MAX_Y = 0.94;

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const small = window.innerWidth < SMALL_SCREEN;
const noise3D = createNoise3D();

let canvas = null;
let context = null;
let width = 0;
let height = 0;
let effect = null; // the effect drawing now, or null
let mask = null; // the reading column, pre-rendered on resize and erased from each frame
let fadeTimer = 0;

// Seeded generator (mulberry32): the same seed always gives the same path.
function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const halftone = {
  columns: small ? HALFTONE_SMALL_COLUMNS : HALFTONE_COLUMNS,
  rows: small ? HALFTONE_SMALL_ROWS : HALFTONE_ROWS,
  x: null, // dot centres in CSS px, and the radius ceiling, set on layout
  y: null,
  maxRadius: 0,
  layout() {
    const count = this.columns * this.rows;
    if (!this.x) {
      this.x = new Float32Array(count);
      this.y = new Float32Array(count);
    }
    const cellX = width / this.columns;
    const cellY = height / this.rows;
    for (let row = 0; row < this.rows; row += 1) {
      for (let column = 0; column < this.columns; column += 1) {
        const index = row * this.columns + column;
        this.x[index] = (column + 0.5) * cellX;
        this.y[index] = (row + 0.5) * cellY;
      }
    }
    this.maxRadius = Math.min(cellX, cellY) * HALFTONE_MAX_RADIUS;
  },
  start() {},
  draw(time) {
    const z = time * HALFTONE_NOISE_SPEED;
    context.globalAlpha = HALFTONE_ALPHA / EFFECT_OPACITY;
    context.fillStyle = HALFTONE_COLOR;
    context.beginPath();
    for (let row = 0; row < this.rows; row += 1) {
      for (let column = 0; column < this.columns; column += 1) {
        const index = row * this.columns + column;
        const level = 0.5 + 0.5 * noise3D(column * HALFTONE_NOISE_SCALE, row * HALFTONE_NOISE_SCALE, z);
        const radius = this.maxRadius * level * level;
        if (radius < HALFTONE_MIN_RADIUS) continue;
        const x = this.x[index];
        const y = this.y[index];
        context.moveTo(x + radius, y);
        context.arc(x, y, radius, 0, TAU);
      }
    }
    context.fill();
  },
};

const paths = {
  count: small ? PATH_COUNT / 2 : PATH_COUNT,
  points: small ? PATH_POINTS / 2 : PATH_POINTS,
  values: null, // every path's points, as shares of the height, path after path
  state: null, // per path: start time, reveal and fade durations, alpha and generation, in typed arrays
  generate(index) {
    const { points, values, state } = this;
    const random = seeded(PATH_SEED + index * 7919 + state.generation[index] * 104729);
    const drift = (random() * 2 - 1) * PATH_DRIFT;
    const offset = index * points;
    let y = PATH_ORIGIN_Y;
    values[offset] = y;
    for (let i = 1; i < points; i += 1) {
      // Sum of two uniforms: a cheap bell-shaped step.
      y += drift + (random() + random() - 1) * PATH_STEP;
      if (y < PATH_MIN_Y || y > PATH_MAX_Y) y = Math.min(PATH_MAX_Y, Math.max(PATH_MIN_Y, y));
      values[offset + i] = y;
    }
    state.reveal[index] = PATH_REVEAL_MIN + random() * (PATH_REVEAL_MAX - PATH_REVEAL_MIN);
    state.alpha[index] = PATH_ALPHA_MIN + random() * (PATH_ALPHA_MAX - PATH_ALPHA_MIN);
  },
  layout() {
    if (this.values) return;
    this.values = new Float32Array(this.count * this.points);
    this.state = {
      start: new Float64Array(this.count),
      reveal: new Float32Array(this.count),
      alpha: new Float32Array(this.count),
      generation: new Uint32Array(this.count),
    };
    for (let index = 0; index < this.count; index += 1) this.generate(index);
  },
  start(time) {
    const random = seeded(PATH_SEED);
    for (let index = 0; index < this.count; index += 1) this.state.start[index] = time + random() * PATH_START_SPREAD;
  },
  draw(time) {
    const { count, points, values, state } = this;
    const step = width / (points - 1);
    context.strokeStyle = PATH_COLOR;
    context.lineWidth = PATH_WIDTH;
    context.lineJoin = 'round';
    for (let index = 0; index < count; index += 1) {
      const elapsed = time - state.start[index];
      if (elapsed <= 0) continue;
      const reveal = state.reveal[index];
      if (elapsed >= reveal + PATH_FADE) {
        // Done: the next generation of this path starts at once, from its next seed.
        state.generation[index] += 1;
        this.generate(index);
        state.start[index] = time;
        continue;
      }
      const shown = Math.min(1, elapsed / reveal) * (points - 1);
      const last = Math.floor(shown);
      const offset = index * points;
      context.globalAlpha = (state.alpha[index] / EFFECT_OPACITY) * (elapsed > reveal ? 1 - (elapsed - reveal) / PATH_FADE : 1);
      context.beginPath();
      context.moveTo(0, values[offset] * height);
      for (let i = 1; i <= last; i += 1) context.lineTo(i * step, values[offset + i] * height);
      // The tip moves smoothly between two points.
      if (last < points - 1) {
        const part = shown - last;
        const y = values[offset + last] + (values[offset + last + 1] - values[offset + last]) * part;
        context.lineTo((last + part) * step, y * height);
      }
      context.stroke();
    }
  },
};

const EFFECTS = { sqkeys: halftone, admp: paths };

function resize() {
  const ratio = Math.min(window.devicePixelRatio || 1, MAX_DPR);
  width = window.innerWidth;
  height = window.innerHeight;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  Object.values(EFFECTS).forEach((each) => each.layout());
  buildMask(ratio);
}

// The text column of <main>, inside its side padding, with soft edges: what tick() erases from the effect under the text.
function buildMask(ratio) {
  const main = document.querySelector('main');
  const box = main.getBoundingClientRect();
  const padding = parseFloat(getComputedStyle(main).paddingLeft) || 0;
  const left = Math.max(0, box.left + padding - COLUMN_EDGE);
  const right = Math.min(width, box.right - padding + COLUMN_EDGE);
  mask = mask || document.createElement('canvas');
  mask.width = canvas.width;
  mask.height = canvas.height;
  const target = mask.getContext('2d');
  target.setTransform(ratio, 0, 0, ratio, 0, 0);
  const fade = target.createLinearGradient(left, 0, right, 0);
  const edge = Math.min(0.5, COLUMN_EDGE / Math.max(1, right - left));
  const erase = `rgba(0, 0, 0, ${1 - COLUMN_KEEP})`;
  fade.addColorStop(0, 'rgba(0, 0, 0, 0)');
  fade.addColorStop(edge, erase);
  fade.addColorStop(1 - edge, erase);
  fade.addColorStop(1, 'rgba(0, 0, 0, 0)');
  target.fillStyle = fade;
  target.fillRect(left, 0, right - left, height);
}

function tick(time) {
  if (!effect || document.hidden) return;
  context.clearRect(0, 0, width, height);
  context.save();
  effect.draw(time);
  context.globalAlpha = 1;
  context.globalCompositeOperation = 'destination-out';
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.drawImage(mask, 0, 0);
  context.restore();
}

// Called on each page change: the effect of the new theme fades in, a page without one fades the canvas out.
function setTheme(theme) {
  const next = EFFECTS[theme] || null;
  if (next === effect) return;
  window.clearTimeout(fadeTimer);
  if (next) {
    if (!effect) gsap.ticker.add(tick);
    effect = next;
    effect.start(gsap.ticker.time);
    canvas.style.opacity = String(EFFECT_OPACITY);
  } else {
    // The last frame fades with the canvas, then the loop lets go of it.
    canvas.style.opacity = '0';
    fadeTimer = window.setTimeout(() => {
      effect = null;
      gsap.ticker.remove(tick);
      context.clearRect(0, 0, width, height);
    }, FADE_MS);
  }
}

// Reduced motion: no canvas and no effect, the themed pages keep their plain paper.
if (!reducedMotion) {
  canvas = document.createElement('canvas');
  canvas.id = 'theme-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.prepend(canvas);
  context = canvas.getContext('2d');
  resize();
  window.addEventListener('resize', resize);
  window.addEventListener('section:change', () => setTheme(document.documentElement.dataset.theme));
  setTheme(document.documentElement.dataset.theme);
}
