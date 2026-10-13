import gsap from 'gsap';
import { getSectionProgress } from './sections.js';

// Background vortex: gold spiral arms drawn on two blurred canvases, turning slowly and twisting with the navigation.
const ARMS = 5; // number of spiral arms (3 on small screens)
const TWIST = 3.4; // radians an arm winds between the centre and its tip
const IDLE_SPEED = 0.06; // rad/s, rotation when nothing else happens
const TURN_PER_SECTION = 1.1; // radians added for each section passed (and pro rata while scrolling inside one)
const BLUR_BACK = 55; // px, blur of the back canvas (wide halo)
const BLUR_FRONT = 14; // px, blur of the front canvas (defined arms)
const OPACITY_BACK = 0.55; // opacity of the back canvas
const OPACITY_FRONT = 0.6; // opacity of the front canvas
const WOBBLE = 0.1; // amplitude of the organic deformation of the arms (0 = perfect spiral)

const CENTER = { x: 0.58, y: 0.48 }; // as fractions of the viewport
const RESOLUTION = 0.5;
const POINTS = 120;
const WIDTH_START = 0.02; // arm width at the centre and at the tip, as fractions of the viewport's smaller side
const WIDTH_END = 0.09;
const ALPHA_CENTER = 0.55;
const ALPHA_EDGE = 0.05;
const FOLLOW = 0.06; // share of the remaining scroll rotation caught up per frame at 60 fps
const SMALL_SCREEN = 760; // px
const SMALL_ARMS = 3;
const SMALL_FPS = 45;

const host = document.getElementById('bg-shape');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function createLayer(blur, opacity) {
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.filter = `blur(${blur}px)`;
  canvas.style.opacity = opacity;
  host.append(canvas);
  return { canvas, context: canvas.getContext('2d') };
}

const back = createLayer(BLUR_BACK, OPACITY_BACK);
const front = createLayer(BLUR_FRONT, OPACITY_FRONT);

let width = 0;
let height = 0;
let arms = ARMS;
let small = false;
let clock = 0; // seconds of animation, drives the wobble
let idleRotation = 0;
let scrollRotation = getSectionProgress() * TURN_PER_SECTION;
let sinceDraw = 0;

const xs = new Float32Array(POINTS);
const ys = new Float32Array(POINTS);

// Three sines of unrelated frequencies, normalised to -1..1.
function wobble(t, phase, a, b, c) {
  return (Math.sin(t * a + clock * 0.31 + phase)
    + 0.6 * Math.sin(t * b - clock * 0.23 + phase * 1.7)
    + 0.35 * Math.sin(t * c + clock * 0.47 + phase * 2.3)) / 1.95;
}

// One arm, filled as a single tapered ribbon so that it never overlaps itself.
function drawArm(context, index, rotation, centerX, centerY, reach, minSide) {
  const armOffset = (index / arms) * Math.PI * 2;
  const phase = index * 2.4;
  const innerRadius = minSide * 0.03;

  for (let i = 0; i < POINTS; i += 1) {
    const t = i / (POINTS - 1);
    const radius = (innerRadius + (reach - innerRadius) * t) * (1 + WOBBLE * wobble(t, phase, 3.1, 5.7, 9.3));
    const angle = armOffset + t * TWIST + rotation + WOBBLE * 1.5 * wobble(t, phase + 1.3, 2.3, 4.1, 7.9);
    xs[i] = centerX + Math.cos(angle) * radius;
    ys[i] = centerY + Math.sin(angle) * radius;
  }

  context.beginPath();
  for (let pass = 0; pass < 2; pass += 1) {
    for (let step = 0; step < POINTS; step += 1) {
      const i = pass === 0 ? step : POINTS - 1 - step;
      const before = Math.max(i - 1, 0);
      const after = Math.min(i + 1, POINTS - 1);
      const tangentX = xs[after] - xs[before];
      const tangentY = ys[after] - ys[before];
      const length = Math.hypot(tangentX, tangentY) || 1;
      const t = i / (POINTS - 1);
      const half = (minSide * (WIDTH_START + (WIDTH_END - WIDTH_START) * t)) / 2 * (pass === 0 ? 1 : -1);
      context.lineTo(xs[i] - (tangentY / length) * half, ys[i] + (tangentX / length) * half);
    }
  }
  context.closePath();
  context.fill();
}

function draw() {
  const centerX = width * CENTER.x;
  const centerY = height * CENTER.y;
  const minSide = Math.min(width, height);
  // Far enough for the tips to leave the viewport whatever its proportions.
  const reach = Math.hypot(Math.max(centerX, width - centerX), Math.max(centerY, height - centerY)) * 1.05;

  const gradient = front.context.createRadialGradient(centerX, centerY, 0, centerX, centerY, reach);
  gradient.addColorStop(0, `rgba(201, 169, 106, ${ALPHA_CENTER})`);
  gradient.addColorStop(1, `rgba(201, 169, 106, ${ALPHA_EDGE})`);

  front.context.clearRect(0, 0, width, height);
  front.context.globalCompositeOperation = 'lighter';
  front.context.fillStyle = gradient;
  const rotation = idleRotation + scrollRotation;
  for (let index = 0; index < arms; index += 1) drawArm(front.context, index, rotation, centerX, centerY, reach, minSide);

  back.context.clearRect(0, 0, width, height);
  back.context.drawImage(front.canvas, 0, 0);
}

function resize() {
  small = window.innerWidth < SMALL_SCREEN;
  arms = small ? Math.min(ARMS, SMALL_ARMS) : ARMS;
  width = Math.max(1, Math.round(window.innerWidth * RESOLUTION));
  height = Math.max(1, Math.round(window.innerHeight * RESOLUTION));
  [back, front].forEach(({ canvas }) => {
    canvas.width = width;
    canvas.height = height;
  });
  draw();
}

function tick(time, deltaTime) {
  sinceDraw += deltaTime / 1000;
  if (small && sinceDraw < 1 / SMALL_FPS - 0.002) return;
  // A long gap (tab in the background, slow frame) must not make the vortex jump.
  const elapsed = Math.min(sinceDraw, 0.1);
  sinceDraw = 0;

  clock += elapsed;
  idleRotation += IDLE_SPEED * elapsed;
  const target = getSectionProgress() * TURN_PER_SECTION;
  scrollRotation += (target - scrollRotation) * (1 - (1 - FOLLOW) ** (elapsed * 60));
  draw();
}

window.addEventListener('resize', resize);
resize();

// Reduced motion: the single frame drawn by resize() is all there is.
if (!reducedMotion) {
  gsap.ticker.add(tick);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) gsap.ticker.remove(tick);
    else gsap.ticker.add(tick);
  });
}
