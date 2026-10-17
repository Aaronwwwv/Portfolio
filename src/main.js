import './style.css';
import './scroll.js';
// Before sections.js, so the swarm hears the title sent while the page loads.
import { initSwarm } from './swarm.js';
import './sections.js';
import './projects-bubbles.js';
import './experience.js';

initSwarm();
