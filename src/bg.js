import gsap from 'gsap';
import { getSectionProgress } from './sections.js';

// Background tornado seen from the side: gold smoke particles orbiting a swaying funnel, drawn on two blurred canvases.
const PARTICLES = 1400; // particles in the funnel (600 on small screens)
const IDLE_SPEED = 0.35; // rad/s, base spin; the top turns at 0.5x this, the bottom at 2.7x
const TURN_PER_SECTION = 1.1; // radians of extra twist for each section passed (and pro rata while scrolling inside one)
const R_TOP_PCT = 34; // funnel radius at the top, in % of the viewport width
const SWAY = 1; // multiplier on the sideways swing of the funnel (0 = straight axis)
const WISPS = 7; // large faint puffs that orbit outside the funnel
const BLUR_BACK = 55; // px, blur of the back canvas (wide halo)
const BLUR_FRONT = 14; // px, blur of the front canvas (smoke grain)
const OPACITY_BACK = 0.3; // opacity of the back canvas
const OPACITY_FRONT = 0.34; // opacity of the front canvas (much higher and the dense tip of the funnel takes body text under 7:1)
const SPRITE_SCALE = 14; // px, diameter of a particle of size 1

const RESOLUTION = 0.5;
const R_BOTTOM_PCT = 1.5; // funnel radius at the bottom, in % of the viewport width
const ROUGHNESS = 0.22; // how far the radius strays from the clean profile
const BREATH = 0.08; // the top radius swells and shrinks by this share
const BREATH_PERIOD = 14; // seconds
const FLATTEN = 0.16; // height of an orbit relative to its width: the side-view projection
const BASE_X_START = 0.68; // funnel axis on the first section and on the last, as fractions of the viewport width
const BASE_X_END = 0.32;
const DRIFT_FOLLOW = 0.05; // share of the remaining sideways drift caught up per frame at 60 fps
const TWIST_FOLLOW = 0.06; // same for the scroll twist
const WISP_ALPHA = 0.12;
const SMALL_SCREEN = 760; // px
const SMALL_PARTICLES = 600;
const SMALL_FPS = 45;

const host = document.getElementById('bg-shape');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const random = (min, max) => min + Math.random() * (max - min);

function createLayer(blur, opacity) {
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.filter = `blur(${blur}px)`;
  canvas.style.opacity = opacity;
  host.append(canvas);
  return { canvas, context: canvas.getContext('2d') };
}

// Soft gold dot, drawn once and stamped for every particle.
function createSprite() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(201, 169, 106, 1)');
  gradient.addColorStop(1, 'rgba(201, 169, 106, 0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  return canvas;
}

const back = createLayer(BLUR_BACK, OPACITY_BACK);
const front = createLayer(BLUR_FRONT, OPACITY_FRONT);
const sprite = createSprite();

// t is the height in the funnel, 0 at the top and 1 at the bottom; the wide top gets a little more of the particles.
const particles = Array.from({ length: PARTICLES }, () => ({
  t: Math.random() ** 1.3,
  theta0: random(0, Math.PI * 2),
  radialJitter: random(0.55, 1.1),
  size: random(0.6, 1.6),
  alpha: random(0.35, 1),
}));

function resetWisp(wisp) {
  wisp.t = random(0.05, 0.9);
  wisp.theta0 = random(0, Math.PI * 2);
  wisp.radialJitter = random(1.3, 1.8);
  wisp.size = random(3, 5);
  return wisp;
}

const wisps = Array.from({ length: WISPS }, () => resetWisp({
  period: random(6, 10), // seconds for one fade in and out
  offset: random(0, 10),
  cycle: 0,
}));

let width = 0;
let height = 0;
let small = false;
let clock = 0; // seconds of animation
let scrollTwist = getSectionProgress() * TURN_PER_SECTION;
let baseX = targetBaseX();
let sinceDraw = 0;

function targetBaseX() {
  const share = Math.min(Math.max(getSectionProgress() / 3, 0), 1);
  return BASE_X_START + (BASE_X_END - BASE_X_START) * share;
}

// Three sines of unrelated frequencies, normalised to -1..1.
function noise(x) {
  return (Math.sin(x) + 0.6 * Math.sin(x * 2.3 + 1.7) + 0.35 * Math.sin(x * 4.1 + 4.2)) / 1.95;
}

// Stamps one particle on its orbit around the funnel axis at height t. The near half of the orbit is brighter and larger.
function stamp(context, particle, alpha, rTop, rBottom, swayPhase) {
  const { t } = particle;
  const radius = (rTop * (1 - t) ** 0.85 + rBottom) * (1 + ROUGHNESS * noise(t * 3 + clock * 0.15));
  const centerX = baseX * width + SWAY * (0.04 + 0.1 * t) * width * Math.sin(t * 4.2 + swayPhase);
  const angle = particle.theta0 + IDLE_SPEED * (0.5 + 2.2 * t) * clock + scrollTwist;
  const depth = Math.sin(angle);
  const near = depth > 0;
  const size = particle.size * SPRITE_SCALE * RESOLUTION * (near ? 1.15 : 0.85);
  const x = centerX + radius * particle.radialJitter * Math.cos(angle);
  const y = t * height + radius * FLATTEN * depth;
  context.globalAlpha = alpha * (near ? 1 : 0.45);
  context.drawImage(sprite, x - size / 2, y - size / 2, size, size);
}

function draw() {
  const context = front.context;
  const rTop = (R_TOP_PCT / 100) * width * (1 + BREATH * Math.sin((clock / BREATH_PERIOD) * Math.PI * 2));
  const rBottom = (R_BOTTOM_PCT / 100) * width;
  const swayPhase = clock * 0.35 + 1.3 * Math.sin(clock * 0.17);

  context.globalAlpha = 1;
  context.clearRect(0, 0, width, height);
  context.globalCompositeOperation = 'lighter';

  const count = small ? Math.min(PARTICLES, SMALL_PARTICLES) : PARTICLES;
  for (let index = 0; index < count; index += 1) {
    stamp(context, particles[index], particles[index].alpha, rTop, rBottom, swayPhase);
  }

  // A wisp comes back somewhere else each time it has faded out.
  wisps.forEach((wisp) => {
    const turns = (clock + wisp.offset) / wisp.period;
    if (Math.floor(turns) !== wisp.cycle) {
      wisp.cycle = Math.floor(turns);
      resetWisp(wisp);
    }
    stamp(context, wisp, WISP_ALPHA * (0.5 - 0.5 * Math.cos(turns * Math.PI * 2)), rTop, rBottom, swayPhase);
  });

  back.context.clearRect(0, 0, width, height);
  back.context.drawImage(front.canvas, 0, 0);
}

function resize() {
  small = window.innerWidth < SMALL_SCREEN;
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
  // A long gap (tab in the background, slow frame) must not make the funnel jump.
  const elapsed = Math.min(sinceDraw, 0.1);
  sinceDraw = 0;

  clock += elapsed;
  const frames = elapsed * 60;
  scrollTwist += (getSectionProgress() * TURN_PER_SECTION - scrollTwist) * (1 - (1 - TWIST_FOLLOW) ** frames);
  baseX += (targetBaseX() - baseX) * (1 - (1 - DRIFT_FOLLOW) ** frames);
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
