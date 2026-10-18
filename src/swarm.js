import gsap from 'gsap';
import { createNoise3D } from 'simplex-noise';
import { cursorState } from './cursor.js';

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
const TITLE_WEIGHT = 900; // weight of the titles the swarm spells; the family is --display in style.css
const SAMPLE_SIZE = 120; // px, font size the titles are measured at before scaling to their box
const TEXT_WIDTH = 0.7; // share of the viewport width a page title may take
const INTRO_WIDTH = 0.92; // share of the viewport width for AARON
const INTRO_HEIGHT = 0.6; // share of the viewport height AARON may take, centred
const BAND_TOP = 24; // px from the top of the viewport to the title band; the band height is --title-band in style.css
const SWARM_CLASS = 'swarm-on'; // on <html> while the swarm runs: style.css then hides the headings the swarm spells
const TEXT_FIT = 0.8; // share of the band height the title letters may take, centred in the band
const BAND_SIDE_CLEAR = 96; // px kept free on each side of a page title, so it never meets the fixed Retour link (16..80 px)
// Narrow screens: the title box starts below the Retour link (16..41 px from the top) instead of beside it, so the
// letters may take the full width of the page; the band in style.css is sized for this.
const NARROW_TOP = 48; // px from the top of the viewport
const NARROW_SIDE = 20; // px on each side, the page gutter
// A "\n" in a title marks where it breaks on narrow screens; wider screens join it with a space. style.css makes the
// band of such a page taller under the same width.
const TWO_LINE_QUERY = '(max-width: 520px)';
const LINE_GAP = 0.2; // space between two title lines, as a share of the font size
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
const COLOR = '#C9A96A'; // until the page's --swarm-color is read
const ERASE = '#000';
const MAX_DPR = 2;
const RESIZE_DELAY = 200; // ms
// Warp between a list and a detail page: the particles become stars streaming away from the point that was clicked
// (forward) or toward it (back), speed peaking at WARP_PEAK of the way, then shrinking back to points.
export const WARP_FORWARD_MS = 1100;
export const WARP_BACK_MS = 900;
const WARP_PEAK = 0.55; // share of the warp where the stars are fastest
const WARP_SPEED = 0.026; // peak speed of a near star, as a share of the viewport diagonal per frame at 60 fps
const WARP_STREAK_MAX = 140; // px, longest streak, desktop
const WARP_STREAK_SMALL = 70; // px, same on small screens
const WARP_SPEED_MIN = 0.7; // each star's own speed factor, fixed for the session
const WARP_SPEED_MAX = 1.3;
// Depth bands, far to near: share of the stars, speed, streak length, alpha and line width.
const WARP_BAND_SHARE = [0.5, 0.3, 0.2];
const WARP_BAND_SPEED = [0.35, 0.7, 1.2];
const WARP_BAND_LENGTH = [0.3, 0.6, 1];
const WARP_BAND_ALPHA = [0.3, 0.55, 0.9];
const WARP_BAND_WIDTH = [1, 1.3, 1.6];
const WARP_FADE_IN = 0.08; // share of the warp over which the stars brighten from the page's own particles
const WARP_RESPAWN_R = 40; // px, a forward star leaving the viewport comes back within this of the origin
const WARP_ARRIVE_R = 24; // px, an inbound star this close to the origin comes back at the rim
const WARP_CLASS = 'is-warp'; // on the canvas during a warp: style.css drops the background blur in 0.3 s
// Absorbed: on these themes, once the title has been held, every particle flies into the paint blob and docks there.
const ABSORB_THEMES = ['rugtraak', 'sqkeys', 'admp'];
const BLOB_ORBIT_R = 8; // px, each particle aims at its own fixed point within this of the blob centre
const ABSORB_DELAY_MAX = 0.9; // s, start delays are spread between 0 and this
const ABSORB_FLIGHT_MIN = 0.9; // s, each flight
const ABSORB_FLIGHT_MAX = 1.4;
const ORBIT_VISIBLE = 60; // the first docked particles stay drawn, circling inside the blob; the rest are hidden
const ORBIT_R_MIN = 3; // px
const ORBIT_R_MAX = 9;
const ORBIT_SPEED = 2.6; // rad/s
const ORBIT_ALPHA = 0.9;
const ORBIT_DOT = 1.1; // px, half the side of an orbiting particle
const CHARGE_FOLLOW = 0.08; // share of the way to the docked share the blob's charge covers per frame
const RELEASE_MS = 400; // leaving the page: the charge drains over this
const RELEASE_SPREAD = 26; // px, released particles start within this of the blob
const TOUCH_FADE_MS = 800; // no fine pointer: the particles fade out instead, and the swarm rests

