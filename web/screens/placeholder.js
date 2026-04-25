// Placeholder for the Predict tab — real percentile UI lands in M10.
// Log lives in ./log.js (M7); History in ./history.js (M9).

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
