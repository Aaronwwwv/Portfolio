import Matter from 'matter-js';
import gsap from 'gsap';
import { warpRunning } from './warp.js';

const { Bodies, Body, Composite, Engine, Events, Mouse, MouseConstraint, Query, Render, Runner } = Matter;

// If more projects are added later, the stage is split into one cell per project to keep them widely spaced.
// Each logo is cropped from its source image: a circle of radius r around (cx, cy), in source pixels, found from the pixels.
// RUGTRAAK: emblem (ring, R and its slashes) spans x 530..1133, y 129..655; the word below starts at y 694, so the crop
// stops at cutBelow. Its near-black background melts into the bubble body with the lighten blend.
// Swissquote: orange disc spans x 36..436, y 37..437 on an opaque grey square; the clip stays just inside the disc edge.
// ADMP: emblem (arrow, arcs, wheat) spans x 531..933, y 156..452 on an opaque off-white background; its diagonal needs a
// circle of r 249 around (731, 302), which reaches the letters from y 492, so the crop stops at y 472, in the empty band.
const projects = [
  {
    slug: 'rugtraak', name: 'RUGTRAAK', radius: 95,
    logo: { src: new URL('./assets/logos/RUGTRAAK.jpeg', import.meta.url).href, cx: 831.5, cy: 392, r: 378, cutBelow: 693.5, blend: 'lighten', feather: true },
  },
  {
    slug: 'sqkeys', name: 'SQ Keys', radius: 85,
    logo: { src: new URL('./assets/logos/SwissQuote.png', import.meta.url).href, cx: 236, cy: 237, r: 199, blend: 'source-over' },
  },
  {
    slug: 'admp', name: 'ADMP', radius: 90,
    logo: { src: new URL('./assets/logos/admp.jpeg', import.meta.url).href, cx: 731, cy: 302, r: 259, cutBelow: 472, blend: 'source-over' },
  },
];

const DRIFT_FORCE = 0.00007; // per unit of mass, applied every step
const CRUISE_SPEED = 0.8; // ambient drift; anything faster is a throw that decays back to it
const THROW_DECAY = 0.987; // velocity kept per step above cruise speed
const SAFETY_SPEED = 45; // hard cap per step, only so a body can never tunnel through a wall
const WALL = 100;
const ANGULAR_START = 0.012; // rad per step, largest initial spin
const ANGULAR_MIN = 0.004; // rad per step: the damping settles here rather than at a standstill, so a logo always turns
const ANGULAR_MAX = 0.02; // rad per step
const TORQUE_JITTER = 0.006; // rad per step, largest spin change given by one random push
const TORQUE_MIN_MS = 2000; // a new push every 2 to 4 seconds
const TORQUE_MAX_MS = 4000;
const ANGULAR_DAMPING = 0.995; // spin kept per step; it replaces Matter's air friction on the spin
const LOGO_SHARE = 0.46; // logo diameter, as a share of the bubble diameter
const LOGO_FEATHER = 0.82; // share of the logo radius kept opaque on a feathered logo; beyond it the edge fades out
const BODY_INNER = '#141217';
const BODY_OUTER = '#0a0908';
const RIM_COLOR = 'rgba(201, 169, 106, 0.6)';
const RIM_WIDTH = 1; // px
const GLOW_COLOR = 'rgba(201, 169, 106, 0.15)';
const GLOW_SIZE = 8; // px, outer glow
// Light: a fixed point at the top left of the viewport. Each bubble's glint sits on the side facing it, whatever the body angle.
const LIGHT_SOURCE = { x: 0.08, y: 0.05 }; // fractions of window.innerWidth and window.innerHeight
const HIGHLIGHT_FOLLOW = 0.12; // share of the remaining angle the glint covers per frame
const HIGHLIGHT_DISTANCE = 0.62; // glint centre from the bubble centre, as a share of the radius
const HIGHLIGHT_ARC = 'rgba(240, 230, 204, 0.32)'; // #F0E6CC
const HIGHLIGHT_ARC_WIDTH = 1.5; // px
const HIGHLIGHT_ARC_SPAN = 0.7; // rad, length of the arc along the bubble
const HIGHLIGHT_GLOW = 'rgba(240, 230, 204, 0.1)';
const HIGHLIGHT_GLOW_SIZE = 0.24; // radius of the soft ellipse along the rim, as a share of the bubble radius
const HIGHLIGHT_GLOW_FLAT = 0.45; // its depth toward the centre, relative to its length
const LABEL_FONT = '500 12px "JetBrains Mono", ui-monospace, monospace';
const LABEL_SPACING = 0.12; // em
const LABEL_COLOR = '#F0E6CC';
const LABEL_GAP = 18; // px between the bubble and the middle of its label
// Frame: the rounded rectangle the walls enclose stays invisible. The walls are solid; a bubble hitting one leaves only a
// short straight line on the wall at the contact point, which fades out.
const FRAME_RADIUS = 14; // px, rounded corners the impact lines keep clear of
const CONTAIN_SLACK = 0.1; // share of the radius a bubble may sink into a wall before the safety pass puts it back
const IMPACT_MAX = 6; // impacts shown at once; a new one replaces the oldest
const IMPACT_LIFE_MS = 450;
const IMPACT_LENGTH_MIN = 18; // px, line of the faintest impact that shows
const IMPACT_LENGTH_MAX = 64; // px, line of the strongest
const IMPACT_WIDTH = 1.5; // px
const IMPACT_COLOR = '#C9A96A';
const IMPACT_ALPHA = 0.8;
const IMPACT_MIN_SPEED = 0.4; // px per step toward the wall; below it a touch is resting contact and shows nothing
const IMPACT_FULL_SPEED = 6; // px per step toward the wall (or toward each other) for a full-strength impact
const IMPACT_MIN_STRENGTH = 0.2; // the faintest impact that does show
// Sparks: a few golden streaks flying off along the contact, from a fixed pool, all drawn in one path and one stroke.
// One stroke shares its width, colour and alpha, so those follow the newest burst; each streak also shortens as it dies.
const SPARK_POOL = 24;
const SPARK_COUNT = 3; // at full strength; weaker impacts give fewer
const SPARK_MIN_STRENGTH = 0.3; // below this an impact gives no spark at all
const SPARK_SIZE_MIN = 1.5; // px, line width of the weakest burst
const SPARK_SIZE_MAX = 2.5; // px, of the strongest
const SPARK_STREAK_MIN = 4; // px, streak length at birth
const SPARK_STREAK_MAX = 8;
const SPARK_SPEED_MIN = 60; // px/s
const SPARK_SPEED_MAX = 160;
const SPARK_SPREAD = 0.45; // rad, random spread around the contact tangent
const SPARK_LIFE_MS = 350;
const SPARK_HOT = '#F0E6CC'; // a fresh burst
const SPARK_COOL = '#C9A96A'; // after SPARK_HOT_SHARE of its life
const SPARK_HOT_SHARE = 0.35;
// Soft bubbles: the bodies stay rigid circles; two damped springs per bubble only deform how they are drawn.
// Squash: a hit flattens the bubble along the contact normal, then it swings back 2 to 3 times in about 500 ms.
// Stretch: a fast drag or throw lengthens it along its acceleration, settling by itself in about 600 ms.
const WOBBLE_MAX = 0.2; // largest deformation either way
const WOBBLE_STIFFNESS = 900; // 1/s², about 4.7 Hz once damped
const WOBBLE_DAMPING = 12; // 1/s: 5 % of the swing is left after 500 ms
const SQUASH_GAIN = 0.035; // squash per px per step of approach speed
const STRETCH_STIFFNESS = 420; // 1/s², about 3.2 Hz
const STRETCH_DAMPING = 10; // 1/s: 5 % left after 600 ms
const STRETCH_GAIN = 0.00005; // stretch per px/s² of smoothed acceleration
const ACCEL_SMOOTHING = 0.3; // share of a new acceleration reading taken per step
const STEP_RATE = 60; // Matter steps per second; its velocities are in px per step
const WOBBLE_DT_MAX = 1 / 30; // s, longest spring step, so a slow frame cannot blow the springs up
const WOBBLE_REST = 0.0005; // below this, with no speed, a spring is at rest and skipped

