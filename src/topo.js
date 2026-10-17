import { createNoise3D } from 'simplex-noise';
import { cursorState } from './cursor.js';

// RUGTRAAK background: contour lines of a slowly moving noise relief, with a hill that follows the paint blob and
// ripples that spread from it while it moves. Mounted by themes.js on its canvas; every buffer is allocated on layout,
// nothing per frame. The contours come from a hand-written marching squares, one path and one stroke per level.
const SMALL_SCREEN = 760; // px, below this width the coarser grid applies (decided once, at load)
const TOPO_CELL = 18; // px between grid nodes, desktop
const TOPO_CELL_SMALL = 28; // same, small screens
const TOPO_LEVELS = 14;
const TOPO_MAJOR_EVERY = 4; // every 4th line is a major contour
const TOPO_DPR_MAX = 1.5;
const NOISE_SCALE = 0.0026; // relief frequency, per px
const NOISE_SPEED = 0.045; // relief evolution, per second
const NOISE_EVERY = 2; // the relief is resampled every 2nd frame; the hill and ripples every frame
const BUMP_HEIGHT = 1.15; // height of the hill under the blob, in relief units (the noise spans -1..1)
const BUMP_RADIUS = 260; // px, the hill's radius (two standard deviations)
const BUMP_REACH = 3; // nodes further than this many radii from the blob keep the bare relief
const RIPPLE_AMP = 0.32; // ripple height at full blob speed
const RIPPLE_RADIUS = 300; // px, how far the ripples carry (two standard deviations)
const RIPPLE_WAVELENGTH = 22; // px per radian of the wave
const RIPPLE_SPEED = 7; // rad/s, outward travel of the wave
const RIPPLE_FULL_SPEED = 18; // blob speed in px per frame that gives full ripples
const RIPPLE_RISE = 0.2; // share of the way to a stronger ripple per frame
const RIPPLE_DECAY = 0.04; // share of the ripple lost per frame once the blob slows
const LEVEL_LOW = -0.85; // relief value of the lowest and the highest contour
const LEVEL_HIGH = 1.55;
const COLOR_LOW = [0x99, 0x45, 0xff]; // #9945FF on the low contours
const COLOR_HIGH = [0x00, 0xd1, 0xff]; // #00D1FF on the high ones
const MINOR_ALPHA = [0.1, 0.22]; // low to high
const MAJOR_ALPHA = [0.3, 0.38]; // never above 0.38: decoration
const MINOR_WIDTH = 1;
const MAJOR_WIDTH = 1.5;
const GHOST_PERIOD = 40; // s, Lissajous path of the hill when there is no pointer at all
const GHOST_X = 0.34; // amplitude, as a share of the width
const GHOST_Y = 0.28;

const noise3D = createNoise3D();
const small = window.innerWidth < SMALL_SCREEN;
const cell = small ? TOPO_CELL_SMALL : TOPO_CELL;
const sigma = BUMP_RADIUS / 2;
const rippleSigma = RIPPLE_RADIUS / 2;

// One stroke style per level, from purple to blue, the majors brighter: built once.
const levels = new Float32Array(TOPO_LEVELS);
const styles = [];
const widths = new Float32Array(TOPO_LEVELS);
for (let k = 0; k < TOPO_LEVELS; k += 1) {
  const share = k / (TOPO_LEVELS - 1);
  levels[k] = LEVEL_LOW + (LEVEL_HIGH - LEVEL_LOW) * share;
  const major = k % TOPO_MAJOR_EVERY === TOPO_MAJOR_EVERY - 1;
  const [low, high] = major ? MAJOR_ALPHA : MINOR_ALPHA;
  const mix = (i) => Math.round(COLOR_LOW[i] + (COLOR_HIGH[i] - COLOR_LOW[i]) * share);
  styles.push(`rgba(${mix(0)}, ${mix(1)}, ${mix(2)}, ${(low + (high - low) * share).toFixed(3)})`);
  widths[k] = major ? MAJOR_WIDTH : MINOR_WIDTH;
}

