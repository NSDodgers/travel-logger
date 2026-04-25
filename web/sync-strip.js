// Sticky strip above <main> + dead-letter list sheet + auth-expired modal.
// Subscribes to the queue's event bus; screens stay dumb about sync state.

import {
  onSyncStateChange,
  getDeadLetters,
  retryEntry,
  discardEntry,
  resumeAfterAuth,
} from './queue.js';

let stripEl = null;
let modalEl = null;
let currentDeadSheet = null;

export function mountSyncStrip(host) {
  stripEl = document.createElement('div');
  stripEl.className = 'sync-strip';
  stripEl.id = 'sync-strip';
  stripEl.hidden = true;
  stripEl.addEventListener('click', () => {
    if (stripEl.dataset.level === 'pending'
        || stripEl.dataset.level === 'retrying'
        || stripEl.dataset.level === 'dead') {
      openDeadLetterSheet();
    }
  });
  // Mount above the <main id="screen"> element.
  host.parentNode.insertBefore(stripEl, host);

  modalEl = document.createElement('div');
  modalEl.className = 'auth-expired-modal';
  modalEl.id = 'auth-expired-modal';
  modalEl.hidden = true;
  modalEl.innerHTML = `
    <div class="auth-expired-card" role="dialog" aria-modal="true">
      <h2>Sign in to sync</h2>
      <p>Your offline taps are safe.</p>
      <button type="button" class="btn btn-primary" id="auth-expired-open">Open login</button>
    </div>
  `;
  modalEl.querySelector('#auth-expired-open').addEventListener('click', () => {
    location.href = '/auth/?rd=' + encodeURIComponent(location.href);
  });
  document.body.appendChild(modalEl);

  onSyncStateChange(handleState);
}

function handleState(state) {
  if (!stripEl) return;

  if (state.kind === 'overflow') {
    stripEl.hidden = false;
    stripEl.dataset.level = 'dead';
    stripEl.textContent = `Queue full — sync now or some taps will be lost.`;
    return;
  }

  if (state.kind !== 'state') return;
  const { counts, online, paused, draining } = state;

  // Auth-expired modal is independent of strip styling.
  modalEl.hidden = !paused;

  // The "outstanding" total is everything not yet on the server, plus any
  // failed_retriable and in_flight — that's what the user wants to know about.
  const outstanding = counts.pending + counts.failed_retriable + counts.in_flight;

  if (counts.dead_letter > 0) {
    stripEl.hidden = false;
    stripEl.dataset.level = 'dead';
    stripEl.textContent = `${counts.dead_letter} ${counts.dead_letter === 1 ? 'tap' : 'taps'} failed — tap to review`;
    refreshDeadSheet();
    return;
  }

  if (!online && outstanding > 0) {
    stripEl.hidden = false;
    stripEl.dataset.level = 'pending';
    stripEl.textContent = `Offline · ${outstanding} ${outstanding === 1 ? 'tap' : 'taps'} pending`;
    return;
  }

  if (counts.failed_retriable > 0) {
    stripEl.hidden = false;
    stripEl.dataset.level = 'retrying';
    stripEl.textContent = `Sync retrying · ${outstanding} ${outstanding === 1 ? 'tap' : 'taps'} pending`;
    return;
  }

  if (draining || counts.in_flight > 0) {
    stripEl.hidden = false;
    stripEl.dataset.level = 'syncing';
    stripEl.textContent = `Syncing… ${outstanding} ${outstanding === 1 ? 'tap' : 'taps'}`;
    return;
  }

  if (counts.pending > 0) {
    stripEl.hidden = false;
    stripEl.dataset.level = 'pending';
    stripEl.textContent = `${counts.pending} ${counts.pending === 1 ? 'tap' : 'taps'} pending sync`;
    return;
  }

  stripEl.hidden = true;
  stripEl.dataset.level = '';
  stripEl.textContent = '';
}

// ── Dead-letter sheet ──────────────────────────────────────────────────────