const stage = document.getElementById('bubble-stage');
const canvas = document.getElementById('bubble-canvas');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const random = (min, max) => min + Math.random() * (max - min);
const clamp = (value, min, max) => Math.min(Math.max(value, min), Math.max(min, max));

const logoImages = projects.map(({ logo }) => new Promise((resolve) => {
  const image = new Image();
  image.onload = () => resolve(image);
  image.onerror = () => resolve(null);
  image.src = logo.src;
}));

function sprite(width, height, ratio) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(width * ratio);
  canvas.height = Math.ceil(height * ratio);
  const context = canvas.getContext('2d');
  context.scale(ratio, ratio);
  return { canvas, context, width, height };
}

// The logo cropped to its circle (and above its cut line), square, diameter in CSS px.
function logoSprite(logo, image, diameter, ratio) {
  const { canvas, context } = sprite(diameter, diameter, ratio);
  const scale = diameter / (2 * logo.r);
  context.beginPath();
  context.arc(diameter / 2, diameter / 2, diameter / 2, 0, Math.PI * 2);
  context.clip();
  if (logo.cutBelow) {
    context.beginPath();
    context.rect(0, 0, diameter, (logo.cutBelow - (logo.cy - logo.r)) * scale);
    context.clip();
  }
  context.drawImage(image, logo.cx - logo.r, logo.cy - logo.r, 2 * logo.r, 2 * logo.r, 0, 0, diameter, diameter);
  // A background that is not quite the body colour would leave a faint disc: its edge fades out instead.
  if (logo.feather) {
    const centre = diameter / 2;
    const fade = context.createRadialGradient(centre, centre, centre * LOGO_FEATHER, centre, centre, centre);
    fade.addColorStop(0, '#000');
    fade.addColorStop(1, 'rgba(0, 0, 0, 0)');
    context.globalCompositeOperation = 'destination-in';
    context.fillStyle = fade;
    context.fillRect(0, 0, diameter, diameter);
  }
  return canvas;
}

