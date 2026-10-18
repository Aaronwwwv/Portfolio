import gsap from 'gsap';
import { cursorState } from './cursor.js';
import { lenis } from './scroll.js';
import { warpRunning } from './warp.js';

// Guitar strings: every rule marked data-string is drawn here as a string fixed at both ends that the paint blob
// (cursorState, never the raw pointer) can catch, pull and pluck. Each string is 64 nodes of a damped 1D wave equation.
// The blob coming within STRING_GRAB_R of a string, inside its span, grabs it: the nodes near the blob follow it with a
// gaussian profile, a little less far than the blob moves, up to STRING_MAX_DISP. Once the blob is STRING_RELEASE past
// the held string, or leaves its span, the string slips free and rings. A blob crossing too fast to be caught plucks it.
// Rules are measured on init, resize, Lenis scroll, page change and the end of a warp, never per frame: a frame places
// them from the Lenis scroll. Idle frames (nothing moving, no scroll, no resize) draw nothing.
// Fine pointers only, never under reduced motion: the CSS rules stay instead.
const STRING_NODES = 64;
const STRING_TENSION = 2e5; // 1/s², per node spacing: fundamental about 3.5 Hz, 5 to 6 swings over the ring
const STRING_DAMPING = 3.5; // 1/s: a pluck stays above 1 px for about 1.1 s, half a pixel for 1.5 s
const STRING_STEP = 0.0015; // s, longest integration step, well inside the stability limit of the highest mode
const STRING_GRAB_R = 12; // px from the rest line, vertically, within which the blob catches a string
const STRING_RESIST = 0.7; // a held string moves this share of the blob's offset
const STRING_MAX_DISP = 20; // px
const STRING_RELEASE = 20; // px the blob may get past the held string before it slips free
const STRING_PROFILE = 90; // px, width of the gaussian pull (two standard deviations)
const STRING_PLUCK_GAIN = 0.9; // a fast crossing pulls the string by this many px per px per frame of blob speed
const STRING_REST = 0.03; // px, below this displacement and speed a free string is at rest
const STRING_VISIBLE_MARGIN = 40; // px beyond the viewport a string is still drawn
const DT_MAX = 1 / 30; // s, longest frame step taken
const MAX_DPR = 2;

const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const sigma = STRING_PROFILE / 2;

let canvas = null;
let context = null;
let width = 0;
let height = 0;
let strings = [];
let dirty = true; // a frame must be drawn even if nothing moves
let drawnScroll = -1;
let hidden = false; // during a warp the page moves under the strings: they are hidden until it ends

// Colour (from --string-color) and line width (the rule's height), read on init and on page change.
function readStyles() {
  strings.forEach((string) => {
    const style = getComputedStyle(string.rule);
    string.color = style.getPropertyValue('--string-color').trim() || style.backgroundColor;
    string.lineWidth = string.rule.getBoundingClientRect().height || 1;
  });
  dirty = true;
}

// Page coordinates of each rule: its span and the centre line of its height; and the section of the strings shown,
// whose fade the canvas follows.
let fadeSection = null;

function measure() {
  const scroll = lenis.scroll;
  fadeSection = null;
  strings.forEach((string) => {
    const box = string.rule.getBoundingClientRect();
    string.shown = box.width > 0;
    string.left = box.left;
    string.right = box.right;
    string.y = box.top + box.height / 2 + scroll;
    if (string.shown && !fadeSection) fadeSection = string.section;
  });
  dirty = true;
}

function resize() {
  const ratio = Math.min(window.devicePixelRatio || 1, MAX_DPR);
  width = window.innerWidth;
  height = window.innerHeight;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.lineCap = 'round'; // a new canvas size resets the context
  measure();
}

// Gaussian weight of node i of a string around the page x.
function weight(string, i, x) {
  const nodeX = string.left + ((string.right - string.left) * i) / (STRING_NODES - 1);
  const d = nodeX - x;
  return Math.exp(-(d * d) / (2 * sigma * sigma));
}

// Adds a displacement profile centred on x, the ends staying fixed.
function pull(string, x, amount) {
  for (let i = 1; i < STRING_NODES - 1; i += 1) {
    string.disp[i] += weight(string, i, x) * amount;
    if (string.disp[i] > STRING_MAX_DISP) string.disp[i] = STRING_MAX_DISP;
    else if (string.disp[i] < -STRING_MAX_DISP) string.disp[i] = -STRING_MAX_DISP;
  }
  string.moving = true;
}

// Catching, holding, slipping free and fast plucks, from where the blob is against the rest line.
function interact(string, lineY) {
  const inside = cursorState.active && cursorState.x >= string.left && cursorState.x <= string.right;
  const offset = cursorState.y - lineY;
  if (string.held) {
    const hold = Math.max(-STRING_MAX_DISP, Math.min(STRING_MAX_DISP, offset * STRING_RESIST));
    if (!inside || Math.abs(offset - hold) > STRING_RELEASE) {
      string.held = false;
    } else {
      string.holdX = cursorState.x;
      string.hold = hold;
    }
  } else if (inside) {
    if (Math.abs(offset) <= STRING_GRAB_R) {
      string.held = true;
      string.holdX = cursorState.x;
      string.hold = offset * STRING_RESIST;
      string.moving = true;
    } else if (string.wasInside && string.lastOffset * offset < 0) {
      // Crossed between two frames without being caught: pulled along the way the blob went, and let go at once.
      const speed = Math.abs(cursorState.vy);
      pull(string, cursorState.x, Math.sign(offset) * Math.min(STRING_MAX_DISP, speed * STRING_PLUCK_GAIN));
    }
  }
  string.wasInside = inside;
  string.lastOffset = offset;
}

