import Matter from 'matter-js';
import gsap from 'gsap';

const { Bodies, Body, Composite, Engine, Events, Mouse, MouseConstraint, Query, Render, Runner } = Matter;

// If more projects are added later, the stage is split into one cell per project to keep them widely spaced.
// Each logo is cropped from its source image: a circle of radius r around (cx, cy), in source pixels, found from the pixels.
// RUGTRAAK: emblem (ring, R and its slashes) spans x 530..1133, y 129..655; the word below starts at y 694, so the crop
// stops at cutBelow. Its near-black background melts into the bubble body with the lighten blend.
// Swissquote: orange disc spans x 36..436, y 37..437 on an opaque grey square; the clip stays just inside the disc edge.
const projects = [
  {
    slug: 'rugtraak', name: 'RUGTRAAK', radius: 95,
    logo: { src: new URL('./assets/logos/RUGTRAAK.jpeg', import.meta.url).href, cx: 831.5, cy: 392, r: 378, cutBelow: 693.5, blend: 'lighten', feather: true },
  },
  {
    slug: 'sqkeys', name: 'SQ Keys', radius: 85,
    logo: { src: new URL('./assets/logos/SwissQuote.png', import.meta.url).href, cx: 236, cy: 237, r: 199, blend: 'source-over' },
  },
];

const DRIFT_FORCE = 0.00007; // per unit of mass, applied every step
const CRUISE_SPEED = 0.8; // ambient drift; anything faster is a throw that decays back to it
const THROW_DECAY = 0.987; // velocity kept per step above cruise speed
const SAFETY_SPEED = 45; // hard cap per step, only so a body can never tunnel through a wall
const WALL = 100;
const LIGHT = { x: -40, y: -40 }; // where the light comes from, relative to each bubble: the highlight faces it and never turns
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
const HIGHLIGHT_COLOR = 'rgba(255, 255, 255, 0.3)';
const HIGHLIGHT_WIDTH = 1.5; // px
const HIGHLIGHT_INSET = 7; // px between the rim and the highlight arc
const HIGHLIGHT_SPAN = 1.1; // rad, length of the arc
const LABEL_FONT = '500 12px "JetBrains Mono", ui-monospace, monospace';
const LABEL_SPACING = 0.12; // em
const LABEL_COLOR = '#F0E6CC';
const LABEL_GAP = 18; // px between the bubble and the middle of its label

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

// Thin arc inside the rim, on the side facing LIGHT. Same size as the body sprite.
function highlightSprite(radius, ratio) {
  const size = 2 * (radius + GLOW_SIZE);
  const { canvas, context } = sprite(size, size, ratio);
  const facing = Math.atan2(LIGHT.y, LIGHT.x);
  context.strokeStyle = HIGHLIGHT_COLOR;
  context.lineWidth = HIGHLIGHT_WIDTH;
  context.lineCap = 'round';
  context.beginPath();
  context.arc(size / 2, size / 2, radius - HIGHLIGHT_INSET, facing - HIGHLIGHT_SPAN / 2, facing + HIGHLIGHT_SPAN / 2);
  context.stroke();
  return canvas;
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

  function buildWalls(width, height) {
    const options = { isStatic: true, render: { visible: false } };
    Composite.remove(engine.world, walls);
    walls = [
      Bodies.rectangle(width / 2, -WALL / 2, width + WALL * 2, WALL, options),
      Bodies.rectangle(width / 2, height + WALL / 2, width + WALL * 2, WALL, options),
      Bodies.rectangle(-WALL / 2, height / 2, WALL, height + WALL * 2, options),
      Bodies.rectangle(width + WALL / 2, height / 2, WALL, height + WALL * 2, options),
    ];
    Composite.add(engine.world, walls);
  }

  function spawnBubbles(width, height) {
    Composite.remove(engine.world, bubbles);
    bubbles = cells(width, height).map((cell, index) => {
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
      const speed = random(0.3, 0.6);
      Body.setVelocity(body, { x: Math.cos(body.plugin.drift.angle) * speed, y: Math.sin(body.plugin.drift.angle) * speed });
      Body.setAngularVelocity(body, random(-ANGULAR_START, ANGULAR_START));
      return body;
    });
    Composite.add(engine.world, bubbles);
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
  Events.on(engine, 'collisionStart', ({ pairs }) => {
    pairs.forEach(({ bodyA, bodyB, collision }) => {
      const away = Math.atan2(collision.normal.y, collision.normal.x);
      if (bodyA.plugin.drift) bodyA.plugin.drift.angle = away + random(-0.6, 0.6);
      if (bodyB.plugin.drift) bodyB.plugin.drift.angle = away + Math.PI + random(-0.6, 0.6);
    });
  });

  // Sprites per project, rebuilt when the stage is shown or resized, at the device pixel ratio of that moment.
  let sprites = new Map();
  let spriteBuild = 0;

  async function buildSprites() {
    const build = ++spriteBuild;
    const ratio = window.devicePixelRatio || 1;
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

  // Per frame: body, logo turned by the body angle, then the highlight and the label, which never turn.
  Events.on(render, 'afterRender', () => {
    const context = render.context;
    const ratio = render.options.pixelRatio;
    context.save();
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
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
      context.drawImage(set.highlight, x - outer, y - outer, 2 * outer, 2 * outer);
      const { label } = set;
      context.drawImage(label.canvas, x - label.width / 2, y + radius + LABEL_GAP - label.height / 2, label.width, label.height);
    });
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

  watchStage({
    onShow(width, height) {
      Render.setSize(render, width, height);
      buildWalls(width, height);
      spawnBubbles(width, height);
      buildSprites();
      shown = true;
      sync();
    },
    onResize(width, height) {
      Render.setSize(render, width, height);
      buildWalls(width, height);
      keepInside(width, height);
      buildSprites();
    },
    onHide() {
      shown = false;
      sync();
    },
  });
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