async function openDeadLetterSheet() {
  const entries = await getDeadLetters();
  // If we got here from an amber strip (failed_retriable, pending) and there
  // are no actual dead letters yet, just toast the count and bail.
  if (!entries.length) {
    window.__toast?.('No failed taps yet — give the queue a moment.', { level: 'info' });
    return;
  }

  closeDeadSheet();

  const scrim = document.createElement('div');
  scrim.className = 'scrim';
  const sheet = document.createElement('div');
  sheet.className = 'sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.innerHTML = `
    <span class="sheet-grab" aria-hidden="true"></span>
    <div class="sheet-header">
      <h2>Failed taps</h2>
      <button type="button" class="sheet-close" aria-label="Close">Close</button>
    </div>
    <div class="sheet-body">
      <ul class="dead-letter-list" id="dead-letter-list"></ul>
    </div>
  `;
  document.body.appendChild(scrim);
  document.body.appendChild(sheet);

  // animate
  // eslint-disable-next-line no-unused-expressions
  scrim.offsetHeight;
  scrim.dataset.open = 'true';
  sheet.dataset.open = 'true';

  function close() {
    scrim.dataset.open = 'false';
    sheet.dataset.open = 'false';
    setTimeout(() => { scrim.remove(); sheet.remove(); }, 240);
    if (currentDeadSheet === api) currentDeadSheet = null;
  }
  scrim.addEventListener('click', close);
  sheet.querySelector('.sheet-close').addEventListener('click', close);

  const listEl = sheet.querySelector('#dead-letter-list');
  renderDeadList(listEl, entries);

  const api = {
    refresh: async () => {
      const fresh = await getDeadLetters();
      if (!fresh.length) { close(); return; }
      renderDeadList(listEl, fresh);
    },
    close,
  };
  currentDeadSheet = api;
}

function refreshDeadSheet() {
  currentDeadSheet?.refresh();
}

function closeDeadSheet() {
  currentDeadSheet?.close();
}

function renderDeadList(listEl, entries) {
  listEl.innerHTML = entries.map((e) => `
    <li class="dead-letter-row" data-id="${escapeAttr(e.id)}">
      <div class="dead-letter-summary">
        <div class="dead-letter-title">${escapeHtml(summarize(e))}</div>
        <div class="dead-letter-error">${escapeHtml(e.last_error || 'unknown error')}</div>
      </div>
      <div class="dead-letter-actions">
        <button type="button" class="btn btn-secondary" data-action="retry">Retry</button>
        <button type="button" class="btn btn-danger" data-action="discard">Discard</button>
      </div>
    </li>
  `).join('');
  listEl.querySelectorAll('.dead-letter-row').forEach((row) => {
    const id = row.dataset.id;
    row.querySelector('[data-action="retry"]').addEventListener('click', async () => {
      await retryEntry(id);
      window.__toast?.('Retrying…', { level: 'info' });
    });
    row.querySelector('[data-action="discard"]').addEventListener('click', async () => {
      if (!confirm('Discard this failed tap? It will not be sent to the server.')) return;
      await discardEntry(id);
    });
  });
}

function summarize(e) {
  const intent = e.intent || 'write';
  const labels = {
    create_trip: 'Start trip',
    log_milestone: 'Log milestone',
    edit_milestone: 'Edit milestone time',
    void_milestone: 'Remove milestone',
    complete_trip: 'Finish trip',
    abandon_trip: 'Abandon trip',
    address_create: 'New address',
    address_edit: 'Edit address',
    address_archive: 'Archive address',
    unknown: e.method + ' ' + e.path,
  };
  return labels[intent] || `${e.method} ${e.path}`;
}

// ── Helpers ────────────────────────────────────────────────────────────────

export function dismissAuthModal() {
  resumeAfterAuth();
  if (modalEl) modalEl.hidden = true;
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function escapeAttr(s) { return escapeHtml(s).replace(/'/g, '&#39;'); }