let context = null;
let width = 0;
let height = 0;
let columns = 0;
let rows = 0;
let relief = null; // noise per node
let field = null; // relief plus hill and ripples per node
let cellMin = null; // per cell, so a level is skipped where it cannot cross
let cellMax = null;
let frame = 0;
let ripple = 0; // 0..1, ripple strength from the blob's speed
let touchX = -1; // last touch, for devices without a fine pointer
let touchY = -1;
let edgeX = 0; // crossing point of the last edge asked for
let edgeY = 0;

window.addEventListener('pointerdown', (event) => {
  if (event.pointerType !== 'mouse') {
    touchX = event.clientX;
    touchY = event.clientY;
  }
}, { passive: true });
window.addEventListener('pointermove', (event) => {
  if (event.pointerType !== 'mouse') {
    touchX = event.clientX;
    touchY = event.clientY;
  }
}, { passive: true });

function sampleRelief(time) {
  const z = time * NOISE_SPEED;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      relief[row * columns + column] = noise3D(column * cell * NOISE_SCALE, row * cell * NOISE_SCALE, z);
    }
  }
}

// The hill and the ripples, added only to the nodes within reach of the source point.
function shape(time, x, y, energy) {
  field.set(relief);
  const reach = BUMP_RADIUS * BUMP_REACH;
  const reach2 = reach * reach;
  const first = Math.max(0, Math.floor((x - reach) / cell));
  const last = Math.min(columns - 1, Math.ceil((x + reach) / cell));
  const top = Math.max(0, Math.floor((y - reach) / cell));
  const bottom = Math.min(rows - 1, Math.ceil((y + reach) / cell));
  const phase = time * RIPPLE_SPEED;
  for (let row = top; row <= bottom; row += 1) {
    const dy = row * cell - y;
    for (let column = first; column <= last; column += 1) {
      const dx = column * cell - x;
      const d2 = dx * dx + dy * dy;
      if (d2 > reach2) continue;
      let lift = BUMP_HEIGHT * Math.exp(-d2 / (2 * sigma * sigma));
      if (energy > 0.001) {
        const d = Math.sqrt(d2);
        lift += RIPPLE_AMP * energy * Math.exp(-d2 / (2 * rippleSigma * rippleSigma)) * Math.cos(d / RIPPLE_WAVELENGTH - phase);
      }
      field[row * columns + column] += lift;
    }
  }
}

// Where the level crosses edge e of the cell at (x0, y0): 0 top, 1 right, 2 bottom, 3 left. Writes edgeX, edgeY.
function edge(e, level, x0, y0, tl, tr, br, bl) {
  switch (e) {
    case 0: edgeX = x0 + cell * ((level - tl) / (tr - tl)); edgeY = y0; break;
    case 1: edgeX = x0 + cell; edgeY = y0 + cell * ((level - tr) / (br - tr)); break;
    case 2: edgeX = x0 + cell * ((level - bl) / (br - bl)); edgeY = y0 + cell; break;
    default: edgeX = x0; edgeY = y0 + cell * ((level - tl) / (bl - tl)); break;
  }
}

function segment(a, b, level, x0, y0, tl, tr, br, bl) {
  edge(a, level, x0, y0, tl, tr, br, bl);
  context.moveTo(edgeX, edgeY);
  edge(b, level, x0, y0, tl, tr, br, bl);
  context.lineTo(edgeX, edgeY);
}

