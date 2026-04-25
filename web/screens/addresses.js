// Address book: list + add + (stub) edit.
// Edit + archive land in the next commit.

import { api, ApiError } from '../api.js';
import { suggest, retrieve, staticMapUrl, newSessionToken } from '../mapbox.js';

// Module-level UI state for the list. Re-set on every render of the list.
let showArchived = false;

// ── List ───────────────────────────────────────────────────────────────────

export async function addressesListScreen(root) {
  root.innerHTML = `<section class="screen"><div class="loading">Loading addresses…</div></section>`;

  let addresses;
  try {
    addresses = await api.get('/addresses?order=updated_at.desc');
  } catch (err) {
    renderError(root, err);
    return listChrome();
  }

  if (!Array.isArray(addresses)) {
    renderError(root, new Error('API did not return a list'));
    return listChrome();
  }

  renderList(root, addresses);
  return listChrome();
}

function listChrome() {
  return {
    title: 'Addresses',
    tab: 'log',
    showBack: true,
    primary: { label: '+', href: '#/addresses/new', ariaLabel: 'Add address' },
  };
}

function renderList(root, addresses) {
  const visible = showArchived ? addresses : addresses.filter((a) => !a.archived);
  const archivedCount = addresses.filter((a) => a.archived).length;

  const rowsHtml = visible.length
    ? `<ul class="addr-list">${visible.map(rowHtml).join('')}</ul>`
    : `<div class="addr-empty">
         <p>${showArchived ? 'No archived addresses.' : 'No addresses yet.'}</p>
       </div>`;

  root.innerHTML = `
    <section class="screen">
      <div class="addr-tools">
        <span class="addr-tools-count">
          ${visible.length} ${visible.length === 1 ? 'address' : 'addresses'}
          ${archivedCount && !showArchived ? `<span style="color:var(--muted)"> · ${archivedCount} archived</span>` : ''}
        </span>
        ${archivedCount
          ? `<button class="addr-tools-toggle" id="toggle-archived">
               ${showArchived ? 'Hide archived' : 'Show archived'}
             </button>`
          : ''}
      </div>
      ${rowsHtml}
    </section>
  `;

  const toggleBtn = root.querySelector('#toggle-archived');
  toggleBtn?.addEventListener('click', () => {
    showArchived = !showArchived;
    renderList(root, addresses);
  });

  root.querySelectorAll('.addr-row').forEach((el) => {
    el.addEventListener('click', () => {
      location.hash = `/addresses/${el.dataset.id}`;
    });
  });
}

function rowHtml(addr) {
  const archivedClass = addr.archived ? ' is-archived' : '';
  return `
    <li class="addr-row${archivedClass}" data-id="${escapeAttr(addr.id)}" role="button" tabindex="0">
      <div>
        <div class="addr-label">${escapeHtml(addr.label)}${addr.archived ? ' <span style="color:var(--muted);font-size:12px"> · archived</span>' : ''}</div>
        <div class="addr-formatted">${escapeHtml(addr.formatted)}</div>
      </div>
      <span class="addr-chevron" aria-hidden="true">›</span>
    </li>
  `;
}

function renderError(root, err) {
  const msg = err instanceof ApiError ? `${err.status} ${err.statusText}` : err.message;
  root.innerHTML = `
    <section class="screen">
      <div class="placeholder">
        <h2>Couldn't load addresses</h2>
        <p>${escapeHtml(msg)}</p>
        <button class="btn btn-secondary" onclick="location.reload()" style="margin-top:16px">Retry</button>
      </div>
    </section>
  `;
}

// ── Add ────────────────────────────────────────────────────────────────────

export function addressAddScreen(root) {
  mountAddressForm(root, { mode: 'add', existing: null });
  return { title: 'New Address', tab: 'log', showBack: true, primary: null };
}

// ── Edit ───────────────────────────────────────────────────────────────────

export async function addressEditScreen(root, params) {
  root.innerHTML = `<section class="screen"><div class="loading">Loading address…</div></section>`;
  let existing;
  try {
    const res = await api.get(`/addresses?id=eq.${encodeURIComponent(params.id)}`);
    existing = Array.isArray(res) ? res[0] : null;
    if (!existing) throw new Error('Not found');
  } catch (err) {
    root.innerHTML = `
      <section class="screen">
        <div class="placeholder">
          <h2>Couldn't load address</h2>
          <p>${escapeHtml(err instanceof ApiError ? `${err.status} ${err.statusText}` : err.message)}</p>
          <button class="btn btn-secondary" onclick="location.hash='/addresses'" style="margin-top:16px">Back to list</button>
        </div>
      </section>
    `;
    return { title: 'Edit Address', tab: 'log', showBack: true, primary: null };
  }
  mountAddressForm(root, { mode: 'edit', existing });
  return { title: 'Edit Address', tab: 'log', showBack: true, primary: null };
}

