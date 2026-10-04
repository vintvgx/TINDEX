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
const OUT_HTML = path.join(ROOT, 'assets', 'tvchart.html');
// Generated TS module imported directly by TVChart.tsx — this is what the
// app actually bundles (no expo-asset, no file:// URLs, no native changes).
const OUT_TS = path.join(ROOT, 'common', 'components', 'ticker', 'tvchart-html.generated.ts');

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
  /* z-index on #chart traps lightweight-charts' own z-indexed canvases
     (z 1/2) in its stacking context — without it they paint over #pills
     and the score pills are invisible. */
  #chart { position: absolute; inset: 0; z-index: 0; -webkit-touch-callout: none; -webkit-user-select: none; user-select: none; }
  /* Zone score pills live in this layer: real DOM, absolutely positioned
     via priceToCoordinate, so they're tappable (canvas can't do that). */
  #pills { position: absolute; inset: 0; z-index: 10; pointer-events: none; overflow: hidden; }
  /* Low-impact auto-zone pill: tiny score + trending arrow in the zone
     color. Visually small, but the ::before pad gives it a ~29x29 tap
     target so it's still easy to press. */
  .zpill {
    position: absolute; pointer-events: auto; box-sizing: border-box;
    display: flex; align-items: center; gap: 2px;
    height: 13px; padding: 0 3px; border-radius: 3px;
    font: 700 8px/11px -apple-system, 'SF Pro Text', sans-serif;
    border: 1px solid; cursor: pointer; white-space: nowrap;
    -webkit-tap-highlight-color: transparent; user-select: none;
  }
  .zpill::before { content: ''; position: absolute; inset: -8px -6px; }
  /* Technicals line names (EMA/VWAP/walls): plain small text, no box —
     the built-in price-line title always paints a filled background. */
  #reflabels { position: absolute; inset: 0; z-index: 9; pointer-events: none; overflow: hidden; }
  .rlabel {
    position: absolute; white-space: nowrap;
    font: 600 9px/11px -apple-system, 'SF Pro Text', sans-serif;
  }
  /* Pending-alert ⊕ after a long-press (TradingView-style). */
  #alertadd { position: absolute; inset: 0; z-index: 12; pointer-events: none; display: none; }
  #alertadd .aa-line { position: absolute; left: 0; height: 0; border-top: 1px dashed rgba(242,242,240,0.75); }
  #alertadd .aa-btn {
    position: absolute; width: 26px; height: 26px; pointer-events: auto;
    display: flex; align-items: center; justify-content: center;
    color: #F2F2F0; background: #3A3A3C; border-radius: 5px; cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  #alertadd .aa-btn::before { content: ''; position: absolute; inset: -9px; }
  #alertadd .aa-btn svg { width: 18px; height: 18px; }
  #alertadd .aa-label {
    position: absolute; right: 0; height: 22px; line-height: 22px; text-align: center;
    background: #3A3A3C; border-radius: 3px;
    font: 500 12px -apple-system, 'SF Pro Text', sans-serif;
  }
  .zpill svg { width: 8px; height: 8px; flex: none; display: block; }
</style>
</head>
<body>
<div id="chart"></div>
<div id="reflabels"></div>
<div id="pills"></div>
<script>${lw}</script>
<script>${bootstrap}</script>
</body>
</html>
`;

  fs.mkdirSync(path.dirname(OUT_HTML), { recursive: true });
  fs.writeFileSync(OUT_HTML, html);
  console.log(`wrote ${OUT_HTML} (${(html.length / 1024).toFixed(0)} KB)`);

  // TS module — the app imports this string directly. JSON.stringify keeps
  // the escaping safe (the bundle may contain backticks/template literals).
  const ts = `// GENERATED by scripts/build-tvchart-html.js — do not edit.\n// Rebuild with: node scripts/build-tvchart-html.js\n/* eslint-disable */\nexport const TVCHART_HTML: string = ${JSON.stringify(html)};\n`;
  fs.mkdirSync(path.dirname(OUT_TS), { recursive: true });
  fs.writeFileSync(OUT_TS, ts);
  console.log(`wrote ${OUT_TS} (${(ts.length / 1024).toFixed(0)} KB)`);
}

main();
