// Address book: list + (stub) add + (stub) edit.
// Real add/edit/archive land in the next commits; the list view is here.

import { api, ApiError } from '../api.js';

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

// ── Add / edit stubs (filled in next commits) ──────────────────────────────

export function addressAddScreen(root) {
  root.innerHTML = `
    <section class="screen">
      <div class="loading">Add-address form lands in the next commit.</div>
    </section>
  `;
  return { title: 'New Address', tab: 'log', showBack: true, primary: null };
}

export function addressEditScreen(root, params) {
  root.innerHTML = `
    <section class="screen">
      <div class="loading">Edit-address form lands in the next commit (id=${params.id}).</div>
    </section>
  `;
  return { title: 'Edit Address', tab: 'log', showBack: true, primary: null };
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
