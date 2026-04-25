// Placeholder screens for tabs that don't have real UI yet (M10 Predict, M9 History).
// Each screen is a function that receives the root <main> and returns a
// chrome object describing the header/tab state. The Log tab now lives in
// ./log.js (M7).

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
