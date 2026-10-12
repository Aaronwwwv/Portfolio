import './style.css';

// Hash routing: "#parcours" shows one tab, "#projets/rugtraak" shows a project detail page.
const DEFAULT_VIEW = 'accueil';

const views = document.querySelectorAll('main > section');
const navLinks = document.querySelectorAll('.site-nav a');
const projectList = document.getElementById('projets-liste');
const projectDetails = document.querySelectorAll('#projets > section');

function readRoute() {
  const [view, detail] = window.location.hash.replace(/^#/, '').split('/');
  const viewExists = [...views].some((section) => section.id === view);
  return { view: viewExists ? view : DEFAULT_VIEW, detail };
}

function render() {
  const route = readRoute();
  const detail = route.view === 'projets' && route.detail
    ? document.getElementById(`projet-${route.detail}`)
    : null;

  views.forEach((section) => { section.hidden = section.id !== route.view; });
  projectList.hidden = detail !== null;
  projectDetails.forEach((section) => { section.hidden = section !== detail; });

  navLinks.forEach((link) => {
    const active = link.getAttribute('href') === `#${route.view}`;
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });

  window.scrollTo(0, 0);
}

document.querySelectorAll('.back').forEach((button) => {
  button.addEventListener('click', () => { window.location.hash = 'projets'; });
});

window.addEventListener('hashchange', render);
render();