// ── Shared form mount (add + edit) ─────────────────────────────────────────

function mountAddressForm(root, { mode, existing }) {
  const initialPicked = existing
    ? { mapbox_id: existing.mapbox_id, formatted: existing.formatted,
        lat: existing.lat, lng: existing.lng }
    : null;

  const state = {
    sessionToken: newSessionToken(),
    picked: initialPicked,
    suggestions: [],
    suggestLoading: false,
    saving: false,
  };

  root.innerHTML = formTemplate({ mode, existing });
  const labelEl     = root.querySelector('#addr-label');
  const searchEl    = root.querySelector('#addr-search');
  const suggestEl   = root.querySelector('#suggest-list');
  const pinEl       = root.querySelector('#pin-slot');
  const saveBtn     = root.querySelector('#save-btn');
  const cancelBtn   = root.querySelector('#cancel-btn');
  const archiveBtn  = root.querySelector('#archive-btn');
  const errorEl     = root.querySelector('#error-slot');

  if (existing) {
    labelEl.value = existing.label;
    searchEl.value = existing.formatted;
    renderPin(pinEl, initialPicked);
  }

  const updateSaveEnabled = () => {
    const dirty = mode === 'add' || labelEl.value.trim() !== existing.label
      || state.picked?.mapbox_id !== existing.mapbox_id
      || state.picked?.lat !== existing.lat
      || state.picked?.lng !== existing.lng;
    saveBtn.disabled = state.saving || !labelEl.value.trim() || !state.picked || !dirty;
  };
  updateSaveEnabled();

  labelEl.addEventListener('input', updateSaveEnabled);

  const runSuggest = debounce(async () => {
    const q = searchEl.value.trim();
    if (!q) { state.suggestions = []; renderSuggestions(suggestEl, state); return; }
    try {
      state.suggestLoading = true;
      renderSuggestions(suggestEl, state);
      state.suggestions = await suggest(q, state.sessionToken);
    } catch (err) {
      console.error(err);
      state.suggestions = [];
      setError(errorEl, `Address search failed: ${err.message}`);
    } finally {
      state.suggestLoading = false;
      renderSuggestions(suggestEl, state);
    }
  }, 220);

  searchEl.addEventListener('input', () => {
    if (state.picked && searchEl.value !== state.picked.formatted) {
      state.picked = null;
      renderPin(pinEl, null);
      updateSaveEnabled();
    }
    runSuggest();
  });
  searchEl.addEventListener('focus', () => {
    if (state.suggestions.length) renderSuggestions(suggestEl, state);
  });

  suggestEl.addEventListener('click', async (e) => {
    const li = e.target.closest('li[data-mapbox-id]');
    if (!li) return;
    try {
      saveBtn.disabled = true;
      state.picked = await retrieve(li.dataset.mapboxId, state.sessionToken);
      searchEl.value = state.picked.formatted;
      state.sessionToken = newSessionToken();
      state.suggestions = [];
      renderSuggestions(suggestEl, state);
      renderPin(pinEl, state.picked);
      setError(errorEl, null);
    } catch (err) {
      console.error(err);
      setError(errorEl, `Couldn't pin that address: ${err.message}`);
    } finally {
      updateSaveEnabled();
    }
  });

  cancelBtn.addEventListener('click', () => history.back());

  saveBtn.addEventListener('click', async () => {
    if (saveBtn.disabled) return;
    state.saving = true;
    updateSaveEnabled();
    setError(errorEl, null);
    try {
      const body = {
        label: labelEl.value.trim(),
        formatted: state.picked.formatted,
        lat: state.picked.lat,
        lng: state.picked.lng,
        mapbox_id: state.picked.mapbox_id,
      };
      if (mode === 'add') {
        await api.post('/addresses', body);
        window.__toast?.('Address saved', { level: 'success' });
      } else {
        // Bump updated_at client-side so the list re-sorts — no trigger yet.
        await api.patch(
          `/addresses?id=eq.${encodeURIComponent(existing.id)}`,
          { ...body, updated_at: new Date().toISOString() },
        );
        window.__toast?.('Address updated', { level: 'success' });
      }
      location.hash = '/addresses';
    } catch (err) {
      console.error(err);
      const msg = err instanceof ApiError ? `${err.status}: ${err.body || err.statusText}` : err.message;
      setError(errorEl, `Save failed — ${msg}`);
      state.saving = false;
      updateSaveEnabled();
    }
  });

  if (archiveBtn) {
    archiveBtn.addEventListener('click', async () => {
      const nextArchived = !existing.archived;
      archiveBtn.disabled = true;
      setError(errorEl, null);
      try {
        await api.patch(
          `/addresses?id=eq.${encodeURIComponent(existing.id)}`,
          { archived: nextArchived, updated_at: new Date().toISOString() },
        );
        window.__toast?.(nextArchived ? 'Address archived' : 'Address restored', { level: 'success' });
        location.hash = '/addresses';
      } catch (err) {
        console.error(err);
        archiveBtn.disabled = false;
        const msg = err instanceof ApiError ? `${err.status}: ${err.body || err.statusText}` : err.message;
        setError(errorEl, `Archive failed — ${msg}`);
      }
    });
  }
}

