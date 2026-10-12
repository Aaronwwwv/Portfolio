import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

// Background funnel: twists slowly as the page scrolls. With reduced motion it stays as the CSS leaves it.
const FULL_TWIST = 720;
// Short pages would spin the whole twist in a few wheel notches, so the turn is also capped per pixel scrolled.
const MAX_DEGREES_PER_PIXEL = 0.09;

const funnel = document.querySelector('#bg-shape .funnel');

if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const sway = () => window.innerHeight * 0.08;

  // GSAP takes over the centring that the CSS transform does in the static case.
  const twist = gsap.fromTo(
    funnel,
    { xPercent: -50, yPercent: -50, x: 0, y: () => -sway(), rotation: 0, scale: 0.95 },
    {
      y: sway,
      rotation: () => Math.min(FULL_TWIST, ScrollTrigger.maxScroll(window) * MAX_DEGREES_PER_PIXEL),
      scale: 1.08,
      ease: 'none',
      scrollTrigger: { start: 0, end: 'max', scrub: 1, invalidateOnRefresh: true },
    },
  );

  // Changing tab changes the document height: remeasure, and settle at once rather than unwinding the twist.
  new ResizeObserver(() => {
    ScrollTrigger.refresh();
    twist.scrollTrigger.getTween()?.progress(1);
  }).observe(document.body);
}