const TAU = Math.PI * 2;
const random = (min, max) => min + Math.random() * (max - min);
const noise3D = createNoise3D();
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const twoLines = window.matchMedia(TWO_LINE_QUERY);

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
let fontFamily = ''; // --display, read on each title request; a new family is loaded before any sampling
let requests = 0; // the latest request wins when titles arrive faster than the font promise resolves
let lastTitle = null; // last title received from the page
let color = COLOR; // --swarm-color of the page shown, read once per page change
let shown = null; // { text, zone } currently formed or forming, for a re-layout on resize
let introTimeline = null;
let introTimer = 0;
// Warp: origin, direction, progress 0..1 driven by a tween, and per star its speed factor and depth band.
const warp = { tween: null, p: 0, x: 0, y: 0, inward: false, onEnd: null, pendingTitle: null, streak: WARP_STREAK_MAX };
let warpSpeed = null; // Float32Array, one per particle
let warpBand = null; // Uint8Array, one per particle
// Absorption: start time, docked count, whether the swarm rests (touch), and per particle its flight and its orbit.
const absorb = { t0: 0, docked: 0, resting: false, charge: null };
let absorbDelay = null;
let absorbFlight = null;
let absorbFromX = null;
let absorbFromY = null;
let absorbAimX = null;
let absorbAimY = null;
let orbitRadius = null;
let orbitAngle = null;
let dockOrder = null; // Int16Array: -1 while flying, else the order it docked in
const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

// Recorded before initSwarm too: the first title, sent while the page loads, must not be animated over the intro.
// During a warp the new page's colour is taken at once and its title waits for the warp to end.
window.addEventListener('section:change', ({ detail }) => {
  color = getComputedStyle(document.documentElement).getPropertyValue('--swarm-color').trim() || COLOR;
  if (detail.title === lastTitle) return;
  lastTitle = detail.title;
  if (!canvas) return;
  if (warp.tween) warp.pendingTitle = lastTitle;
  else setSwarmTitle(lastTitle);
});

const titleFont = (size) => `${TITLE_WEIGHT} ${size}px ${fontFamily}`;

// The title family comes from --display; the font is loaded once per family, before the letters are sampled.
function loadTitleFont() {
  const family = getComputedStyle(document.documentElement).getPropertyValue('--display').trim();
  if (family !== fontFamily || !fontReady) {
    fontFamily = family;
    fontReady = document.fonts.load(titleFont(SAMPLE_SIZE)).catch(() => {});
  }
  return fontReady;
}

// The band is as tall as the space style.css reserves above the page content.
function readLayout() {
  titleBand = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--title-band')) || 0;
}

function zoneBox(zone) {
  if (zone === 'center') {
    const boxWidth = width * INTRO_WIDTH;
    const boxHeight = height * INTRO_HEIGHT;
    return { x: (width - boxWidth) / 2, y: (height - boxHeight) / 2, width: boxWidth, height: boxHeight };
  }
  const narrow = twoLines.matches;
  const top = narrow ? NARROW_TOP : BAND_TOP;
  const room = BAND_TOP + titleBand - top; // the rest of the band below that top
  const boxWidth = narrow ? width - 2 * NARROW_SIDE : Math.min(width * TEXT_WIDTH, width - 2 * BAND_SIDE_CLEAR);
  const boxHeight = room * TEXT_FIT;
  return { x: (width - boxWidth) / 2, y: top + (room - boxHeight) / 2, width: boxWidth, height: boxHeight };
}

function titleLines(text) {
  const lines = text.split('\n');
  return twoLines.matches ? lines : [lines.join(' ')];
}

// Lines drawn to fit the box, each centred on the widest: font size, ink size and where each line's baseline starts,
// measured from the top left of the ink.
function fitText(target, lines, box) {
  target.font = titleFont(SAMPLE_SIZE);
  const metrics = lines.map((line) => target.measureText(line));
  const widths = metrics.map((m) => m.actualBoundingBoxLeft + m.actualBoundingBoxRight);
  const inkWidth = Math.max(...widths);
  const gap = SAMPLE_SIZE * LINE_GAP;
  const inkHeight = metrics.reduce((sum, m) => sum + m.actualBoundingBoxAscent + m.actualBoundingBoxDescent, 0) + gap * (lines.length - 1);
  const scale = Math.min(box.width / inkWidth, box.height / inkHeight);
  let top = 0;
  const placed = metrics.map((m, index) => {
    const line = { text: lines[index], x: ((inkWidth - widths[index]) / 2 + m.actualBoundingBoxLeft) * scale, y: (top + m.actualBoundingBoxAscent) * scale };
    top += m.actualBoundingBoxAscent + m.actualBoundingBoxDescent + gap;
    return line;
  });
  return {
    font: titleFont(SAMPLE_SIZE * scale),
    inkWidth: Math.ceil(inkWidth * scale),
    inkHeight: Math.ceil(inkHeight * scale),
    lines: placed,
  };
}

