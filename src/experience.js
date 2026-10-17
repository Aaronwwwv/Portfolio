import gsap from 'gsap';

// Experience staircase on #parcours: each link floats on its own spot (style.css) and, under a fine pointer, tilts toward it.
// Each badge is cropped once from its source image: a circle of radius r around (cx, cy), in source pixels, found from the pixels.
// Mercor: 413x393, white; the M spans x 61..351, y 57..310, its smallest enclosing circle is r 179 at (206, 198.5), 8 % of margin.
// Auxiga: 680x472, white with a map on the right; the X and its dot span x 31..90, y 210..263, enclosing circle r 36 at
// (57, 237), 15 % of margin, still clear of the A of the wordmark from x 99.
// Aaron Tutorat: 1664x928, dark blue-black; the AT spans x 515..1161, y 230..701, enclosing circle r 378 at (852, 461.5), 10 % of margin.
// That square (x 437..1267, y 46..876) is stored resampled to 128x128 in aarontutorat-badge.png (24 KB instead of 1.6 MB).
const LOGOS = {
  mercor: { src: new URL('./assets/logos/mercor.png', import.meta.url).href, cx: 206, cy: 198.5, r: 194 },
  auxiga: { src: new URL('./assets/logos/auxiga.png', import.meta.url).href, cx: 57, cy: 237, r: 41.5 },
  tutorat: { src: new URL('./assets/logos/aarontutorat-badge.png', import.meta.url).href, cx: 64, cy: 64, r: 64 },
};
const BADGE_SIZE = 112; // px, side of the cropped badge: twice the 56 px desktop badge
const TILT_MAX = 8; // deg, on each axis
const SHADOW_SHIFT = 10; // px, how far the shadow moves away from the tilt at full tilt
const SHADOW_DROP = 10; // px, vertical offset of the shadow on a flat link
const FOLLOW = 0.12; // share of the distance to the target tilt covered per frame at 60 fps
const SETTLED = 0.01; // deg, below this the tilt snaps to its target

const stairs = document.querySelector('.exp-stairs');
const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

function cropBadge(logo, image) {
  const canvas = document.createElement('canvas');
  canvas.width = BADGE_SIZE;
  canvas.height = BADGE_SIZE;
  const context = canvas.getContext('2d');
  context.imageSmoothingQuality = 'high';
  context.beginPath();
  context.arc(BADGE_SIZE / 2, BADGE_SIZE / 2, BADGE_SIZE / 2, 0, Math.PI * 2);
  context.clip();
  context.drawImage(image, logo.cx - logo.r, logo.cy - logo.r, 2 * logo.r, 2 * logo.r, 0, 0, BADGE_SIZE, BADGE_SIZE);
  return canvas.toDataURL();
}

stairs.querySelectorAll('.exp-badge').forEach((badge) => {
  const logo = LOGOS[badge.dataset.logo];
  const image = new Image();
  image.onload = () => { badge.src = cropBadge(logo, image); };
  image.onerror = () => badge.remove();
  image.src = logo.src;
});

// Tilt per link: rx, ry the current angles, tx, ty the targets; rect is the floating step, read outside the frame loop.
const cards = [...stairs.querySelectorAll('.exp-link')].map((link) => ({ link, step: link.parentElement, rect: null, rx: 0, ry: 0, tx: 0, ty: 0 }));
let moving = false;

function measure() {
  cards.forEach((card) => { card.rect = card.step.getBoundingClientRect(); });
}

function aim(x, y) {
  cards.forEach((card) => {
    const { left, top, width, height } = card.rect;
    const inside = x >= left && x <= left + width && y >= top && y <= top + height;
    // The side under the pointer sinks: right of centre turns the link about Y, below centre about X.
    card.ty = inside ? ((x - left) / width * 2 - 1) * TILT_MAX : 0;
    card.tx = inside ? -((y - top) / height * 2 - 1) * TILT_MAX : 0;
  });
  moving = true;
}

function flatten() {
  cards.forEach((card) => { card.tx = 0; card.ty = 0; });
  moving = true;
}

function tick(time, deltaTime) {
  if (!moving) return;
  const follow = 1 - (1 - FOLLOW) ** (Math.min(deltaTime, 100) / (1000 / 60));
  moving = false;
  cards.forEach((card) => {
    if (card.rx === card.tx && card.ry === card.ty) return;
    card.rx += (card.tx - card.rx) * follow;
    card.ry += (card.ty - card.ry) * follow;
    if (Math.abs(card.tx - card.rx) < SETTLED && Math.abs(card.ty - card.ry) < SETTLED) {
      card.rx = card.tx;
      card.ry = card.ty;
    } else {
      moving = true;
    }
    const { style } = card.link;
    if (card.rx === 0 && card.ry === 0) {
      style.transform = '';
      style.boxShadow = '';
      return;
    }
    // The shadow slides opposite to the tilt: away from the side that sinks.
    const shadowX = (-card.ry / TILT_MAX) * SHADOW_SHIFT;
    const shadowY = SHADOW_DROP + (card.rx / TILT_MAX) * SHADOW_SHIFT;
    style.transform = `perspective(800px) rotateX(${card.rx.toFixed(2)}deg) rotateY(${card.ry.toFixed(2)}deg)`;
    style.boxShadow = `${shadowX.toFixed(1)}px ${shadowY.toFixed(1)}px 28px rgba(0, 0, 0, 0.55)`;
  });
}

// Touch screens and reduced motion keep the links flat; the float is style.css's business.
stairs.addEventListener('pointermove', (event) => {
  if (!finePointer.matches || reducedMotion.matches || event.pointerType === 'touch' || !cards[0].rect) return;
  aim(event.clientX, event.clientY);
});
stairs.addEventListener('pointerleave', flatten);
reducedMotion.addEventListener('change', flatten);
finePointer.addEventListener('change', flatten);

window.addEventListener('resize', measure);
window.addEventListener('scroll', measure, { passive: true });
// Hidden pages measure as empty boxes: read again whenever a page is shown and when the layout of the steps changes.
window.addEventListener('section:change', measure);
new ResizeObserver(measure).observe(stairs);
measure();
gsap.ticker.add(tick);