// Body: dark radial fill, thin gold rim and a faint outer glow. Centred, GLOW_SIZE of margin around the circle.
function bodySprite(radius, ratio) {
  const size = 2 * (radius + GLOW_SIZE);
  const { canvas, context } = sprite(size, size, ratio);
  const centre = size / 2;
  const glow = context.createRadialGradient(centre, centre, radius, centre, centre, radius + GLOW_SIZE);
  glow.addColorStop(0, GLOW_COLOR);
  glow.addColorStop(1, 'rgba(201, 169, 106, 0)');
  context.fillStyle = glow;
  context.fillRect(0, 0, size, size);
  const fill = context.createRadialGradient(centre, centre, 0, centre, centre, radius);
  fill.addColorStop(0, BODY_INNER);
  fill.addColorStop(1, BODY_OUTER);
  context.fillStyle = fill;
  context.beginPath();
  context.arc(centre, centre, radius, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = RIM_COLOR;
  context.lineWidth = RIM_WIDTH;
  context.beginPath();
  context.arc(centre, centre, radius - RIM_WIDTH / 2, 0, Math.PI * 2);
  context.stroke();
  return canvas;
}

// Soft glint facing +x: a faint ellipse stretched along the rim and a short arc that follows the bubble's curve.
// Its centre is the sprite centre; per frame it is turned toward the light and placed HIGHLIGHT_DISTANCE out.
function highlightSprite(radius, ratio) {
  const distance = radius * HIGHLIGHT_DISTANCE;
  const glow = radius * HIGHLIGHT_GLOW_SIZE;
  const width = Math.ceil(2 * glow * HIGHLIGHT_GLOW_FLAT + 8);
  const height = Math.ceil(2 * Math.max(glow, distance * Math.sin(HIGHLIGHT_ARC_SPAN / 2)) + 8);
  const { canvas, context } = sprite(width, height, ratio);
  const centreX = width / 2;
  const centreY = height / 2;
  context.save();
  context.translate(centreX, centreY);
  context.scale(HIGHLIGHT_GLOW_FLAT, 1);
  const fill = context.createRadialGradient(0, 0, 0, 0, 0, glow);
  fill.addColorStop(0, HIGHLIGHT_GLOW);
  fill.addColorStop(1, 'rgba(240, 230, 204, 0)');
  context.fillStyle = fill;
  context.beginPath();
  context.arc(0, 0, glow, 0, Math.PI * 2);
  context.fill();
  context.restore();
  context.strokeStyle = HIGHLIGHT_ARC;
  context.lineWidth = HIGHLIGHT_ARC_WIDTH;
  context.lineCap = 'round';
  context.beginPath();
  context.arc(centreX - distance, centreY, distance, -HIGHLIGHT_ARC_SPAN / 2, HIGHLIGHT_ARC_SPAN / 2);
  context.stroke();
  return { canvas, width, height };
}

// Project name in capitals, spaced letter by letter so the spacing does not depend on canvas letterSpacing support.
function labelSprite(name, ratio) {
  const text = name.toUpperCase();
  const measure = document.createElement('canvas').getContext('2d');
  measure.font = LABEL_FONT;
  const spacing = 12 * LABEL_SPACING;
  const widths = [...text].map((char) => measure.measureText(char).width);
  const width = Math.ceil(widths.reduce((sum, w) => sum + w + spacing, 0));
  const height = 18;
  const { canvas, context } = sprite(width, height, ratio);
  context.font = LABEL_FONT;
  context.fillStyle = LABEL_COLOR;
  context.textBaseline = 'middle';
  let x = spacing / 2;
  [...text].forEach((char, index) => {
    context.fillText(char, x, height / 2);
    x += widths[index] + spacing;
  });
  return { canvas, width, height };
}

// One cell per project, in a grid that follows the proportions of the stage.
function cells(width, height) {
  const ideal = Math.round(Math.sqrt((projects.length * width) / height));
  const columns = clamp(ideal, 1, projects.length);
  const rows = Math.ceil(projects.length / columns);
  const cellWidth = width / columns;
  const cellHeight = height / rows;
  return projects.map((project, index) => ({
    x: ((index % columns) + 0.5) * cellWidth,
    y: (Math.floor(index / columns) + 0.5) * cellHeight,
    width: cellWidth,
    height: cellHeight,
  }));
}

function burst(x, y) {
  for (let i = 0; i < 26; i += 1) {
    const particle = document.createElement('div');
    const size = random(4, 8);
    const angle = random(0, Math.PI * 2);
    const distance = random(60, 140);
    particle.className = 'burst-particle';
    particle.style.cssText = `left:${x - size / 2}px;top:${y - size / 2}px;width:${size}px;height:${size}px;opacity:${random(0.6, 0.9)}`;
    stage.append(particle);
    gsap.to(particle, {
      x: Math.cos(angle) * distance,
      y: Math.sin(angle) * distance,
      rotation: random(-120, 120),
      opacity: 0,
      duration: 0.55,
      ease: 'power2.out',
      onComplete: () => particle.remove(),
    });
  }
}

// A clicked bubble swells and fades, bursts, then the page moves to that project.
let opening = false;

function openProject({ slug, name, radius }, x, y) {
  opening = true;
  const pop = document.createElement('div');
  pop.className = 'bubble-pop';
  pop.textContent = name;
  pop.style.cssText = `left:${x - radius}px;top:${y - radius}px;width:${radius * 2}px;height:${radius * 2}px`;
  stage.append(pop);
  gsap.to(pop, { scale: 1.45, opacity: 0, duration: 0.26, ease: 'power2.out' });
  // Burst and navigation run on the same clock, so the burst can never land after the page has changed.
  window.setTimeout(() => burst(x, y), 260);
  window.setTimeout(() => {
    opening = false;
    // The warp into the project starts from where the bubble was, in viewport coordinates.
    const box = stage.getBoundingClientRect();
    window.dispatchEvent(new CustomEvent('tunnel:origin', { detail: { x: box.left + x, y: box.top + y } }));
    window.location.hash = `projets/${slug}`;
    pop.remove();
  }, 580);
}

// The stage has no size while its tab is hidden: (re)build the bubbles each time it comes back, resize in between.
function watchStage({ onShow, onResize, onHide }) {
  let visible = false;
  new ResizeObserver(([entry]) => {
    const { width, height } = entry.contentRect;
    if (width === 0 || height === 0) {
      if (visible) onHide();
      visible = false;
    } else if (visible) {
      onResize(width, height);
    } else {
      visible = true;
      onShow(width, height);
    }
  }).observe(stage);
}

function startPhysics() {
  const engine = Engine.create({ gravity: { x: 0, y: 0 } });
  const render = Render.create({
    canvas,
    engine,
    options: { width: 1, height: 1, pixelRatio: window.devicePixelRatio, wireframes: false, background: 'transparent' },
  });
  const runner = Runner.create();

  const mouse = Mouse.create(canvas);
  mouse.pixelRatio = render.options.pixelRatio;
  // Matter blocks the wheel and touch gestures on its canvas, which would trap page scrolling over the stage.
  canvas.removeEventListener('wheel', mouse.mousewheel);
  canvas.removeEventListener('touchstart', mouse.mousedown);
  canvas.removeEventListener('touchmove', mouse.mousemove);
  canvas.removeEventListener('touchend', mouse.mouseup);

  const mouseConstraint = MouseConstraint.create(engine, {
    mouse,
    // Soft enough for the bubble to trail the cursor; on release Matter leaves its velocity alone, so the throw carries over.
    constraint: { stiffness: 0.07, damping: 0.12, render: { visible: false } },
  });
  Composite.add(engine.world, mouseConstraint);

  let walls = [];
  let bubbles = [];

  // Each wall is labelled with the side of the stage it closes, which the impacts light up.
  function buildWalls(width, height) {
    const options = { isStatic: true, render: { visible: false } };
    Composite.remove(engine.world, walls);
    walls = [
      Bodies.rectangle(width / 2, -WALL / 2, width + WALL * 2, WALL, { ...options, label: 'top' }),
      Bodies.rectangle(width / 2, height + WALL / 2, width + WALL * 2, WALL, { ...options, label: 'bottom' }),
      Bodies.rectangle(-WALL / 2, height / 2, WALL, height + WALL * 2, { ...options, label: 'left' }),
      Bodies.rectangle(width + WALL / 2, height / 2, WALL, height + WALL * 2, { ...options, label: 'right' }),
    ];
    walls.forEach((wall) => { wall.plugin.side = wall.label; });
    Composite.add(engine.world, walls);
  }

  // Frame geometry, rebuilt on show and resize only: each side as a straight line between its rounded corners, inset by
  // half the impact stroke so a line is never clipped.
  const frame = { sides: {} };

  function buildFrame(width, height) {
    const inset = IMPACT_WIDTH / 2;
    const left = inset;
    const top = inset;
    const right = width - inset;
    const bottom = height - inset;
    const r = Math.min(FRAME_RADIUS, (right - left) / 2, (bottom - top) / 2);
    // Per side: the fixed coordinate, the range an impact line may cover along it, and the normal angle out of the stage.
    frame.sides = {
      top: { horizontal: true, at: top, from: left + r, to: right - r, normal: -Math.PI / 2 },
      bottom: { horizontal: true, at: bottom, from: left + r, to: right - r, normal: Math.PI / 2 },
      left: { horizontal: false, at: left, from: top + r, to: bottom - r, normal: Math.PI },
      right: { horizontal: false, at: right, from: top + r, to: bottom - r, normal: 0 },
    };
  }

  // Impacts in a fixed pool, the oldest overwritten: nothing is allocated per hit or per frame.
  const impacts = Array.from({ length: IMPACT_MAX }, () => ({ active: false, side: 'top', along: 0, strength: 0, start: 0 }));
  let nextImpact = 0;
  let impactCount = 0; // read by the dev hook only

  // Sparks in typed arrays: position, velocity (px/s), birth time and streak length; the oldest slot is reused.
  const sparkX = new Float32Array(SPARK_POOL);
  const sparkY = new Float32Array(SPARK_POOL);
  const sparkVX = new Float32Array(SPARK_POOL);
  const sparkVY = new Float32Array(SPARK_POOL);
  const sparkBorn = new Float64Array(SPARK_POOL).fill(-Infinity);
  const sparkStreak = new Float32Array(SPARK_POOL);
  let nextSpark = 0;
  let sparkCount = 0; // read by the dev hook only
  let burstAt = -Infinity; // time and line width of the newest burst, which the shared stroke follows
  let burstWidth = SPARK_SIZE_MIN;

  // Up to SPARK_COUNT sparks from (x, y), along the tangent angle in the direction sign (or either way when 0).
  function emitSparks(x, y, tangent, sign, strength, now) {
    if (strength < SPARK_MIN_STRENGTH) return;
    const count = Math.max(1, Math.round(SPARK_COUNT * strength));
    for (let n = 0; n < count; n += 1) {
      const i = nextSpark;
      nextSpark = (nextSpark + 1) % SPARK_POOL;
      const way = sign || (Math.random() < 0.5 ? -1 : 1);
      const angle = tangent + (way < 0 ? Math.PI : 0) + random(-SPARK_SPREAD, SPARK_SPREAD);
      const speed = random(SPARK_SPEED_MIN, SPARK_SPEED_MAX) * (0.6 + 0.4 * strength);
      sparkX[i] = x;
      sparkY[i] = y;
      sparkVX[i] = Math.cos(angle) * speed;
      sparkVY[i] = Math.sin(angle) * speed;
      sparkBorn[i] = now;
      sparkStreak[i] = random(SPARK_STREAK_MIN, SPARK_STREAK_MAX);
      sparkCount += 1;
    }
    burstAt = now;
    burstWidth = SPARK_SIZE_MIN + (SPARK_SIZE_MAX - SPARK_SIZE_MIN) * strength;
  }

  // Springs per project slot: displacement, speed and axis angle of the squash and of the stretch, and the smoothed
  // acceleration with the velocity it was measured from. Positive is flatter along the axis, negative longer.
  const slots = projects.length;
  const squash = new Float32Array(slots);
  const squashSpeed = new Float32Array(slots);
  const squashAxis = new Float32Array(slots); // angle from the centre toward the contact
  const stretch = new Float32Array(slots);
  const stretchSpeed = new Float32Array(slots);
  const stretchAxis = new Float32Array(slots);
  const accelX = new Float32Array(slots);
  const accelY = new Float32Array(slots);
  const lastVX = new Float32Array(slots);
  const lastVY = new Float32Array(slots);
  const touched = new Uint8Array(slots); // a contact this step: its velocity change is a collision, not a drag
  let lastSpring = 0;

  function kickSquash(body, axis, approach) {
    const slot = body.plugin.slot;
    squashAxis[slot] = axis;
    squash[slot] = Math.min(WOBBLE_MAX, squash[slot] + approach * SQUASH_GAIN);
  }

  // Called before Matter resolves the contact, so the bubble's velocity is still the one it hit with.
  function addImpact(wall, bubble, now) {
    const { side } = wall.plugin;
    const horizontal = side === 'top' || side === 'bottom';
    const speed = horizontal ? bubble.velocity.y : bubble.velocity.x;
    const toward = side === 'top' || side === 'left' ? -speed : speed;
    if (!(toward >= IMPACT_MIN_SPEED)) return;
    const strength = clamp(toward / IMPACT_FULL_SPEED, IMPACT_MIN_STRENGTH, 1);
    const impact = impacts[nextImpact];
    nextImpact = (nextImpact + 1) % IMPACT_MAX;
    impact.active = true;
    impact.side = side;
    impact.along = horizontal ? bubble.position.x : bubble.position.y;
    impact.strength = strength;
    impact.start = now;
    impactCount += 1;
    const geometry = frame.sides[side];
    if (geometry) {
      // The sparks run along the wall, the way the bubble was sliding.
      const slide = horizontal ? bubble.velocity.x : bubble.velocity.y;
      const x = horizontal ? impact.along : geometry.at;
      const y = horizontal ? geometry.at : impact.along;
      emitSparks(x, y, horizontal ? 0 : Math.PI / 2, Math.abs(slide) > 0.3 ? Math.sign(slide) : 0, strength, now);
      kickSquash(bubble, geometry.normal, toward);
    }
  }

  // Two bubbles meeting: sparks at the contact point along the tangent, both squashed toward each other.
  function addBubbleImpact(bodyA, bodyB, collision, now) {
    const { normal } = collision;
    const approach = Math.abs((bodyA.velocity.x - bodyB.velocity.x) * normal.x + (bodyA.velocity.y - bodyB.velocity.y) * normal.y);
    if (!(approach >= IMPACT_MIN_SPEED)) return;
    const strength = clamp(approach / IMPACT_FULL_SPEED, IMPACT_MIN_STRENGTH, 1);
    const support = collision.supports && collision.supports[0];
    // Without a support point, the contact lies on the line between the centres, at the first one's rim.
    const toB = Math.atan2(bodyB.position.y - bodyA.position.y, bodyB.position.x - bodyA.position.x);
    const x = support ? support.x : bodyA.position.x + Math.cos(toB) * bodyA.circleRadius;
    const y = support ? support.y : bodyA.position.y + Math.sin(toB) * bodyA.circleRadius;
    emitSparks(x, y, toB + Math.PI / 2, 0, strength, now);
    kickSquash(bodyA, toB, approach);
    kickSquash(bodyB, toB + Math.PI, approach);
    impactCount += 1;
  }

  // Each impact: a short straight line on the wall, centred on the contact point, fading out.
  function drawImpacts(context, now) {
    context.strokeStyle = IMPACT_COLOR;
    context.lineWidth = IMPACT_WIDTH;
    context.lineCap = 'round';
    for (let n = 0; n < IMPACT_MAX; n += 1) {
      const impact = impacts[n];
      if (!impact.active) continue;
      const t = (now - impact.start) / IMPACT_LIFE_MS;
      if (t >= 1) {
        impact.active = false;
        continue;
      }
      const side = frame.sides[impact.side];
      if (!side) continue;
      const half = (IMPACT_LENGTH_MIN + (IMPACT_LENGTH_MAX - IMPACT_LENGTH_MIN) * impact.strength) / 2;
      const along = clamp(impact.along, side.from, side.to);
      const from = Math.max(side.from, along - half);
      const to = Math.min(side.to, along + half);
      context.globalAlpha = IMPACT_ALPHA * (1 - t);
      context.beginPath();
      if (side.horizontal) {
        context.moveTo(from, side.at);
        context.lineTo(to, side.at);
      } else {
        context.moveTo(side.at, from);
        context.lineTo(side.at, to);
      }
      context.stroke();
    }
  }

  // Every live spark moved and added to one path, stroked once.
  function drawSparks(context, now, dt) {
    let any = false;
    context.beginPath();
    for (let i = 0; i < SPARK_POOL; i += 1) {
      const t = (now - sparkBorn[i]) / SPARK_LIFE_MS;
      if (t >= 1 || t < 0) continue;
      sparkX[i] += sparkVX[i] * dt;
      sparkY[i] += sparkVY[i] * dt;
      const speed = Math.hypot(sparkVX[i], sparkVY[i]) || 1;
      const trail = sparkStreak[i] * (1 - t);
      context.moveTo(sparkX[i] - (sparkVX[i] / speed) * trail, sparkY[i] - (sparkVY[i] / speed) * trail);
      context.lineTo(sparkX[i], sparkY[i]);
      any = true;
    }
    if (!any) return;
    const age = (now - burstAt) / SPARK_LIFE_MS;
    context.globalAlpha = Math.max(0, 1 - age);
    context.strokeStyle = age < SPARK_HOT_SHARE ? SPARK_HOT : SPARK_COOL;
    context.lineWidth = burstWidth;
    context.lineCap = 'round';
    context.stroke();
  }

  // One damped spring step: displacement and speed toward target. Returns nothing; writes the arrays in place.
  function springStep(position, speed, slot, target, stiffness, damping, dt) {
    speed[slot] += (-stiffness * (position[slot] - target) - damping * speed[slot]) * dt;
    position[slot] += speed[slot] * dt;
    if (position[slot] > WOBBLE_MAX) position[slot] = WOBBLE_MAX;
    else if (position[slot] < -WOBBLE_MAX) position[slot] = -WOBBLE_MAX;
    if (target === 0 && Math.abs(position[slot]) < WOBBLE_REST && Math.abs(speed[slot]) < WOBBLE_REST * 10) {
      position[slot] = 0;
      speed[slot] = 0;
    }
  }

  // Per frame, both springs of every bubble; the stretch is driven by the acceleration measured in afterUpdate.
  function stepSprings(now) {
    const dt = Math.min(WOBBLE_DT_MAX, Math.max(0, (now - lastSpring) / 1000));
    lastSpring = now;
    if (dt === 0) return;
    for (let n = 0; n < bubbles.length; n += 1) {
      const slot = bubbles[n].plugin.slot;
      springStep(squash, squashSpeed, slot, 0, WOBBLE_STIFFNESS, WOBBLE_DAMPING, dt);
      const accel = Math.hypot(accelX[slot], accelY[slot]);
      const target = -Math.min(WOBBLE_MAX, accel * STRETCH_GAIN);
      if (accel > 1) stretchAxis[slot] = Math.atan2(accelY[slot], accelX[slot]);
      springStep(stretch, stretchSpeed, slot, target, STRETCH_STIFFNESS, STRETCH_DAMPING, dt);
    }
  }

  // Scales by 1 - m along the axis and 1 + m / 2 across it.
  function deform(context, axis, m) {
    if (m === 0) return;
    context.rotate(axis);
    context.scale(1 - m, 1 + 0.5 * m);
    context.rotate(-axis);
  }

  // All bubbles in their cells, or with onlyMissing just the ones a click removed, next to those still drifting.
  function spawnBubbles(width, height, onlyMissing = false) {
    const kept = onlyMissing ? bubbles : [];
    if (!onlyMissing) Composite.remove(engine.world, bubbles);
    const added = cells(width, height).map((cell, index) => {
      if (kept.some((body) => body.plugin.data === projects[index])) return null;
      const { radius } = projects[index];
      const spreadX = Math.max(0, cell.width / 2 - radius - 12);
      const spreadY = Math.max(0, cell.height / 2 - radius - 12);
      const body = Bodies.circle(cell.x + random(-spreadX, spreadX), cell.y + random(-spreadY, spreadY), radius, {
        frictionAir: 0.012, // viscous drag
        restitution: 0.65, // soft bounce
        density: 0.0008, // light bodies
        render: { visible: false }, // drawn from pre-rendered sprites in afterRender
      });
      body.plugin.data = projects[index];
      body.plugin.slot = index;
      squash[index] = 0;
      squashSpeed[index] = 0;
      stretch[index] = 0;
      stretchSpeed[index] = 0;
      accelX[index] = 0;
      accelY[index] = 0;
      body.plugin.drift = { angle: random(0, Math.PI * 2), until: 0 };
      body.plugin.spin = { until: 0 };
      body.plugin.light = { angle: null };
      const speed = random(0.3, 0.6);
      Body.setVelocity(body, { x: Math.cos(body.plugin.drift.angle) * speed, y: Math.sin(body.plugin.drift.angle) * speed });
      Body.setAngularVelocity(body, random(-ANGULAR_START, ANGULAR_START));
      lastVX[index] = body.velocity.x;
      lastVY[index] = body.velocity.y;
      return body;
    }).filter(Boolean);
    bubbles = kept.concat(added);
    Composite.add(engine.world, added);
  }

  function keepInside(width, height) {
    bubbles.forEach((body) => {
      const radius = body.circleRadius;
      Body.setPosition(body, {
        x: clamp(body.position.x, radius, width - radius),
        y: clamp(body.position.y, radius, height - radius),
      });
    });
  }

  // One vector reused for every force, velocity and position handed to Matter, so a step allocates nothing.
  const scratch = { x: 0, y: 0 };

  // Each bubble is pushed very gently in a direction that changes every 3.5 to 5 seconds.
  // A thrown bubble glides and loses its excess speed over a few seconds, as in a viscous fluid.
  Events.on(engine, 'beforeUpdate', ({ timestamp }) => {
    bubbles.forEach((body) => {
      const { drift } = body.plugin;
      if (timestamp >= drift.until) {
        drift.angle = random(0, Math.PI * 2);
        drift.until = timestamp + random(3500, 5000);
      }
      const speed = Math.hypot(body.velocity.x, body.velocity.y);
      if (speed <= CRUISE_SPEED * 2) {
        const force = DRIFT_FORCE * body.mass;
        scratch.x = Math.cos(drift.angle) * force;
        scratch.y = Math.sin(drift.angle) * force;
        Body.applyForce(body, body.position, scratch);
      }
      if (speed > CRUISE_SPEED) {
        const keep = Math.min(THROW_DECAY, SAFETY_SPEED / speed);
        scratch.x = body.velocity.x * keep;
        scratch.y = body.velocity.y * keep;
        Body.setVelocity(body, scratch);
      }

      // Slow organic spin: the current spin (collisions included) is kept with ANGULAR_DAMPING, a gentle random push
      // comes every 2 to 4 seconds, and the result is clamped. Dividing by the air friction cancels the share Matter
      // takes off the spin during the step, which alone would stop a bubble within a second or two.
      const { spin } = body.plugin;
      let angular = body.angularVelocity * ANGULAR_DAMPING;
      if (timestamp >= spin.until) {
        angular += random(-TORQUE_JITTER, TORQUE_JITTER);
        spin.until = timestamp + random(TORQUE_MIN_MS, TORQUE_MAX_MS);
      }
      if (Math.abs(angular) < ANGULAR_MIN) angular = (Math.sign(angular) || 1) * ANGULAR_MIN;
      angular = clamp(angular, -ANGULAR_MAX, ANGULAR_MAX);
      Body.setAngularVelocity(body, angular / (1 - body.frictionAir));
    });
  });

  // Safety pass after each step: a bubble sunk into a wall by more than CONTAIN_SLACK of its radius (a hard drag can push
  // it there) is put back against the wall, its speed toward the wall reflected. Counted for the dev hook.
  let rescues = 0;
  let escapes = 0;

  function contain(body) {
    const radius = body.circleRadius;
    const slack = radius * CONTAIN_SLACK;
    let { x, y } = body.position;
    let vx = body.velocity.x;
    let vy = body.velocity.y;
    let moved = false;
    if (x < radius - slack) { x = radius; vx = Math.abs(vx); moved = true; }
    else if (x > laidWidth - radius + slack) { x = laidWidth - radius; vx = -Math.abs(vx); moved = true; }
    if (y < radius - slack) { y = radius; vy = Math.abs(vy); moved = true; }
    else if (y > laidHeight - radius + slack) { y = laidHeight - radius; vy = -Math.abs(vy); moved = true; }
    if (!moved) return;
    rescues += 1;
    scratch.x = x;
    scratch.y = y;
    Body.setPosition(body, scratch);
    scratch.x = vx;
    scratch.y = vy;
    Body.setVelocity(body, scratch);
  }

  // After each step: the safety pass, then the acceleration that drives the stretch, from the change of velocity over
  // a step without contact (a bounce is the squash's business).
  Events.on(engine, 'afterUpdate', () => {
    for (let n = 0; n < bubbles.length; n += 1) {
      const body = bubbles[n];
      if (laidWidth > 0) {
        contain(body);
        // Still out after the pass (or not a number at all) is an escape: the test expects none.
        const { x, y } = body.position;
        const out = body.circleRadius * (1 - CONTAIN_SLACK) - 0.5;
        if (!(x >= out && x <= laidWidth - out && y >= out && y <= laidHeight - out)) escapes += 1;
      }
      const slot = body.plugin.slot;
      const ax = touched[slot] ? 0 : (body.velocity.x - lastVX[slot]) * STEP_RATE * STEP_RATE;
      const ay = touched[slot] ? 0 : (body.velocity.y - lastVY[slot]) * STEP_RATE * STEP_RATE;
      accelX[slot] += (ax - accelX[slot]) * ACCEL_SMOOTHING;
      accelY[slot] += (ay - accelY[slot]) * ACCEL_SMOOTHING;
      lastVX[slot] = body.velocity.x;
      lastVY[slot] = body.velocity.y;
      touched[slot] = 0;
    }
  });

  function markTouched({ pairs }) {
    for (let n = 0; n < pairs.length; n += 1) {
      const { bodyA, bodyB } = pairs[n];
      if (bodyA.plugin.data) touched[bodyA.plugin.slot] = 1;
      if (bodyB.plugin.data) touched[bodyB.plugin.slot] = 1;
    }
  }
  Events.on(engine, 'collisionActive', markTouched);

  // At these speeds Matter treats a contact as resting, so the drift turns away from whatever was touched.
  // A bubble meeting a wall leaves a line on it; two bubbles meeting throw sparks; either way they squash.
  Events.on(engine, 'collisionStart', (event) => {
    markTouched(event);
    const now = performance.now();
    event.pairs.forEach(({ bodyA, bodyB, collision }) => {
      if (bodyA.plugin.side && bodyB.plugin.data) addImpact(bodyA, bodyB, now);
      else if (bodyB.plugin.side && bodyA.plugin.data) addImpact(bodyB, bodyA, now);
      else if (bodyA.plugin.data && bodyB.plugin.data) addBubbleImpact(bodyA, bodyB, collision, now);
      const away = Math.atan2(collision.normal.y, collision.normal.x);
      if (bodyA.plugin.drift) bodyA.plugin.drift.angle = away + random(-0.6, 0.6);
      if (bodyB.plugin.drift) bodyB.plugin.drift.angle = away + Math.PI + random(-0.6, 0.6);
    });
  });

  // Sprites per project, built once and kept while the stage is hidden; only a new device pixel ratio rebuilds them.
  let sprites = new Map();
  let spriteBuild = 0;
  let spriteRatio = 0;

  async function buildSprites() {
    const ratio = window.devicePixelRatio || 1;
    if (ratio === spriteRatio) return;
    spriteRatio = ratio;
    const build = ++spriteBuild;
    const [images] = await Promise.all([
      Promise.all(logoImages),
      document.fonts.load(LABEL_FONT, projects.map(({ name }) => name.toUpperCase()).join('')).catch(() => {}),
    ]);
    if (build !== spriteBuild) return;
    const next = new Map();
    projects.forEach((project, index) => {
      const image = images[index];
      next.set(project.slug, {
        body: bodySprite(project.radius, ratio),
        highlight: highlightSprite(project.radius, ratio),
        logo: image ? logoSprite(project.logo, image, 2 * project.radius * LOGO_SHARE, ratio) : null,
        label: labelSprite(project.name, ratio),
      });
    });
    sprites = next;
  }

  // Stage position in the viewport and the light, read on show, resize and scroll rather than per frame.
  let stageLeft = 0;
  let stageTop = 0;
  let lightX = 0;
  let lightY = 0;

  function readStage() {
    const rect = stage.getBoundingClientRect();
    stageLeft = rect.left;
    stageTop = rect.top;
    lightX = LIGHT_SOURCE.x * window.innerWidth;
    lightY = LIGHT_SOURCE.y * window.innerHeight;
  }

  window.addEventListener('scroll', readStage, { passive: true });
  window.addEventListener('resize', readStage);

  // Eases each glint toward the light, the short way round across -PI/PI.
  function glintAngle(body) {
    const target = Math.atan2(lightY - (stageTop + body.position.y), lightX - (stageLeft + body.position.x));
    const { light } = body.plugin;
    if (light.angle === null) light.angle = target;
    else {
      let delta = target - light.angle;
      delta -= Math.PI * 2 * Math.round(delta / (Math.PI * 2));
      light.angle += delta * HIGHLIGHT_FOLLOW;
    }
    return light.angle;
  }

  // Per frame: per bubble its body and its logo (turned by the body angle) under the two deformations, the squash
  // anchored so the side that was hit stays against the wall; then the glint, turned toward the light but never
  // deformed, and the label, which never turns; the impacts and sparks last, so a bubble never hides them.
  let lastDraw = 0;
  Events.on(render, 'afterRender', () => {
    const context = render.context;
    const ratio = render.options.pixelRatio;
    const now = performance.now();
    const dt = Math.min(WOBBLE_DT_MAX, Math.max(0, (now - lastDraw) / 1000));
    lastDraw = now;
    stepSprings(now);
    context.save();
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    for (let n = 0; n < bubbles.length; n += 1) {
      const body = bubbles[n];
      const { slug, logo } = body.plugin.data;
      const set = sprites.get(slug);
      if (!set) continue;
      const slot = body.plugin.slot;
      const radius = body.circleRadius;
      const anchor = squash[slot] * radius;
      const x = body.position.x + Math.cos(squashAxis[slot]) * anchor;
      const y = body.position.y + Math.sin(squashAxis[slot]) * anchor;
      const outer = radius + GLOW_SIZE;
      context.save();
      context.translate(x, y);
      deform(context, squashAxis[slot], squash[slot]);
      deform(context, stretchAxis[slot], stretch[slot]);
      context.drawImage(set.body, -outer, -outer, 2 * outer, 2 * outer);
      if (set.logo) {
        const half = radius * LOGO_SHARE;
        context.rotate(body.angle);
        context.globalCompositeOperation = logo.blend;
        context.drawImage(set.logo, -half, -half, 2 * half, 2 * half);
      }
      context.restore();
      const { highlight } = set;
      context.save();
      context.translate(x, y);
      context.rotate(glintAngle(body));
      context.drawImage(highlight.canvas, radius * HIGHLIGHT_DISTANCE - highlight.width / 2, -highlight.height / 2, highlight.width, highlight.height);
      context.restore();
      const { label } = set;
      context.drawImage(label.canvas, body.position.x - label.width / 2, body.position.y + radius + LABEL_GAP - label.height / 2, label.width, label.height);
    }
    drawImpacts(context, now);
    drawSparks(context, now, dt);
    context.restore();
  });

  // A press and release within 6 px is a click; anything longer is a drag handled by the mouse constraint.
  let pressedAt = null;
  canvas.addEventListener('mousedown', (event) => {
    pressedAt = { x: event.offsetX, y: event.offsetY };
  });
  canvas.addEventListener('mouseup', (event) => {
    if (!pressedAt || opening) return;
    const moved = Math.hypot(event.offsetX - pressedAt.x, event.offsetY - pressedAt.y);
    pressedAt = null;
    if (moved >= 6) return;
    const [body] = Query.point(bubbles, { x: event.offsetX, y: event.offsetY });
    if (!body) return;
    Composite.remove(engine.world, body);
    bubbles = bubbles.filter((bubble) => bubble !== body);
    openProject(body.plugin.data, body.position.x, body.position.y);
  });

  // Matter runs only while the stage is laid out, on screen and the tab is visible.
  let shown = false;
  let inView = false;
  let running = false;

  function sync() {
    const run = shown && inView && !document.hidden;
    if (run === running) return;
    running = run;
    if (run) {
      Render.run(render);
      Runner.run(runner, engine);
    } else {
      Render.stop(render);
      Runner.stop(runner);
    }
  }

  new IntersectionObserver(([entry]) => {
    inView = entry.isIntersecting;
    sync();
  }).observe(stage);
  document.addEventListener('visibilitychange', sync);

  // Size the walls, the frame and the bubbles were last laid out for; the stage keeps them while it is hidden.
  let laidWidth = 0;
  let laidHeight = 0;

  function layOut(width, height) {
    Render.setSize(render, width, height);
    buildWalls(width, height);
    buildFrame(width, height);
    spawnBubbles(width, height);
    laidWidth = width;
    laidHeight = height;
  }

  watchStage({
    // Shown again at the same size, the stage only brings back a bubble that was clicked away. A new size rebuilds
    // walls and bodies, but never in the middle of a warp: that waits for it to end.
    onShow(width, height) {
      const relayOut = () => {
        if (width !== laidWidth || height !== laidHeight) layOut(width, height);
        else if (bubbles.length < projects.length) spawnBubbles(width, height, true);
        buildSprites();
        readStage();
      };
      if (warpRunning() && laidWidth > 0 && (width !== laidWidth || height !== laidHeight)) {
        window.addEventListener('warp:end', relayOut, { once: true });
      } else {
        relayOut();
      }
      shown = true;
      sync();
    },
    onResize(width, height) {
      Render.setSize(render, width, height);
      buildWalls(width, height);
      buildFrame(width, height);
      keepInside(width, height);
      laidWidth = width;
      laidHeight = height;
      buildSprites();
      readStage();
    },
    onHide() {
      shown = false;
      sync();
    },
  });

  // Dev server only (Vite drops this from the build): lets a test pin a bubble and count impacts, sparks and rescues.
  if (import.meta.env.DEV) {
    window.__bubbleDebug = {
      Body,
      bubbles: () => bubbles,
      impacts: () => impactCount,
      sparks: () => sparkCount,
      pool: impacts,
      contained: () => ({ rescues, escapes, width: laidWidth, height: laidHeight }),
      wobble: () => bubbles.map((body) => ({ squash: squash[body.plugin.slot], stretch: stretch[body.plugin.slot] })),
    };
  }
}

// Reduced motion: no physics loop, the bubbles are plain buttons at the centre of their cells, with the same cropped logo.
function startStatic() {
  canvas.hidden = true;
  const buttons = projects.map((project, index) => {
    const { name, radius, logo } = project;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'bubble';
    const image = document.createElement('img');
    image.alt = '';
    image.style.mixBlendMode = logo.blend === 'source-over' ? 'normal' : logo.blend;
    const label = document.createElement('span');
    label.textContent = name;
    button.append(image, label);
    logoImages[index].then((source) => {
      if (source) image.src = logoSprite(logo, source, 2 * radius * LOGO_SHARE, window.devicePixelRatio || 1).toDataURL();
      else image.remove();
    });
    button.style.width = `${radius * 2}px`;
    button.style.height = `${radius * 2}px`;
    button.addEventListener('click', () => {
      if (opening) return;
      button.hidden = true;
      openProject(project, button.offsetLeft, button.offsetTop);
    });
    stage.append(button);
    return button;
  });

  const layout = (width, height) => {
    cells(width, height).forEach((cell, index) => {
      buttons[index].style.left = `${cell.x}px`;
      buttons[index].style.top = `${cell.y}px`;
    });
  };

  watchStage({
    onShow(width, height) {
      buttons.forEach((button) => { button.hidden = false; });
      layout(width, height);
    },
    onResize: layout,
    onHide() {},
  });
}

if (reducedMotion) startStatic();
else startPhysics();
