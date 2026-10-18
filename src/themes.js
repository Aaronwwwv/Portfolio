import gsap from 'gsap';
import { createNoise3D } from 'simplex-noise';
import { cursorState } from './cursor.js';
import { topo } from './topo.js';

// Background effects of the themed detail pages, on one fixed canvas under the swarm. Each effect is drawn only while its
// theme is set on <html>, from the shared gsap.ticker; everything it draws is laid out on show and resize, never per frame.
// sqkeys: a halftone grid whose dots swell and shrink with a slow noise field, and grow around the paint blob.
// admp: a fan of random-walk price paths, each drawn from left to right, then faded and redrawn from the next seed.
// rugtraak: contour lines of a moving relief that rises under the paint blob (topo.js), behind its glass panels.
// The text of these pages sits on opaque cards (or glass, on rugtraak) and the back button on the paper, so the effects
// run across the whole page. An effect may set its own canvas opacity and pixel ratio cap.
const SMALL_SCREEN = 760; // px, below this width every count is halved (decided once, at load)
const MAX_DPR = 2;
const FADE_MS = 500; // canvas fade when an effect starts or stops, matching the paper crossfade
// By default the canvas is shown at this opacity, so overlapping strokes can never add up past it; the alphas below are
// the visible ones and are divided by it when drawing.
const EFFECT_OPACITY = 0.3;
const TAU = Math.PI * 2;

