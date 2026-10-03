/**
 * Builds mobile/assets/tvchart.html — the TradingView lightweight-charts
 * (v5) chart used by TVChart.tsx inside a WebView.
 *
 * The lightweight-charts standalone production bundle is inlined directly
 * into the HTML so the chart works fully offline (no CDN, no network
 * dependency at chart time). Run after `npm install`:
 *
 *   node scripts/build-tvchart-html.js
 *
 * The bootstrap JS (chart creation, series, zone primitives, pill overlay,
 * RN bridge) lives in scripts/tvchart-bootstrap.js so it stays editable
 * without touching this bundler.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LW_PATH = path.join(ROOT, 'node_modules', 'lightweight-charts', 'dist', 'lightweight-charts.standalone.production.js');
const BOOTSTRAP_PATH = path.join(__dirname, 'tvchart-bootstrap.js');
const OUT_PATH = path.join(ROOT, 'assets', 'tvchart.html');

function main() {
  if (!fs.existsSync(LW_PATH)) {
    console.error(`lightweight-charts bundle not found at ${LW_PATH}\nRun \`npm install\` in mobile/ first.`);
    process.exit(1);
  }
  if (!fs.existsSync(BOOTSTRAP_PATH)) {
    console.error(`bootstrap JS not found at ${BOOTSTRAP_PATH}`);
    process.exit(1);
  }
  const lw = fs.readFileSync(LW_PATH, 'utf8');
  const bootstrap = fs.readFileSync(BOOTSTRAP_PATH, 'utf8');

  // The standalone bundle is plain JS with no `</script>` inside (verified
  // for 5.x), so a direct inline is safe.
  if (lw.includes('</script')) {
    console.error('lightweight-charts bundle contains </script — cannot inline safely.');
    process.exit(1);
  }

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover"/>
<style>
  html, body { margin: 0; padding: 0; height: 100%; overflow: hidden; background: #0A0B0F; }
  #chart { position: absolute; inset: 0; }
  /* Zone score pills live in this layer: real DOM, absolutely positioned
     via priceToCoordinate, so they're tappable (canvas can't do that). */
  #pills { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
  .zpill {
    position: absolute; pointer-events: auto;
    display: flex; align-items: center; gap: 4px;
    height: 22px; padding: 0 6px; border-radius: 6px;
    font: 700 11px -apple-system, 'SF Pro Text', sans-serif;
    border: 1px solid; cursor: pointer; white-space: nowrap;
    -webkit-tap-highlight-color: transparent; user-select: none;
  }
</style>
</head>
<body>
<div id="chart"></div>
<div id="pills"></div>
<script>${lw}</script>
<script>${bootstrap}</script>
</body>
</html>
`;

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, html);
  console.log(`wrote ${OUT_PATH} (${(html.length / 1024).toFixed(0)} KB)`);
}

main();
