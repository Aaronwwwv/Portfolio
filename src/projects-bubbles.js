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
// Frame: the rounded rectangle the walls enclose, invisible but for a segment of light travelling around it and the sides
// the bubbles hit, which light up for a moment around the contact point.
const FRAME_RADIUS = 14; // px
const FRAME_COLOR = '#C9A96A';
const FRAME_WIDTH = 1.5; // px, stroke of the segment and the impacts
const SEGMENT_FRACTION = 0.16; // share of the perimeter the travelling segment covers
const SEGMENT_SPEED = 14; // s per lap
const SEGMENT_ALPHA = 0.35;
const IMPACT_MAX = 6; // impacts shown at once; a new one replaces the oldest
const IMPACT_LIFE_MS = 700;
const IMPACT_LENGTH = 140; // px, lit length of the side for the strongest impact
const IMPACT_ALPHA = 0.8;
const IMPACT_RING = 6; // px, radius the ring at the contact point grows to
const IMPACT_MIN_SPEED = 0.4; // px per step toward the wall; below it a touch is resting contact and shows nothing
const IMPACT_FULL_SPEED = 6; // px per step toward the wall for a full-strength impact
const IMPACT_MIN_STRENGTH = 0.2; // the faintest impact that does show

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

  // Frame geometry, rebuilt on show and resize only: the path the walls enclose, inset by half the stroke so it is never
  // clipped, its perimeter for the dash, and each side as a straight line between its rounded corners.
  const frame = { path: null, perimeter: 0, dash: [0, 0], sides: {} };

  function buildFrame(width, height) {
    const inset = FRAME_WIDTH / 2;
    const left = inset;
    const top = inset;
    const right = width - inset;
    const bottom = height - inset;
    const r = Math.min(FRAME_RADIUS, (right - left) / 2, (bottom - top) / 2);
    // Starts at the top left end of the top side, clockwise.
    const path = new Path2D();
    path.moveTo(left + r, top);
    path.arcTo(right, top, right, bottom, r);
    path.arcTo(right, bottom, left, bottom, r);
    path.arcTo(left, bottom, left, top, r);
    path.arcTo(left, top, right, top, r);
    path.closePath();
    frame.path = path;
    frame.perimeter = 2 * (right - left - 2 * r) + 2 * (bottom - top - 2 * r) + 2 * Math.PI * r;
    frame.dash[0] = frame.perimeter * SEGMENT_FRACTION;
    frame.dash[1] = frame.perimeter - frame.dash[0];
    // Per side: the fixed coordinate, and the range the lit segment may cover along it.
    frame.sides = {
      top: { horizontal: true, at: top, from: left + r, to: right - r },
      bottom: { horizontal: true, at: bottom, from: left + r, to: right - r },
      left: { horizontal: false, at: left, from: top + r, to: bottom - r },
      right: { horizontal: false, at: right, from: top + r, to: bottom - r },
    };
  }

  // Impacts in a fixed pool, the oldest overwritten: nothing is allocated per hit or per frame.
  const impacts = Array.from({ length: IMPACT_MAX }, () => ({ active: false, side: 'top', along: 0, strength: 0, start: 0 }));
  let nextImpact = 0;
  let impactCount = 0; // read by the dev hook only

  // Called before Matter resolves the contact, so the bubble's velocity is still the one it hit with.
  function addImpact(wall, bubble) {
    const { side } = wall.plugin;
    const horizontal = side === 'top' || side === 'bottom';
    const speed = horizontal ? bubble.velocity.y : bubble.velocity.x;
    const toward = side === 'top' || side === 'left' ? -speed : speed;
    if (!(toward >= IMPACT_MIN_SPEED)) return;
    const impact = impacts[nextImpact];
    nextImpact = (nextImpact + 1) % IMPACT_MAX;
    impact.active = true;
    impact.side = side;
    impact.along = horizontal ? bubble.position.x : bubble.position.y;
    impact.strength = clamp(toward / IMPACT_FULL_SPEED, IMPACT_MIN_STRENGTH, 1);
    impact.start = performance.now();
    impactCount += 1;
  }

  // The travelling light: one dash of the frame's length fraction, its offset moved along the perimeter with time.
  function drawSegment(context, now) {
    if (!frame.path) return;
    context.save();
    context.globalAlpha = SEGMENT_ALPHA;
    context.strokeStyle = FRAME_COLOR;
    context.lineWidth = FRAME_WIDTH;
    context.lineCap = 'round';
    context.setLineDash(frame.dash);
    context.lineDashOffset = -((now / 1000 / SEGMENT_SPEED) % 1) * frame.perimeter;
    context.stroke(frame.path);
    context.restore();
  }

  // Each impact: the side lit around the contact point, growing out to its length while it fades, and a small ring.
  function drawImpacts(context, now) {
    context.save();
    context.strokeStyle = FRAME_COLOR;
    context.lineWidth = FRAME_WIDTH;
    context.lineCap = 'round';
    impacts.forEach((impact) => {
      if (!impact.active) return;
      const t = (now - impact.start) / IMPACT_LIFE_MS;
      if (t >= 1) {
        impact.active = false;
        return;
      }
      const side = frame.sides[impact.side];
      if (!side) return;
      const grow = 1 - (1 - t) ** 3;
      const half = (IMPACT_LENGTH * impact.strength * grow) / 2;
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
      context.beginPath();
      if (side.horizontal) context.arc(along, side.at, IMPACT_RING * grow, 0, Math.PI * 2);
      else context.arc(side.at, along, IMPACT_RING * grow, 0, Math.PI * 2);
      context.stroke();
    });
    context.restore();
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
      body.plugin.drift = { angle: random(0, Math.PI * 2), until: 0 };
      body.plugin.spin = { until: 0 };
      body.plugin.light = { angle: null };
      const speed = random(0.3, 0.6);
      Body.setVelocity(body, { x: Math.cos(body.plugin.drift.angle) * speed, y: Math.sin(body.plugin.drift.angle) * speed });
      Body.setAngularVelocity(body, random(-ANGULAR_START, ANGULAR_START));
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
        Body.applyForce(body, body.position, { x: Math.cos(drift.angle) * force, y: Math.sin(drift.angle) * force });
      }
      if (speed > CRUISE_SPEED) {
        const keep = Math.min(THROW_DECAY, SAFETY_SPEED / speed);
        Body.setVelocity(body, { x: body.velocity.x * keep, y: body.velocity.y * keep });
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

  // At these speeds Matter treats a contact as resting, so the drift turns away from whatever was touched.
  // A bubble meeting a wall also lights that side of the frame.
  Events.on(engine, 'collisionStart', ({ pairs }) => {
    pairs.forEach(({ bodyA, bodyB, collision }) => {
      if (bodyA.plugin.side && bodyB.plugin.data) addImpact(bodyA, bodyB);
      else if (bodyB.plugin.side && bodyA.plugin.data) addImpact(bodyB, bodyA);
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

  // Per frame: the travelling light, then per bubble its body, logo turned by the body angle, the glint turned toward
  // the light and the label, which never turns; the impacts last, so a bubble resting on the lit side never hides its ring.
  Events.on(render, 'afterRender', () => {
    const context = render.context;
    const ratio = render.options.pixelRatio;
    const now = performance.now();
    context.save();
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    drawSegment(context, now);
    bubbles.forEach((body) => {
      const { slug, logo } = body.plugin.data;
      const set = sprites.get(slug);
      if (!set) return;
      const { x, y } = body.position;
      const radius = body.circleRadius;
      const outer = radius + GLOW_SIZE;
      context.drawImage(set.body, x - outer, y - outer, 2 * outer, 2 * outer);
      if (set.logo) {
        const half = radius * LOGO_SHARE;
        context.save();
        context.translate(x, y);
        context.rotate(body.angle);
        context.globalCompositeOperation = logo.blend;
        context.drawImage(set.logo, -half, -half, 2 * half, 2 * half);
        context.restore();
      }
      const { highlight } = set;
      context.save();
      context.translate(x, y);
      context.rotate(glintAngle(body));
      context.drawImage(highlight.canvas, radius * HIGHLIGHT_DISTANCE - highlight.width / 2, -highlight.height / 2, highlight.width, highlight.height);
      context.restore();
      const { label } = set;
      context.drawImage(label.canvas, x - label.width / 2, y + radius + LABEL_GAP - label.height / 2, label.width, label.height);
    });
    drawImpacts(context, now);
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

  // Dev server only (Vite drops this from the build): lets a test pin a bubble and count the impacts.
  if (import.meta.env.DEV) window.__bubbleDebug = { Body, bubbles: () => bubbles, impacts: () => impactCount, pool: impacts };
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
