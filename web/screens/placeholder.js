// Placeholder screen for tabs that don't have real UI yet (M7 Log, M10 Predict,
// M9 History). Each screen is a function that receives the root <main> and
// returns a chrome object describing the header/tab state.

export function logScreen(root) {
  root.innerHTML = `
    <section class="screen">
      <div class="placeholder">
        <h2>Log</h2>
        <p>The trip-logging grid lands in M7.</p>
        <p>For now, use <strong>Addresses</strong> to manage saved places.</p>
        <span class="milestone-tag">M6 — address book</span>
      </div>
    </section>
  `;
  return { title: 'Travel Logger', tab: 'log', primary: { label: 'Addresses', href: '#/addresses' } };
}

export function predictScreen(root) {
  root.innerHTML = `
    <section class="screen">
      <div class="placeholder">
        <h2>Predict</h2>
        <p>Percentile-based trip predictions land in M10.</p>
        <span class="milestone-tag">planned</span>
      </div>
    </section>
  `;
  return { title: 'Predict', tab: 'predict', primary: null };
}

export function historyScreen(root) {
  root.innerHTML = `
    <section class="screen">
      <div class="placeholder">
        <h2>History</h2>
        <p>Trip timelines land in M9.</p>
        <span class="milestone-tag">planned</span>
      </div>
    </section>
  `;
  return { title: 'History', tab: 'history', primary: null };
}