// Viewport points inside the letters on an even grid, shuffled. The step starts from the ink area so the grid holds
// about one point per particle: the dots spread evenly over the letters instead of clumping.
function sampleText(lines, box) {
  const target = sampler.getContext('2d', { willReadFrequently: true });
  const fit = fitText(target, lines, box);
  if (!(fit.inkWidth > 0 && fit.inkHeight > 0)) return [];
  sampler.width = fit.inkWidth;
  sampler.height = fit.inkHeight;
  target.font = fit.font;
  target.fillStyle = '#fff';
  fit.lines.forEach((line) => target.fillText(line.text, line.x, line.y));
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
  // Set once per change; the CSS transition eases it in and out. During a warp the class on the canvas wins.
  if (next !== 'warp') canvas.style.filter = next === 'dispersing' || next === 'background' ? BACKGROUND_BLUR : 'none';
}

function release(next) {
  particles.forEach((particle) => { particle.free = true; });
  setState(next);
}

const absorbing = () => state === 'absorbing' || state === 'absorbed' || absorb.resting;

// The title has been held: each particle sets off for the blob after its own delay. Without a fine pointer there is
// no blob, so the particles fade out and the swarm rests until the page changes.
function beginAbsorb() {
  shown = null;
  if (!finePointer) {
    const tl = gsap.timeline();
    tl.to(particles, { a: 0, duration: TOUCH_FADE_MS / 1000, ease: 'power1.out' });
    tl.call(() => {
      absorb.resting = true;
      pause();
    });
    timeline = tl;
    return;
  }
  absorb.t0 = gsap.ticker.time;
  absorb.docked = 0;
  for (let index = 0; index < particles.length; index += 1) {
    const particle = particles[index];
    particle.free = false;
    absorbFromX[index] = particle.x;
    absorbFromY[index] = particle.y;
    absorbDelay[index] = random(0, ABSORB_DELAY_MAX);
    absorbFlight[index] = random(ABSORB_FLIGHT_MIN, ABSORB_FLIGHT_MAX);
    const aim = random(0, TAU);
    const reach = Math.sqrt(Math.random()) * BLOB_ORBIT_R;
    absorbAimX[index] = Math.cos(aim) * reach;
    absorbAimY[index] = Math.sin(aim) * reach;
    orbitRadius[index] = random(ORBIT_R_MIN, ORBIT_R_MAX);
    orbitAngle[index] = random(0, TAU);
    dockOrder[index] = -1;
  }
  setState('absorbing');
}

// Leaving the page: the particles come back out of the blob, around it, at their usual alpha, and the charge drains.
function releaseAbsorbed() {
  if (!absorbing()) return;
  for (let index = 0; index < particles.length; index += 1) {
    const particle = particles[index];
    if (dockOrder[index] >= 0 || absorb.resting) {
      const angle = random(0, TAU);
      const spread = random(0, RELEASE_SPREAD);
      particle.x = cursorState.x + Math.cos(angle) * spread;
      particle.y = cursorState.y + Math.sin(angle) * spread;
    }
    particle.a = SWARM_ALPHA;
    dockOrder[index] = -1;
  }
  absorb.charge?.kill();
  absorb.charge = gsap.to(cursorState, { charge: 0, duration: RELEASE_MS / 1000, ease: 'power1.out' });
  release('swarm');
  if (absorb.resting) {
    absorb.resting = false;
    start();
  }
}