// Integrates one string over dt in short steps; a held string has its nodes near the blob drawn to the gaussian of the
// hold, the rest follows by tension. Returns whether it still moves.
function step(string, dt) {
  const { disp, speed } = string;
  const steps = Math.ceil(dt / STRING_STEP);
  const h = dt / steps;
  for (let s = 0; s < steps; s += 1) {
    for (let i = 1; i < STRING_NODES - 1; i += 1) {
      speed[i] += (STRING_TENSION * (disp[i - 1] - 2 * disp[i] + disp[i + 1]) - STRING_DAMPING * speed[i]) * h;
    }
    for (let i = 1; i < STRING_NODES - 1; i += 1) disp[i] += speed[i] * h;
    if (string.held) {
      for (let i = 1; i < STRING_NODES - 1; i += 1) {
        const g = weight(string, i, string.holdX);
        if (g < 0.01) continue;
        disp[i] += (g * string.hold - disp[i]) * g;
        speed[i] *= 1 - g;
      }
    }
  }
  let most = 0;
  for (let i = 1; i < STRING_NODES - 1; i += 1) {
    if (disp[i] > STRING_MAX_DISP) disp[i] = STRING_MAX_DISP;
    else if (disp[i] < -STRING_MAX_DISP) disp[i] = -STRING_MAX_DISP;
    most = Math.max(most, Math.abs(disp[i]), Math.abs(speed[i]) * h);
  }
  if (!string.held && most < STRING_REST) {
    disp.fill(0);
    speed.fill(0);
    return false;
  }
  return true;
}

// A string at rest is a straight line; a moving one a smooth curve through the midpoints of its nodes. One stroke each.
function drawString(string, lineY) {
  context.strokeStyle = string.color;
  context.lineWidth = string.lineWidth;
  context.beginPath();
  const span = string.right - string.left;
  const gap = span / (STRING_NODES - 1);
  context.moveTo(string.left, lineY);
  if (!string.moving) {
    context.lineTo(string.right, lineY);
  } else {
    const { disp } = string;
    for (let i = 1; i < STRING_NODES - 1; i += 1) {
      const x = string.left + gap * i;
      context.quadraticCurveTo(x, lineY + disp[i], x + gap / 2, lineY + (disp[i] + disp[i + 1]) / 2);
    }
    context.lineTo(string.right, lineY);
  }
  context.stroke();
}

function tick(time, deltaTime) {
  const warp = warpRunning();
  if (warp !== hidden) {
    hidden = warp;
    canvas.style.opacity = warp ? '0' : '';
    dirty = true;
  }
  const dt = Math.min(DT_MAX, Math.max(0, deltaTime / 1000));
  const scroll = lenis.scroll;
  let active = false;
  for (let n = 0; n < strings.length; n += 1) {
    const string = strings[n];
    if (!string.shown) continue;
    const lineY = string.y - scroll;
    if (!hidden) interact(string, lineY);
    if (string.moving && dt > 0) string.moving = step(string, dt);
    if (string.moving) active = true;
  }
  // The page fading in or out (sections.js sets the section's opacity inline): the strings follow it.
  const fade = fadeSection ? fadeSection.style.opacity : '';
  if (fade !== canvas.style.opacity && !hidden) {
    canvas.style.opacity = fade;
    dirty = true;
  }
  if (!active && !dirty && scroll === drawnScroll) return;
  dirty = false;
  drawnScroll = scroll;
  context.clearRect(0, 0, width, height);
  for (let n = 0; n < strings.length; n += 1) {
    const string = strings[n];
    if (!string.shown) continue;
    const lineY = string.y - scroll;
    if (lineY < -STRING_VISIBLE_MARGIN || lineY > height + STRING_VISIBLE_MARGIN) continue;
    drawString(string, lineY);
  }
}

function initStrings() {
  const rules = [...document.querySelectorAll('[data-string]')];
  if (!rules.length) return;
  canvas = document.createElement('canvas');
  canvas.id = 'strings-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.prepend(canvas);
  context = canvas.getContext('2d');
  strings = rules.map((rule) => ({
    rule,
    section: rule.closest('main > section'),
    disp: new Float32Array(STRING_NODES),
    speed: new Float32Array(STRING_NODES),
    shown: false,
    left: 0,
    right: 0,
    y: 0,
    color: '',
    lineWidth: 1,
    moving: false,
    held: false,
    hold: 0,
    holdX: 0,
    wasInside: false,
    lastOffset: 0,
  }));
  readStyles();
  document.documentElement.classList.add('strings-on');
  resize();
  window.addEventListener('resize', resize);
  lenis.on('scroll', measure);
  window.addEventListener('section:change', () => {
    strings.forEach((string) => {
      string.held = false;
      string.moving = false;
      string.disp.fill(0);
      string.speed.fill(0);
    });
    measure();
    readStyles();
  });
  window.addEventListener('warp:end', measure);
  new ResizeObserver(measure).observe(document.querySelector('main'));
  gsap.ticker.add(tick);
  // Dev server only (Vite drops this from the build): lets a test read the strings.
  if (import.meta.env.DEV) {
    window.__stringsDebug = {
      strings: () => strings.map((s) => ({ shown: s.shown, y: s.y - lenis.scroll, left: s.left, right: s.right, held: s.held, moving: s.moving, max: Math.max(...s.disp.map(Math.abs)) })),
    };
  }
}

if (finePointer && !reducedMotion) initStrings();
