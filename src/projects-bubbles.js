import Matter from 'matter-js';
import gsap from 'gsap';

const { Bodies, Body, Composite, Engine, Events, Mouse, MouseConstraint, Query, Render, Runner } = Matter;

// If more projects are added later, the stage is split into one cell per project to keep them widely spaced.
const projects = [
  { slug: 'rugtraak', name: 'RUGTRAAK', radius: 95 },
  { slug: 'sqkeys', name: 'SQ Keys', radius: 85 },
];

const DRIFT_FORCE = 0.00007; // per unit of mass, applied every step
const MAX_SPEED = 1.2;
const WALL = 100;

const stage = document.getElementById('bubble-stage');
const canvas = document.getElementById('bubble-canvas');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const random = (min, max) => min + Math.random() * (max - min);
const clamp = (value, min, max) => Math.min(Math.max(value, min), Math.max(min, max));

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

// A popped bubble bursts, then the page moves to that project once the burst has played.
let opening = false;

function openProject(slug, x, y) {
  opening = true;
  burst(x, y);
  window.setTimeout(() => {
    opening = false;
    window.location.hash = `projets/${slug}`;
  }, 600);
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
    constraint: { stiffness: 0.2, render: { visible: false } },
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
      const { slug, name, radius } = projects[index];
      const spreadX = Math.max(0, cell.width / 2 - radius - 12);
      const spreadY = Math.max(0, cell.height / 2 - radius - 12);
      const body = Bodies.circle(cell.x + random(-spreadX, spreadX), cell.y + random(-spreadY, spreadY), radius, {
        frictionAir: 0.045, // viscous drag
        restitution: 0.65, // soft bounce
        density: 0.0008, // light bodies
        render: { fillStyle: 'rgba(201, 169, 106, 0.10)', strokeStyle: 'rgba(201, 169, 106, 0.75)', lineWidth: 2 },
      });
      body.plugin.data = { slug, name };
      body.plugin.drift = { angle: random(0, Math.PI * 2), until: 0 };
      const speed = random(0.3, 0.6);
      Body.setVelocity(body, { x: Math.cos(body.plugin.drift.angle) * speed, y: Math.sin(body.plugin.drift.angle) * speed });
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

  // Each bubble is pushed very gently in a direction that changes every 3.5 to 5 seconds, and never moves fast.
  Events.on(engine, 'beforeUpdate', ({ timestamp }) => {
    bubbles.forEach((body) => {
      const { drift } = body.plugin;
      if (timestamp >= drift.until) {
        drift.angle = random(0, Math.PI * 2);
        drift.until = timestamp + random(3500, 5000);
      }
      const force = DRIFT_FORCE * body.mass;
      Body.applyForce(body, body.position, { x: Math.cos(drift.angle) * force, y: Math.sin(drift.angle) * force });
      if (body !== mouseConstraint.body && body.speed > MAX_SPEED) Body.setSpeed(body, MAX_SPEED);
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

  // Soap-film sheen and project name, drawn over Matter's own circles.
  Events.on(render, 'afterRender', () => {
    const context = render.context;
    const ratio = render.options.pixelRatio;
    context.save();
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    bubbles.forEach((body) => {
      const { x, y } = body.position;
      const radius = body.circleRadius;
      const sheenX = x - radius * 0.4;
      const sheenY = y - radius * 0.4;
      const sheen = context.createRadialGradient(sheenX, sheenY, 0, sheenX, sheenY, radius * 0.25);
      sheen.addColorStop(0, 'rgba(255, 255, 255, 0.25)');
      sheen.addColorStop(1, 'rgba(255, 255, 255, 0)');
      context.fillStyle = sheen;
      context.beginPath();
      context.arc(sheenX, sheenY, radius * 0.25, 0, Math.PI * 2);
      context.fill();

      context.font = "500 15px 'IBM Plex Sans', system-ui";
      context.fillStyle = '#F0E6CC';
      context.fillText(body.plugin.data.name, x, y);
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
    openProject(body.plugin.data.slug, body.position.x, body.position.y);
  });

  watchStage({
    onShow(width, height) {
      Render.setSize(render, width, height);
      buildWalls(width, height);
      spawnBubbles(width, height);
      Render.run(render);
      Runner.run(runner, engine);
    },
    onResize(width, height) {
      Render.setSize(render, width, height);
      buildWalls(width, height);
      keepInside(width, height);
    },
    onHide() {
      Render.stop(render);
      Runner.stop(runner);
    },
  });
}

// Reduced motion: no physics loop, the bubbles are plain buttons at the centre of their cells.
function startStatic() {
  canvas.hidden = true;
  const buttons = projects.map(({ slug, name, radius }) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'bubble';
    button.textContent = name;
    button.style.width = `${radius * 2}px`;
    button.style.height = `${radius * 2}px`;
    button.addEventListener('click', () => {
      if (opening) return;
      button.hidden = true;
      openProject(slug, button.offsetLeft, button.offsetTop);
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
