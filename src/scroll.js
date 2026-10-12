import Lenis from 'lenis';
import 'lenis/dist/lenis.css';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

// Smooth scroll. GSAP's ticker drives the Lenis frame loop so scroll-linked animations stay in step.
export const lenis = new Lenis({ duration: 1.2, smoothWheel: true, lerp: 0.1 });

lenis.on('scroll', ScrollTrigger.update);
gsap.ticker.add((time) => lenis.raf(time * 1000));
gsap.ticker.lagSmoothing(0);
