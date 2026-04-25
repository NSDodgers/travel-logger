// Travel Logger PWA entry.
// Hash-based router (works without any server routing cooperation — Caddy
// already serves index.html via try_files, but hash routes are cheaper).
//
// Each route handler returns a `chrome` descriptor the shell applies to the
// header and tab bar. Handlers receive (root, params) and render into <main>.

import { logScreen, predictScreen, historyScreen } from './screens/placeholder.js';
import {
  addressesListScreen,
  addressAddScreen,
  addressEditScreen,
} from './screens/addresses.js';

// ── Router ─────────────────────────────────────────────────────────────────

const routes = [
  { pattern: '/',               handler: logScreen },
  { pattern: '/log',            handler: logScreen },
  { pattern: '/predict',        handler: predictScreen },
  { pattern: '/history',        handler: historyScreen },
  { pattern: '/addresses',      handler: addressesListScreen },
  { pattern: '/addresses/new',  handler: addressAddScreen },
  { pattern: '/addresses/:id',  handler: addressEditScreen },
];

function parseHash() {
  const hash = location.hash || '#/';
  const path = hash.startsWith('#') ? hash.slice(1) : hash;
  return path || '/';
}

function match(pattern, path) {
  const pp = pattern.split('/');
  const ap = path.split('/');
  if (pp.length !== ap.length) return null;
  const params = {};
  for (let i = 0; i < pp.length; i++) {
    if (pp[i].startsWith(':')) params[pp[i].slice(1)] = decodeURIComponent(ap[i]);
    else if (pp[i] !== ap[i]) return null;
  }
  return params;
}

function resolve(path) {
  for (const route of routes) {
    const params = match(route.pattern, path);
    if (params) return { handler: route.handler, params };
  }
  return { handler: logScreen, params: {} };
}

// ── Shell chrome ───────────────────────────────────────────────────────────

const appEl    = document.querySelector('.app');
const titleEl  = document.getElementById('app-title');
const backEl   = document.getElementById('back-btn');
const primEl   = document.getElementById('primary-action');
const screenEl = document.getElementById('screen');
const toastEl  = document.getElementById('toast');

backEl.addEventListener('click', () => history.back());

function applyChrome(chrome) {
  titleEl.textContent = chrome.title ?? 'Travel Logger';
  appEl.dataset.tab = chrome.tab ?? 'log';
  backEl.hidden = !chrome.showBack;

  if (chrome.primary) {
    primEl.hidden = false;
    primEl.textContent = chrome.primary.label;
    primEl.setAttribute('aria-label', chrome.primary.ariaLabel ?? chrome.primary.label);
    primEl.onclick = () => {
      if (chrome.primary.href) location.hash = chrome.primary.href.replace(/^#/, '');
      else chrome.primary.onClick?.();
    };
  } else {
    primEl.hidden = true;
    primEl.onclick = null;
  }
}

async function render() {
  const path = parseHash();
  const { handler, params } = resolve(path);
  screenEl.innerHTML = '';
  try {
    // Screens can be async (they load data before returning their chrome).
    const chrome = (await handler(screenEl, params)) ?? {};
    applyChrome(chrome);
    screenEl.scrollTop = 0;
  } catch (err) {
    console.error('Screen render failed:', err);
    screenEl.innerHTML = `
      <section class="screen">
        <div class="placeholder">
          <h2>Something went wrong</h2>
          <p>${String(err.message || err)}</p>
        </div>
      </section>
    `;
  }
}

// ── Toast ──────────────────────────────────────────────────────────────────

let toastTimer = null;
export function toast(msg, { level = 'info', ms = 2400 } = {}) {
  toastEl.textContent = msg;
  toastEl.dataset.level = level;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, ms);
}
// Expose for screen modules that need it.
window.__toast = toast;

// ── Bootstrap ──────────────────────────────────────────────────────────────

window.addEventListener('hashchange', render);
window.addEventListener('DOMContentLoaded', render);
// If the document is already past DOMContentLoaded when this module finishes
// loading, fire once manually so the first render still happens.
if (document.readyState !== 'loading') render();
