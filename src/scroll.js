import Lenis from 'lenis';
import 'lenis/dist/lenis.css';
import gsap from 'gsap';

// Smooth scroll. GSAP's ticker drives the Lenis frame loop, so the page keeps a single animation loop.
export const lenis = new Lenis({ duration: 1.2, smoothWheel: true, lerp: 0.1 });

gsap.ticker.add((time) => lenis.raf(time * 1000));
gsap.ticker.lagSmoothing(0);
