import './style.css';
import './scroll.js';
// Before sections.js, so the swarm hears the title sent while the page loads.
import { initSwarm } from './swarm.js';
import './sections.js';
// After sections.js, so the theme of a page loaded directly is already set on <html>.
import './themes.js';
import './projects-bubbles.js';
import './experience.js';

initSwarm();