// One frame of the absorption: flights eased toward the live blob position, then the docked particles circling in it.
function absorbFrame(time, frames) {
  context.clearRect(0, 0, width, height);
  const elapsed = time - absorb.t0;
  const targetX = cursorState.x;
  const targetY = cursorState.y;
  context.fillStyle = color;
  context.globalAlpha = FORMED_ALPHA;
  for (let index = 0; index < particles.length; index += 1) {
    if (dockOrder[index] >= 0) continue;
    const particle = particles[index];
    const k = (elapsed - absorbDelay[index]) / absorbFlight[index];
    if (k >= 1) {
      dockOrder[index] = absorb.docked;
      absorb.docked += 1;
      continue;
    }
    if (k > 0) {
      // power2.inOut, toward where the blob is now.
      const eased = k < 0.5 ? 2 * k * k : 1 - ((-2 * k + 2) ** 2) / 2;
      particle.x = absorbFromX[index] + (targetX + absorbAimX[index] - absorbFromX[index]) * eased;
      particle.y = absorbFromY[index] + (targetY + absorbAimY[index] - absorbFromY[index]) * eased;
    }
    context.fillRect(particle.x - DOT_RADIUS_FORMED, particle.y - DOT_RADIUS_FORMED, DOT_RADIUS_FORMED * 2, DOT_RADIUS_FORMED * 2);
  }
  context.globalAlpha = ORBIT_ALPHA;
  for (let index = 0; index < particles.length; index += 1) {
    const order = dockOrder[index];
    if (order < 0 || order >= ORBIT_VISIBLE) continue;
    const angle = orbitAngle[index] + time * ORBIT_SPEED;
    const x = targetX + Math.cos(angle) * orbitRadius[index];
    const y = targetY + Math.sin(angle) * orbitRadius[index];
    context.fillRect(x - ORBIT_DOT, y - ORBIT_DOT, ORBIT_DOT * 2, ORBIT_DOT * 2);
  }
  // The blob's charge follows the docked share; once everything has docked there is no swarm left on the page.
  cursorState.charge += (absorb.docked / particles.length - cursorState.charge) * (1 - (1 - CHARGE_FOLLOW) ** frames);
  if (absorb.docked === particles.length && state !== 'absorbed') setState('absorbed');
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
  await loadTitleFont();
  if (request !== requests || !canvas) return;
  if (warp.tween) {
    warp.pendingTitle = text;
    return;
  }
  stop();
  releaseAbsorbed();
  readLayout(); // the band height may change with the page
  const points = text ? sampleText(titleLines(text), zoneBox(zone)) : [];
  const tl = gsap.timeline();
  let at = 0;
  if (points.length) {
    shown = { text, zone, hold };
    at = addForm(tl, at, points, timing) + hold / 1000;
  }
  // On an absorbing theme the held title flies into the blob instead of settling into the background.
  if (points.length && ABSORB_THEMES.includes(document.documentElement.dataset.theme)) tl.call(beginAbsorb, null, at);
  else addDisperse(tl, at);
  timeline = tl;
}

async function playIntro() {
  const request = ++requests;
  await loadTitleFont();
  if (request !== requests) {
    endIntro(); // a page title arrived first and takes over
    return;
  }
  stop();
  const tl = gsap.timeline();
  tl.call(release, ['swarm'], 0);
  const points = sampleText([INTRO_WORD], zoneBox('center'));
  if (points.length) addForm(tl, INTRO_SWARM_MS / 1000, points, INTRO_TIMING);
  tl.call(releaseIntro, null, INTRO_RELEASE);
  timeline = tl;
  introTimeline = tl;
}

// Speed of the stars over the warp: accelerating up to the peak, then decelerating to a standstill at the end.
function warpEnvelope(p) {
  if (p < WARP_PEAK) {
    const k = p / WARP_PEAK;
    return k * k;
  }
  const k = (p - WARP_PEAK) / (1 - WARP_PEAK);
  return 1 - k * k;
}

// Starts the warp from (x, y): direction 1 streams the stars outward, -1 inward. onEnd runs once it has settled.
export function startWarp(x, y, direction, onEnd) {
  if (!canvas) {
    onEnd?.();
    return;
  }
  finishWarp();
  stop();
  releaseAbsorbed();
  warp.x = x;
  warp.y = y;
  warp.inward = direction < 0;
  warp.onEnd = onEnd || null;
  warp.pendingTitle = null;
  warp.p = 0;
  canvas.classList.add(WARP_CLASS);
  setState('warp');
  warp.tween = gsap.to(warp, {
    p: 1,
    duration: (warp.inward ? WARP_BACK_MS : WARP_FORWARD_MS) / 1000,
    ease: 'none',
    onComplete: endWarp,
  });
}

// Jumps a running warp to its settled end.
export function finishWarp() {
  if (warp.tween) warp.tween.progress(1);
}

export function warpRunning() {
  return warp.tween !== null;
}

// The stars are points again: they become the page's particles, which form its title or settle into the background.
function endWarp() {
  warp.tween = null;
  canvas.classList.remove(WARP_CLASS);
  particles.forEach((particle) => { particle.a = BACKGROUND_ALPHA; });
  release('dispersing');
  const { onEnd, pendingTitle } = warp;
  warp.onEnd = null;
  warp.pendingTitle = null;
  if (pendingTitle) setSwarmTitle(pendingTitle);
  else {
    const tl = gsap.timeline();
    addDisperse(tl, 0);
    timeline = tl;
  }
  onEnd?.();
}