function contours() {
  const cellColumns = columns - 1;
  for (let row = 0; row < rows - 1; row += 1) {
    for (let column = 0; column < cellColumns; column += 1) {
      const i = row * columns + column;
      const a = field[i];
      const b = field[i + 1];
      const c = field[i + columns + 1];
      const d = field[i + columns];
      const c0 = row * cellColumns + column;
      cellMin[c0] = Math.min(a, b, c, d);
      cellMax[c0] = Math.max(a, b, c, d);
    }
  }
  context.lineCap = 'round';
  for (let k = 0; k < TOPO_LEVELS; k += 1) {
    const level = levels[k];
    context.strokeStyle = styles[k];
    context.lineWidth = widths[k];
    context.beginPath();
    for (let row = 0; row < rows - 1; row += 1) {
      const y0 = row * cell;
      for (let column = 0; column < cellColumns; column += 1) {
        const c0 = row * cellColumns + column;
        if (cellMin[c0] > level || cellMax[c0] < level) continue;
        const i = row * columns + column;
        const tl = field[i];
        const tr = field[i + 1];
        const br = field[i + columns + 1];
        const bl = field[i + columns];
        const x0 = column * cell;
        const index = (tl > level ? 8 : 0) | (tr > level ? 4 : 0) | (br > level ? 2 : 0) | (bl > level ? 1 : 0);
        switch (index) {
          case 1: case 14: segment(3, 2, level, x0, y0, tl, tr, br, bl); break;
          case 2: case 13: segment(2, 1, level, x0, y0, tl, tr, br, bl); break;
          case 3: case 12: segment(3, 1, level, x0, y0, tl, tr, br, bl); break;
          case 4: case 11: segment(0, 1, level, x0, y0, tl, tr, br, bl); break;
          case 6: case 9: segment(0, 2, level, x0, y0, tl, tr, br, bl); break;
          case 7: case 8: segment(3, 0, level, x0, y0, tl, tr, br, bl); break;
          case 5: // saddles: two segments
            segment(3, 0, level, x0, y0, tl, tr, br, bl);
            segment(2, 1, level, x0, y0, tl, tr, br, bl);
            break;
          case 10:
            segment(0, 1, level, x0, y0, tl, tr, br, bl);
            segment(3, 2, level, x0, y0, tl, tr, br, bl);
            break;
          default: break;
        }
      }
    }
    context.stroke();
  }
}

// The effect object themes.js drives: its own canvas opacity and pixel ratio, no reading-column mask.
export const topo = {
  opacity: 1,
  masked: false,
  maxDpr: TOPO_DPR_MAX,
  attach(target, viewportWidth, viewportHeight) {
    context = target;
    width = viewportWidth;
    height = viewportHeight;
  },
  layout(viewportWidth, viewportHeight) {
    width = viewportWidth;
    height = viewportHeight;
    const nextColumns = Math.ceil(width / cell) + 1;
    const nextRows = Math.ceil(height / cell) + 1;
    if (nextColumns === columns && nextRows === rows && relief) return;
    columns = nextColumns;
    rows = nextRows;
    relief = new Float32Array(columns * rows);
    field = new Float32Array(columns * rows);
    cellMin = new Float32Array((columns - 1) * (rows - 1));
    cellMax = new Float32Array((columns - 1) * (rows - 1));
    frame = 0;
  },
  start() {
    frame = 0;
  },
  draw(time) {
    if (!relief) return;
    if (frame % NOISE_EVERY === 0) sampleRelief(time);
    frame += 1;
    // The hill sits under the lagging blob; without a fine pointer, under the last touch, or on a slow ghost path.
    let x;
    let y;
    if (cursorState.active || cursorState.charge > 0) {
      x = cursorState.x;
      y = cursorState.y;
    } else if (touchX >= 0) {
      x = touchX;
      y = touchY;
    } else {
      const angle = (time / GHOST_PERIOD) * Math.PI * 2;
      x = width * (0.5 + GHOST_X * Math.sin(angle));
      y = height * (0.5 + GHOST_Y * Math.sin(angle * 1.5 + 1));
    }
    const speed = Math.min(1, Math.hypot(cursorState.vx, cursorState.vy) / RIPPLE_FULL_SPEED);
    ripple += speed > ripple ? (speed - ripple) * RIPPLE_RISE : -ripple * RIPPLE_DECAY;
    shape(time, x, y, ripple);
    contours();
  },
  // Reduced motion: one frame of the bare relief, no hill and no ripples.
  drawStatic() {
    if (!relief) return;
    sampleRelief(0);
    field.set(relief);
    contours();
  },
};
