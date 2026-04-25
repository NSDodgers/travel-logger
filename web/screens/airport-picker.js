// Airport picker: IATA autocomplete backed by api.airports.
// Reusable across trip-start (M7), arrival flow (M9), and predict (M10).
//
// Usage:
//   const picker = mountAirportPicker(rootEl, {
//     id: 'dep-airport',          // input id
//     label: 'Departure airport',
//     placeholder: 'Type IATA, city, or airport name',
//     initial: { iata: 'LGA', name: 'LaGuardia', city: 'New York', tz: 'America/New_York' },
//     onChange: (airport) => { ... },  // null when cleared
//   });
//   picker.value  // → current airport row (or null)

import { api } from '../api.js';

export function mountAirportPicker(slot, opts) {
  const state = {
    selected: opts.initial || null,
    suggestions: [],
    loading: false,
  };

  slot.innerHTML = `
    <div class="form-row autocomplete iata-picker" data-picker="${opts.id}">
      <label for="${opts.id}-input">${escapeHtml(opts.label)}</label>
      <div class="iata-pill-slot"></div>
      <input id="${opts.id}-input" type="search" autocomplete="off"
             placeholder="${escapeAttr(opts.placeholder || 'Type IATA, city, or airport name')}">
      <ul class="suggest-list" id="${opts.id}-suggest" hidden role="listbox"></ul>
    </div>
  `;

  const inputEl   = slot.querySelector(`#${opts.id}-input`);
  const suggestEl = slot.querySelector(`#${opts.id}-suggest`);
  const pillSlot  = slot.querySelector('.iata-pill-slot');

  renderPill();

  const runSearch = debounce(async () => {
    const q = inputEl.value.trim();
    if (q.length < 1) {
      state.suggestions = [];
      renderSuggestions();
      return;
    }
    state.loading = true;
    renderSuggestions();
    try {
      // PostgREST: case-insensitive prefix match on IATA OR substring on name/city.
      // Limit 8 — keep dropdown short on phone.
      const upperQ = q.toUpperCase();
      const safeQ = q.replace(/[*,()]/g, '');
      const path = `/airports?or=(iata.eq.${encodeURIComponent(upperQ)},iata.ilike.${encodeURIComponent(upperQ + '*')},name.ilike.${encodeURIComponent('*' + safeQ + '*')},city.ilike.${encodeURIComponent('*' + safeQ + '*')})&limit=8&order=iata.asc`;
      const rows = await api.get(path);
      // Re-rank client-side: exact IATA, then IATA prefix, then alpha by IATA.
      // PostgREST can't express this priority order natively without RPCs.
      const ranked = (Array.isArray(rows) ? rows : []).slice().sort((a, b) => {
        const aExact = a.iata === upperQ ? 0 : 1;
        const bExact = b.iata === upperQ ? 0 : 1;
        if (aExact !== bExact) return aExact - bExact;
        const aPrefix = a.iata.startsWith(upperQ) ? 0 : 1;
        const bPrefix = b.iata.startsWith(upperQ) ? 0 : 1;
        if (aPrefix !== bPrefix) return aPrefix - bPrefix;
        return a.iata.localeCompare(b.iata);
      });
      state.suggestions = ranked;
    } catch (err) {
      console.error('Airport search failed:', err);
      state.suggestions = [];
    } finally {
      state.loading = false;
      renderSuggestions();
    }
  }, 180);

  inputEl.addEventListener('input', runSearch);
  inputEl.addEventListener('focus', () => {
    if (state.suggestions.length) renderSuggestions();
  });
  inputEl.addEventListener('blur', () => {
    // Delay so click on suggestion fires first.
    setTimeout(() => { suggestEl.hidden = true; }, 150);
  });

  suggestEl.addEventListener('mousedown', (e) => {
    // mousedown beats blur — picks the airport before the input loses focus.
    const li = e.target.closest('li[data-iata]');
    if (!li) return;
    e.preventDefault();
    const airport = state.suggestions.find((a) => a.iata === li.dataset.iata);
    if (airport) selectAirport(airport);
  });

  function selectAirport(airport) {
    state.selected = airport;
    state.suggestions = [];
    inputEl.value = '';
    renderPill();
    renderSuggestions();
    opts.onChange?.(airport);
  }

  function clearSelection() {
    state.selected = null;
    renderPill();
    inputEl.focus();
    opts.onChange?.(null);
  }

  function renderPill() {
    if (!state.selected) {
      pillSlot.innerHTML = '';
      inputEl.style.display = '';
      return;
    }
    const a = state.selected;
    pillSlot.innerHTML = `
      <div class="iata-pill">
        <strong>${escapeHtml(a.iata)}</strong>
        <span class="iata-pill-name">${escapeHtml(a.city || a.name)}</span>
        <button type="button" class="iata-pill-clear" aria-label="Clear airport">×</button>
      </div>
    `;
    pillSlot.querySelector('.iata-pill-clear').addEventListener('click', clearSelection);
    inputEl.style.display = 'none';
  }

  function renderSuggestions() {
    if (state.loading) {
      suggestEl.hidden = false;
      suggestEl.innerHTML = `<li class="suggest-empty">Searching…</li>`;
      return;
    }
    if (!state.suggestions.length) {
      suggestEl.hidden = true;
      suggestEl.innerHTML = '';
      return;
    }
    suggestEl.hidden = false;
    suggestEl.innerHTML = state.suggestions.map((a) => `
      <li class="suggest-item" role="option" data-iata="${escapeAttr(a.iata)}">
        <span class="suggest-name"><strong>${escapeHtml(a.iata)}</strong> · ${escapeHtml(a.name)}</span>
        <span class="suggest-full">${escapeHtml([a.city, a.country].filter(Boolean).join(', '))}</span>
      </li>
    `).join('');
  }

  return {
    get value() { return state.selected; },
    setValue(airport) { selectAirport(airport); },
    clear() { clearSelection(); },
    focus() { inputEl.focus(); },
  };
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function escapeAttr(s) { return escapeHtml(s).replace(/'/g, '&#39;'); }

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