// ── Shared form helpers ────────────────────────────────────────────────────

function formTemplate({ mode, existing }) {
  const archiveBtn = mode === 'edit'
    ? `<button type="button" class="btn btn-danger" id="archive-btn" style="margin-top:16px">
         ${existing.archived ? 'Unarchive' : 'Archive'}
       </button>`
    : '';
  return `
    <section class="screen">
      <form class="form" novalidate>
        <div class="form-row">
          <label for="addr-label">Label</label>
          <input id="addr-label" type="text" autocomplete="off"
                 placeholder="Home, Mom's, Hotel, …" maxlength="80">
          <p class="hint">A short name you'll recognize in the trip picker.</p>
        </div>
        <div class="form-row autocomplete">
          <label for="addr-search">Address</label>
          <input id="addr-search" type="search" autocomplete="off"
                 placeholder="Start typing an address…">
          <ul class="suggest-list" id="suggest-list" hidden></ul>
        </div>
        <div class="form-row">
          <label>Pin confirmation</label>
          <div id="pin-slot">
            <div class="pin-empty">Pick an address to preview the pin.</div>
          </div>
        </div>
        <div id="error-slot" class="hint" style="color:var(--error)" hidden></div>
        <div class="form-actions">
          <button type="button" class="btn btn-secondary" id="cancel-btn">Cancel</button>
          <button type="button" class="btn btn-primary" id="save-btn" disabled>Save</button>
        </div>
        ${archiveBtn}
      </form>
    </section>
  `;
}

function renderSuggestions(el, state) {
  if (state.suggestLoading) {
    el.hidden = false;
    el.innerHTML = `<li class="suggest-empty">Searching…</li>`;
    return;
  }
  if (!state.suggestions.length) {
    el.hidden = true;
    el.innerHTML = '';
    return;
  }
  el.hidden = false;
  el.innerHTML = state.suggestions.map((s) => `
    <li class="suggest-item" role="option" data-mapbox-id="${escapeAttr(s.mapbox_id)}">
      <span class="suggest-name">${escapeHtml(s.name)}</span>
      <span class="suggest-full">${escapeHtml(s.place_formatted ?? s.full_address ?? '')}</span>
    </li>
  `).join('');
}

function renderPin(el, picked) {
  if (!picked) {
    el.innerHTML = `<div class="pin-empty">Pick an address to preview the pin.</div>`;
    return;
  }
  const url = staticMapUrl(picked.lat, picked.lng, { width: 480, height: 260 });
  el.innerHTML = `
    <img class="pin-preview" src="${escapeAttr(url)}"
         alt="Map showing ${escapeAttr(picked.formatted)}"
         loading="lazy">
    <p class="hint" style="margin-top:6px">
      ${escapeHtml(picked.formatted)}
      · ${picked.lat.toFixed(4)}, ${picked.lng.toFixed(4)}
    </p>
  `;
}

function setError(el, msg) {
  if (!msg) { el.hidden = true; el.textContent = ''; return; }
  el.hidden = false;
  el.textContent = msg;
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// ── Tiny escapes (shared across screens once more land) ────────────────────

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, '&#39;');
}