// One frame of the warp: every star moves along the line from the origin, and the streaks are stroked per depth band,
// three paths in all.
function warpFrame(frames) {
  const speedEnvelope = warpEnvelope(warp.p);
  const diagonal = Math.hypot(width, height);
  const fadeIn = Math.min(1, warp.p / WARP_FADE_IN);
  const sign = warp.inward ? -1 : 1;
  context.clearRect(0, 0, width, height);
  context.strokeStyle = color;
  context.lineCap = 'round';
  for (let band = 0; band < 3; band += 1) {
    const speed = WARP_SPEED * diagonal * WARP_BAND_SPEED[band] * speedEnvelope;
    const length = warp.streak * WARP_BAND_LENGTH[band] * speedEnvelope;
    context.globalAlpha = WARP_BAND_ALPHA[band] * fadeIn;
    context.lineWidth = WARP_BAND_WIDTH[band];
    context.beginPath();
    for (let index = 0; index < particles.length; index += 1) {
      if (warpBand[index] !== band) continue;
      const particle = particles[index];
      let dx = particle.x - warp.x;
      let dy = particle.y - warp.y;
      let distance = Math.sqrt(dx * dx + dy * dy);
      if (distance < 0.5) {
        dx = particle.breathX;
        dy = particle.breathY;
        distance = 1;
      }
      const ux = dx / distance;
      const uy = dy / distance;
      const step = speed * warpSpeed[index] * frames;
      particle.x += ux * step * sign;
      particle.y += uy * step * sign;
      if (!warp.inward && (particle.x < 0 || particle.x > width || particle.y < 0 || particle.y > height)) {
        // Out of view: reborn close to the origin, along its own fixed direction.
        const radius = Math.random() * WARP_RESPAWN_R;
        particle.x = warp.x + particle.breathX * radius;
        particle.y = warp.y + particle.breathY * radius;
      } else if (warp.inward && distance < WARP_ARRIVE_R) {
        // Arrived: reborn on the far side of the viewport from the origin, along its own direction.
        const reach = Math.max(warp.x, width - warp.x, warp.y, height - warp.y);
        particle.x = Math.min(width, Math.max(0, warp.x + particle.breathX * reach));
        particle.y = Math.min(height, Math.max(0, warp.y + particle.breathY * reach));
      }
      // The streak trails behind the star: toward the origin going out, away from it coming in.
      const trail = length * warpSpeed[index];
      context.moveTo(particle.x - ux * trail * sign, particle.y - uy * trail * sign);
      context.lineTo(particle.x, particle.y);
    }
    context.stroke();
  }
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

  if (state === 'warp') {
    warpFrame(frames);
    return;
  }
  if (state === 'absorbing' || state === 'absorbed') {
    absorbFrame(time, frames);
    return;
  }

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
  context.fillStyle = color;

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
  if (running || reducedMotion || absorb.resting) return;
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
  loadTitleFont();
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
  warpSpeed = new Float32Array(count);
  warpBand = new Uint8Array(count);
  for (let index = 0; index < count; index += 1) {
    warpSpeed[index] = random(WARP_SPEED_MIN, WARP_SPEED_MAX);
    const pick = Math.random();
    warpBand[index] = pick < WARP_BAND_SHARE[0] ? 0 : pick < WARP_BAND_SHARE[0] + WARP_BAND_SHARE[1] ? 1 : 2;
  }
  warp.streak = small ? WARP_STREAK_SMALL : WARP_STREAK_MAX;
  absorbDelay = new Float32Array(count);
  absorbFlight = new Float32Array(count);
  absorbFromX = new Float32Array(count);
  absorbFromY = new Float32Array(count);
  absorbAimX = new Float32Array(count);
  absorbAimY = new Float32Array(count);
  orbitRadius = new Float32Array(count);
  orbitAngle = new Float32Array(count);
  dockOrder = new Int16Array(count).fill(-1);

  let resizeTimer = 0;
  // A height-only change is the mobile URL bar sliding in or out: the canvas keeps its size.
  window.addEventListener('resize', () => {
    if (window.innerWidth === width) return;
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
  // Dev server only (Vite drops this from the build): lets a test hold the stars together with the pages.
  if (import.meta.env.DEV) window.__swarmDebug = { warp: () => warp.tween, state: () => state, docked: () => absorb.docked, count: () => particles.length, charge: () => cursorState.charge, resting: () => absorb.resting };
}
