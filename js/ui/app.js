// App shell: tab routing, a stack of sub-pages, re-rendering and the bottom navigation.
// Screens register themselves here; nothing in this file knows what a screen contains.

import { h, clear, icon, closeAllSheets, add } from '../lib/dom.js';
import { store } from '../core/store.js';

export const ctx = {
  mode: 'local',     // 'local' (this device only) or 'cloud' (signed in, syncing)
  user: null,
  client: null,
  sync: null,
  syncState: { status: 'idle', pending: 0, lastSyncedAt: null, error: null },
  offlineAuth: false,
};

export const TABS = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'workouts', label: 'Workouts', icon: 'dumbbell' },
  { id: 'history', label: 'History', icon: 'history' },
  { id: 'progress', label: 'Progress', icon: 'chart' },
  { id: 'profile', label: 'Profile', icon: 'user' },
];
const ROUTES = new Set([...TABS.map((t) => t.id), 'workout']);

const screens = {};
export function registerScreen(name, render) { screens[name] = render; }

let route = 'home';
const pages = [];       // sub-pages stacked over the current tab: { render, scrollBelow }
let cleanup = null;
let historyDepth = 0;   // how many of our pages have a browser-history entry
const shellListeners = new Set();

export const currentRoute = () => route;
export const onPage = () => pages.length > 0;
export function onShellChange(fn) { shellListeners.add(fn); return () => shellListeners.delete(fn); }
const notifyShell = () => shellListeners.forEach((fn) => fn());

const view = () => document.getElementById('view');

function draw({ keepScroll = false } = {}) {
  const y = keepScroll ? window.scrollY : 0;
  if (cleanup) { try { cleanup(); } catch (e) { console.error(e); } cleanup = null; }
  const el = clear(view());
  const top = pages[pages.length - 1];
  const render = top ? top.render : screens[route];
  el.dataset.screen = top ? 'page' : route;
  try {
    const result = render(el);
    if (typeof result === 'function') cleanup = result;
  } catch (err) {
    console.error(err);
    add(el, h('div', { class: 'empty' }, h('p', null, 'This screen hit a problem.'), h('button', { class: 'btn btn-quiet', onClick: () => go('home') }, 'Go to Home')));
  }
  window.scrollTo(0, y);
  drawNav();
  notifyShell();
}

let refreshQueued = false;
/** Re-render the current screen in place (keeps scroll position). */
export function refresh() {
  if (refreshQueued) return;
  refreshQueued = true;
  requestAnimationFrame(() => { refreshQueued = false; draw({ keepScroll: true }); });
}

/** Like refresh(), but waits until the user is not typing so an input never loses focus mid-word. */
export function refreshWhenIdle() {
  const a = document.activeElement;
  const typing = a && view().contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName);
  if (!typing) { refresh(); return; }
  a.addEventListener('blur', () => setTimeout(refreshWhenIdle, 0), { once: true });
}

function setHash(name) {
  try { history.replaceState(history.state, '', `#${name}`); }
  catch { try { location.hash = name; } catch { /* ignore */ } }
}

/** Switch to a top-level screen. */
export function go(name) {
  if (!ROUTES.has(name)) name = 'home';
  closeAllSheets();
  pages.length = 0;
  historyDepth = 0; // any leftover browser-history entries are harmless: Back simply does nothing for them
  route = name;
  setHash(name);
  draw();
}

let suppressPop = 0;

/** Open a sub-page (detail, editor…) over the current tab. */
export function pushPage(render) {
  closeAllSheets();
  pages.push({ render, scrollBelow: window.scrollY });
  try { history.pushState({ ironlogPage: pages.length }, ''); historyDepth += 1; } catch { /* history unavailable */ }
  draw();
}

function popNow() {
  const top = pages.pop();
  if (!top) return;
  draw();
  window.scrollTo(0, top.scrollBelow || 0);
}

/** Close the top sub-page. */
export function popPage() {
  if (!pages.length) return;
  if (historyDepth > 0) { historyDepth -= 1; suppressPop += 1; try { history.back(); } catch { suppressPop -= 1; } }
  popNow();
}

/** Replace the top sub-page with another one (e.g. editor → detail). */
export function replacePage(render) {
  if (!pages.length) { pushPage(render); return; }
  pages[pages.length - 1] = { render, scrollBelow: pages[pages.length - 1].scrollBelow };
  draw();
}

window.addEventListener('popstate', () => {
  if (suppressPop > 0) { suppressPop -= 1; return; }
  if (pages.length) { historyDepth = Math.max(0, historyDepth - 1); closeAllSheets(); popNow(); }
});

window.addEventListener('hashchange', () => {
  const name = location.hash.replace(/^#/, '');
  if (ROUTES.has(name) && name !== route && !pages.length) { route = name; draw(); }
});

export function initialRoute() {
  const name = location.hash.replace(/^#/, '');
  route = ROUTES.has(name) ? name : 'home';
  if (route === 'workout' && !store.active()) route = 'home';
}

export function renderApp() { draw(); }

function drawNav() {
  const nav = document.getElementById('nav');
  clear(nav);
  for (const t of TABS) {
    const on = route === t.id;
    nav.append(h('button', { class: `nav-item ${on ? 'on' : ''}`, 'aria-current': on ? 'page' : null, 'data-tab': t.id, onClick: () => go(t.id) },
      icon(t.icon, 24), h('span', null, t.label)));
  }
}

/** Standard header for sub-pages: back button, title, optional action on the right. */
export function pageHeader(title, { action = null, onBack = popPage, backLabel = 'Back' } = {}) {
  return h('header', { class: 'page-head' },
    h('button', { class: 'icon-btn', 'aria-label': backLabel, onClick: onBack }, icon('back', 24)),
    h('h1', { class: 'page-title' }, title),
    action || h('span', { class: 'page-head-spacer' }));
}

export function screenHeader(title, right = null) {
  return h('header', { class: 'screen-head' }, h('h1', { class: 'screen-title' }, title), right);
}