// Halftone: a regular grid, dot sizes from the noise; near the blob the dots grow and brighten. Drawn at full canvas
// opacity, in one fill for the plain dots and one per brightness band of the halo.
const HALFTONE_COLUMNS = 40;
const HALFTONE_ROWS = 22;
const HALFTONE_SMALL_COLUMNS = 26;
const HALFTONE_SMALL_ROWS = 15;
const HALFTONE_COLOR = '#FD5D32'; // Swissquote orange, from the logo
const HALFTONE_ALPHA = 0.35; // every dot outside the halo
const HALFTONE_HALO_ALPHA = 0.5; // at the blob centre; the one place a decoration goes past 0.35
const HALFTONE_HALO_BANDS = 4; // halo brightness steps, one fill each
const HALFTONE_MAX_RADIUS = 0.34; // largest dot radius from the noise, as a share of the cell
const HALFTONE_HALO_GROW = 0.16; // extra radius at the blob centre, as a share of the cell
const HALFTONE_MIN_RADIUS = 0.6; // px, smaller dots are skipped
const HALFTONE_NOISE_SCALE = 0.12; // noise frequency, per cell
const HALFTONE_NOISE_SPEED = 0.06; // noise evolution, per second
const CURSOR_HALO_R = 200; // px around the blob where the dots grow

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
  opacity: 1,
  columns: 0, // the larger count runs along the longer side of the viewport, so the cells stay close to square
  rows: 0,
  x: null, // dot centres in CSS px, the radius ceiling and the halo growth, set on layout
  y: null,
  radius: null, // this frame's radius per dot, and its halo band (0 outside the halo)
  band: null,
  maxRadius: 0,
  haloGrow: 0,
  layout() {
    const many = small ? HALFTONE_SMALL_COLUMNS : HALFTONE_COLUMNS;
    const few = small ? HALFTONE_SMALL_ROWS : HALFTONE_ROWS;
    this.columns = width >= height ? many : few;
    this.rows = width >= height ? few : many;
    const count = this.columns * this.rows;
    if (!this.x) {
      this.x = new Float32Array(count);
      this.y = new Float32Array(count);
      this.radius = new Float32Array(count);
      this.band = new Uint8Array(count);
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
    const cellSize = Math.min(cellX, cellY);
    this.maxRadius = cellSize * HALFTONE_MAX_RADIUS;
    this.haloGrow = cellSize * HALFTONE_HALO_GROW;
  },
  start() {},
  draw(time) {
    const z = time * HALFTONE_NOISE_SPEED;
    const count = this.columns * this.rows;
    // The halo follows the blob while there is one, or while particles are still docked in it.
    const halo = cursorState.active || cursorState.charge > 0;
    const haloR2 = CURSOR_HALO_R * CURSOR_HALO_R;
    for (let index = 0; index < count; index += 1) {
      const column = index % this.columns;
      const row = (index - column) / this.columns;
      const level = 0.5 + 0.5 * noise3D(column * HALFTONE_NOISE_SCALE, row * HALFTONE_NOISE_SCALE, z);
      let radius = this.maxRadius * level * level;
      let band = 0;
      if (halo) {
        const dx = this.x[index] - cursorState.x;
        const dy = this.y[index] - cursorState.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < haloR2) {
          const near = 1 - Math.sqrt(d2) / CURSOR_HALO_R;
          const eased = near * near * (3 - 2 * near);
          radius += this.haloGrow * eased;
          band = Math.min(HALFTONE_HALO_BANDS, 1 + Math.floor(eased * HALFTONE_HALO_BANDS));
        }
      }
      this.radius[index] = radius;
      this.band[index] = band;
    }
    context.fillStyle = HALFTONE_COLOR;
    for (let band = 0; band <= HALFTONE_HALO_BANDS; band += 1) {
      context.globalAlpha = HALFTONE_ALPHA + ((HALFTONE_HALO_ALPHA - HALFTONE_ALPHA) * band) / HALFTONE_HALO_BANDS;
      context.beginPath();
      let any = false;
      for (let index = 0; index < count; index += 1) {
        if (this.band[index] !== band) continue;
        const radius = this.radius[index];
        if (radius < HALFTONE_MIN_RADIUS) continue;
        const x = this.x[index];
        const y = this.y[index];
        context.moveTo(x + radius, y);
        context.arc(x, y, radius, 0, TAU);
        any = true;
      }
      if (any) context.fill();
    }
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

const EFFECTS = { sqkeys: halftone, admp: paths, rugtraak: topo };
const opacityOf = (each) => each.opacity ?? EFFECT_OPACITY;
const ratioFor = (each) => Math.min(window.devicePixelRatio || 1, each?.maxDpr ?? MAX_DPR);
let ratio = 0; // pixel ratio the canvas was last sized at

function resize() {
  ratio = ratioFor(effect);
  width = window.innerWidth;
  height = window.innerHeight;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  Object.values(EFFECTS).forEach((each) => each.layout(width, height));
}

function tick(time) {
  if (!effect || document.hidden) return;
  context.clearRect(0, 0, width, height);
  context.save();
  effect.draw(time);
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
    if (ratioFor(effect) !== ratio) resize(); // the contour lines draw at a lower pixel ratio
    effect.start(gsap.ticker.time);
    canvas.style.opacity = String(opacityOf(effect));
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

// Reduced motion: no animation. An effect with a still version (the contour lines) draws it once; the others leave the
// paper plain.
function setStaticTheme(theme) {
  const next = EFFECTS[theme];
  effect = next?.drawStatic ? next : null;
  context.clearRect(0, 0, width, height);
  if (!effect) {
    canvas.style.opacity = '0';
    return;
  }
  if (ratioFor(effect) !== ratio) resize();
  context.save();
  effect.drawStatic();
  context.restore();
  canvas.style.opacity = String(opacityOf(effect));
}

canvas = document.createElement('canvas');
canvas.id = 'theme-canvas';
canvas.setAttribute('aria-hidden', 'true');
document.body.prepend(canvas);
context = canvas.getContext('2d');
topo.attach(context, window.innerWidth, window.innerHeight);
resize();
// A height-only change is the mobile URL bar sliding in or out: the canvas keeps its size and is stretched for that.
window.addEventListener('resize', () => {
  if (window.innerWidth === width) return;
  resize();
  if (reducedMotion) setStaticTheme(document.documentElement.dataset.theme);
});
const apply = reducedMotion ? setStaticTheme : setTheme;
window.addEventListener('section:change', () => apply(document.documentElement.dataset.theme));
apply(document.documentElement.dataset.theme);
