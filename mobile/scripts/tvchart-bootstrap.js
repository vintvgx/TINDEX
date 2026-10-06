/**
 * tvchart-bootstrap.js — chart runtime for TVChart.tsx (inlined into
 * mobile/assets/tvchart.html by scripts/build-tvchart-html.js).
 *
 * Runs inside a WebView. Owns a single lightweight-charts v5 instance:
 *  - candlestick (or line fallback) + volume histogram
 *  - S/R zone bands via a PANE PRIMITIVE (v5 Primitives API — the
 *    documented tool for price-pinned decorations; NOT a custom series)
 *  - zone score pills as a DOM overlay (real tap targets; canvas can't)
 *  - ORB/ORH/ORL + watch-zone edges as built-in price lines
 *
 * Bridge protocol (JSON):
 *   RN -> page:  {type:'init', theme} | {type:'setData', ...} |
 *                {type:'setZones', ...} | {type:'setRefLines', ...} |
 *                {type:'applyTheme', theme}
 *   page -> RN:  {type:'ready'} | {type:'zone-tap', id, kind}
 */
(function () {
  'use strict';

  function post(msg) {
    if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
      window.ReactNativeWebView.postMessage(JSON.stringify(msg));
    }
  }

  var LWC = window.LightweightCharts;
  if (!LWC) {
    post({ type: 'error', message: 'lightweight-charts failed to load (window.LightweightCharts missing)' });
    return;
  }

  var chartEl = document.getElementById('chart');
  var pillsEl = document.getElementById('pills');

  // ── Pending alert (TradingView-style ⊕) ─────────────────────────────
  // After a long-press, the released price keeps a dashed line with a ⊕
  // button beside its axis label; tapping ⊕ creates the alert (RN does the
  // write, no popup). Any other tap on the chart dismisses it.
  var pendingAlertPrice = null;
  var pendingShownAt = 0;
  var alertAddEl = document.createElement('div');
  alertAddEl.id = 'alertadd';
  alertAddEl.innerHTML =
    '<div class="aa-line"></div>' +
    '<div class="aa-btn" role="button" aria-label="Add alert">' +
      '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="1.6"/>' +
      '<path d="M12 7v10M7 12h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>' +
    '</div>' +
    '<div class="aa-label"></div>';
  document.body.appendChild(alertAddEl);
  var aaLine = alertAddEl.querySelector('.aa-line');
  var aaBtn = alertAddEl.querySelector('.aa-btn');
  var aaLabel = alertAddEl.querySelector('.aa-label');
  function onAlertAddTap(ev) {
    if (ev) { ev.preventDefault(); ev.stopPropagation(); }
    if (pendingAlertPrice === null) return;
    post({ type: 'addAlert', price: pendingAlertPrice });
    hidePendingAlert();
  }
  aaBtn.addEventListener('click', onAlertAddTap);
  aaBtn.addEventListener('touchend', onAlertAddTap);
  function showPendingAlert(price) {
    pendingAlertPrice = price;
    pendingShownAt = Date.now();
    aaLabel.textContent = price.toFixed(2);
    layoutPendingAlert();
  }
  function hidePendingAlert() {
    pendingAlertPrice = null;
    alertAddEl.style.display = 'none';
  }
  function layoutPendingAlert() {
    if (pendingAlertPrice === null || !mainSeries || !chart) { alertAddEl.style.display = 'none'; return; }
    var y = mainSeries.priceToCoordinate(pendingAlertPrice);
    var H = chartEl.clientHeight, W = chartEl.clientWidth;
    if (y === null || y === undefined || y < 0 || y > H - 28) { alertAddEl.style.display = 'none'; return; }
    var axisW = 0;
    try { axisW = chart.priceScale('right').width(); } catch (e) {}
    alertAddEl.style.display = 'block';
    aaLine.style.top = Math.round(y) + 'px';
    aaLine.style.width = Math.max(0, W - axisW - 30) + 'px';
    // Theme the dashed line in JS — the CSS hardcodes a light color that
    // vanishes on the light theme.
    aaLine.style.borderTop = '1px dashed ' + theme.text;
    aaLine.style.opacity = '0.75';
    aaBtn.style.top = Math.round(y - 13) + 'px';
    aaBtn.style.right = (axisW + 2) + 'px';
    aaLabel.style.top = Math.round(y - 11) + 'px';
    aaLabel.style.width = axisW + 'px';
    aaLabel.style.color = theme.text;
  }
  var refLabelsEl = document.getElementById('reflabels');

  var chart = null;
  var mainSeries = null;      // candle or line series
  var volumeSeries = null;
  var zonePrimitive = null;
  var priceLines = [];
  var zones = { auto: [], watch: [] };
  var pending = [];           // commands arriving before init
  var inited = false;

  var theme = {
    background: '#0A0B0F',
    text: '#F2F2F0',
    textSecondary: '#9496A3',
    grid: 'rgba(242,242,240,0.06)',
    separator: 'rgba(242,242,240,0.08)',
    crosshair: '#8A8D9A',
    up: '#26A69A',
    down: '#EF5350',
  };

  function plog(message) { post({ type: 'log', message: message }); }

  // Surface any uncaught JS error to the RN side (and on screen via the
  // error overlay) — without this a throw during init is a silent spinner.
  window.onerror = function (message, source, lineno) {
    post({ type: 'error', message: 'window.onerror: ' + message + ' @' + (source || '') + ':' + (lineno || '') });
  };

  // ── Zone bands: pane primitive ──────────────────────────────────────
  // Draws full-width shaded rects + edge lines for every zone, pinned to
  // price coordinates so they track pan/zoom for free. Band fills go in
  // drawBackground (behind the candles, like the legacy SVG layering);
  // edge lines in draw (above, subtle).
  function ZoneBandsPrimitive() {
    this._zones = [];
    this._series = null;
    this._requestUpdate = null;
    this._view = null;
  }
  ZoneBandsPrimitive.prototype.attached = function (param) {
    this._chart = param.chart;
    this._requestUpdate = param.requestUpdate;
  };
  ZoneBandsPrimitive.prototype.detached = function () {
    this._chart = null;
    this._series = null;
    this._requestUpdate = null;
  };
  ZoneBandsPrimitive.prototype.setZones = function (zones) {
    this._zones = zones;
    if (this._requestUpdate) this._requestUpdate();
  };
  ZoneBandsPrimitive.prototype.setSeries = function (series) {
    this._series = series;
    if (this._requestUpdate) this._requestUpdate();
  };
  // Called by the chart before every repaint (pan, zoom, autoscale, data,
  // resize) — the one reliable moment when priceToCoordinate is current.
  // Pills are re-laid out from here instead of a one-shot call after
  // setData, which ran before the first layout and got null coordinates.
  ZoneBandsPrimitive.prototype.updateAllViews = function () {
    schedulePills();
  };
  ZoneBandsPrimitive.prototype.paneViews = function () {
    var self = this;
    if (!self._view) {
      var drawBand = function (target, forBackground) {
        target.useBitmapCoordinateSpace(function (scope) {
          var ctx = scope.context;
          var s = self._series;
          if (!s) return;
          var vpr = scope.verticalPixelRatio;
          var hpr = scope.horizontalPixelRatio;
          var w = scope.bitmapSize.width;
          for (var i = 0; i < self._zones.length; i++) {
            var z = self._zones[i];
            // background pass draws fills only, foreground pass edges only
            var yH = s.priceToCoordinate(z.high);
            var yL = s.priceToCoordinate(z.low);
            if (yH === null || yL === null) continue;
            var top = Math.round(yH * vpr);
            var bot = Math.round(yL * vpr);
            var x0 = 0;
            var x1 = w;
            if (self._chart) {
              var ts = self._chart.timeScale();
              if (z.startTime != null) {
                var sx = ts.timeToCoordinate(z.startTime);
                if (sx !== null) x0 = Math.max(0, Math.round(sx * hpr));
              }
              if (z.endTime != null) {
                var ex = ts.timeToCoordinate(z.endTime);
                if (ex !== null) x1 = Math.min(w, Math.round(ex * hpr));
              }
            }
            if (x1 <= x0) continue;
            if (forBackground) {
              ctx.save();
              ctx.globalAlpha = z.opacity;
              ctx.fillStyle = z.color;
              ctx.fillRect(x0, top, x1 - x0, Math.max(1, bot - top));
              ctx.restore();
            } else if (z.edgeOpacity > 0) {
              ctx.save();
              ctx.globalAlpha = z.edgeOpacity;
              ctx.strokeStyle = z.edgeColor || z.color;
              ctx.lineWidth = Math.max(1, Math.round(vpr));
              if (z.dashed) ctx.setLineDash([4 * vpr, 4 * vpr]);
              ctx.beginPath();
              ctx.moveTo(x0, top + 0.5);
              ctx.lineTo(x1, top + 0.5);
              ctx.moveTo(x0, bot - 0.5);
              ctx.lineTo(x1, bot - 0.5);
              ctx.stroke();
              if (z.midline) {
                var mid = Math.round((top + bot) / 2) + 0.5;
                ctx.globalAlpha = z.edgeOpacity * 0.7;
                ctx.setLineDash([6 * vpr, 5 * vpr]);
                ctx.beginPath();
                ctx.moveTo(x0, mid);
                ctx.lineTo(x1, mid);
                ctx.stroke();
              }
              ctx.restore();
            }
          }
        });
      };
      self._view = {
        renderer: function () {
          return {
            drawBackground: function (target) { drawBand(target, true); },
            draw: function (target) { drawBand(target, false); },
          };
        },
      };
    }
    return [self._view];
  };

  // ── Score pills (DOM overlay) ───────────────────────────────────────
  // Real HTML so they're tappable. Styled and placed like the legacy
  // chart's pill: tucked against the price axis, sitting just above the
  // zone's top edge. Collision handling: sort by y, stagger downward on
  // overlap, hide any pill pushed off the plot or into the time-axis strip,
  // and hide pills whose anchor price is outside the visible range
  // (priceToCoordinate returns null).
  var PILL_H = 13;
  var PILL_GAP = 2;
  var PILL_AXIS_GAP = 4;      // px between pill and the price-axis gutter
  var TIME_AXIS_H = 28;

  // Ionicons trending-up / trending-down (same glyphs the legacy chart uses).
  var ICON_UP = '<svg viewBox="0 0 512 512"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="32" d="M352 144h112v112"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="32" d="M48 368l121.37-121.37a32 32 0 0145.26 0l50.74 50.74a32 32 0 0045.26 0L448 160"/></svg>';
  var ICON_DOWN = '<svg viewBox="0 0 512 512"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="32" d="M352 368h112V256"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="32" d="M48 144l121.37 121.37a32 32 0 0045.26 0l50.74-50.74a32 32 0 0145.26 0L448 352"/></svg>';

  var pillsScheduled = false;
  var pillsSig = '';
  function schedulePills() {
    if (pillsScheduled) return;
    pillsScheduled = true;
    requestAnimationFrame(function () {
      pillsScheduled = false;
      layoutPills();
      layoutRefLabels();
      layoutPendingAlert();
      layoutCountdown();
    });
  }

  // ── Next-candle countdown (legacy chart parity) ─────────────────────
  // One pill in the price-axis gutter at the last price holding BOTH the
  // price and a mm:ss countdown to the next bar — drawn over LWC's own
  // last-value label so it reads as a single tag, like the legacy chart.
  // Intraday only (RN sends barSeconds = null on daily+). Ticks in-page
  // once a second; no per-second bridge traffic.
  var countdownEl = document.createElement('div');
  countdownEl.id = 'countdown';
  countdownEl.innerHTML = '<div class="cd-price"></div><div class="cd-time"></div>';
  document.body.appendChild(countdownEl);
  var cdPriceEl = countdownEl.firstChild;
  var cdTimeEl = countdownEl.lastChild;
  var countdownBarSec = null;
  var countdownTimer = null;
  var CD_H = 30;

  function fmtLastPrice(p) {
    try {
      if (mainSeries && mainSeries.priceFormatter) return mainSeries.priceFormatter().format(p);
    } catch (e) {}
    return p.toFixed(2);
  }

  function layoutCountdown() {
    var last = lastCandles.length ? lastCandles[lastCandles.length - 1] : null;
    if (!countdownBarSec || !chart || !mainSeries || !last) { countdownEl.style.display = 'none'; return; }
    var secs = Math.round(last.t + countdownBarSec - Date.now() / 1000);
    // Past a whole extra bar with no new candle = market closed / feed
    // idle — hide rather than sit on 0:00 all night.
    if (secs < -countdownBarSec) { countdownEl.style.display = 'none'; return; }
    secs = Math.max(0, secs);
    var y = mainSeries.priceToCoordinate(last.c);
    var H = chartEl.clientHeight;
    if (y === null || y === undefined || !H) { countdownEl.style.display = 'none'; return; }
    var axisW = 0;
    try { axisW = chart.priceScale('right').width(); } catch (e) {}
    if (!axisW) { countdownEl.style.display = 'none'; return; }
    var top = Math.round(y - CD_H / 2);
    top = Math.max(0, Math.min(top, H - TIME_AXIS_H - CD_H));
    var h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
    var label = (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
    var up = mainSeries._tvKind === 'candle' ? last.c >= last.o : true;
    countdownEl.style.display = 'flex';
    countdownEl.style.top = top + 'px';
    countdownEl.style.width = axisW + 'px';
    countdownEl.style.background = up ? theme.up : theme.down;
    cdPriceEl.textContent = fmtLastPrice(last.c);
    cdTimeEl.textContent = label;
  }

  function setCountdown(msg) {
    countdownBarSec = msg.barSeconds > 0 ? msg.barSeconds : null;
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
    if (countdownBarSec) countdownTimer = setInterval(layoutCountdown, 1000);
    layoutCountdown();
  }

  // Text-only names for `textLabel` ref lines, left-aligned at the start
  // of the line just above it (like the legacy chart) — keeps them clear of
  // the zone pills and price tags clustered by the axis.
  var refLabelsSig = '';
  function layoutRefLabels() {
    if (!chart || !mainSeries) { refLabelsEl.innerHTML = ''; refLabelsSig = ''; return; }
    var H = chartEl.clientHeight;
    if (!H) return;
    var placed = [];
    for (var i = 0; i < refLineDefs.length; i++) {
      var l = refLineDefs[i];
      if (!l.textLabel || !l.title) continue;
      var y = mainSeries.priceToCoordinate(l.price);
      if (y === null) continue;
      var top = Math.round(y - 12);
      if (top < 0 || top > H - TIME_AXIS_H) continue;
      placed.push({ l: l, top: top });
    }
    var sig = theme.background + '|' + placed.map(function (p) {
      return p.l.title + ':' + p.top + ':' + p.l.color;
    }).join(',');
    if (sig === refLabelsSig) return;
    refLabelsSig = sig;
    refLabelsEl.innerHTML = '';
    for (var j = 0; j < placed.length; j++) {
      var el = document.createElement('div');
      el.className = 'rlabel';
      el.textContent = placed[j].l.title;
      el.style.top = placed[j].top + 'px';
      el.style.left = '6px';
      el.style.color = placed[j].l.color;
      // Faint halo in the chart bg so the text stays legible over candles.
      el.style.textShadow = '0 0 2px ' + theme.background + ', 0 0 2px ' + theme.background;
      refLabelsEl.appendChild(el);
    }
  }

  function layoutPills() {
    if (!chart || !mainSeries) { pillsEl.innerHTML = ''; pillsSig = ''; return; }
    var H = chartEl.clientHeight;
    var W = chartEl.clientWidth;
    if (!H || !W) return;
    var axisW = 0;
    try { axisW = chart.priceScale('right').width(); } catch (e) {}
    var right = axisW + PILL_AXIS_GAP;
    var items = [];
    for (var i = 0; i < zones.auto.length; i++) {
      var z = zones.auto[i];
      var y = mainSeries.priceToCoordinate(z.high);
      if (y === null) continue;
      items.push({ z: z, y: y });
    }
    items.sort(function (a, b) { return a.y - b.y; });
    var placed = [];
    var lastBottom = -Infinity;
    for (var k = 0; k < items.length; k++) {
      var it = items[k];
      var top = Math.round(it.y - PILL_H);
      if (top < lastBottom + PILL_GAP) top = lastBottom + PILL_GAP;
      var bottom = top + PILL_H;
      if (top < 0 || bottom > H - TIME_AXIS_H) continue; // off-plot
      lastBottom = bottom;
      placed.push({ z: it.z, top: top });
    }
    // Repaints fire on every pan frame — only touch the DOM when a pill
    // actually moved or changed.
    var sig = theme.background + '|' + right + '|' + placed.map(function (p) {
      return p.z.id + ':' + p.top + ':' + Math.round(p.z.score) + ':' + p.z.color;
    }).join(',');
    if (sig === pillsSig) return;
    pillsSig = sig;
    pillsEl.innerHTML = '';
    for (var j = 0; j < placed.length; j++) {
      var it = placed[j];
      var top = it.top;
      var pill = document.createElement('div');
      pill.className = 'zpill';
      pill.style.top = top + 'px';
      pill.style.right = right + 'px';
      pill.style.color = it.z.color;
      pill.style.background = theme.background + 'D9';
      pill.style.borderColor = it.z.color + '55';
      pill.setAttribute('data-zone-id', it.z.id);
      pill.innerHTML = it.z.kind === 'resistance' ? ICON_DOWN : ICON_UP;
      var label = document.createElement('span');
      label.textContent = Math.round(it.z.score);
      pill.appendChild(label);
      (function (id) {
        pill.addEventListener('click', function (ev) {
          ev.stopPropagation();
          post({ type: 'zone-tap', id: id, kind: 'auto' });
        });
      })(it.z.id);
      pillsEl.appendChild(pill);
    }
  }

  function onChartClick(param) {
    // A tap elsewhere dismisses a pending ⊕ (but not the click LWC may emit
    // as the long-press itself ends).
    if (pendingAlertPrice !== null && Date.now() - pendingShownAt > 400) hidePendingAlert();
    if (!param || !param.point || !mainSeries) return;
    var price = mainSeries.coordinateToPrice(param.point.y);
    if (price === null) return;
    // Watch zones have no pills — hit-test the band directly. ±14px tolerance
    // so thin/point levels (high == low) stay tappable on touch.
    var TAP_TOL_PX = 14;
    for (var i = 0; i < zones.watch.length; i++) {
      var z = zones.watch[i];
      var yTop = mainSeries.priceToCoordinate(z.high);
      var yBot = mainSeries.priceToCoordinate(z.low);
      if (yTop === null || yTop === undefined || yBot === null || yBot === undefined) {
        if (price <= z.high && price >= z.low) {
          post({ type: 'zone-tap', id: z.id, kind: 'watch' });
          return;
        }
        continue;
      }
      var lo = Math.min(yTop, yBot) - TAP_TOL_PX;
      var hi = Math.max(yTop, yBot) + TAP_TOL_PX;
      if (param.point.y >= lo && param.point.y <= hi) {
        post({ type: 'zone-tap', id: z.id, kind: 'watch' });
        return;
      }
    }
  }

  // ── Commands ────────────────────────────────────────────────────────
  function ensureSeries(kind) {
    // kind: 'candle' | 'line'
    var wantCandle = kind === 'candle';
    var isCandle = mainSeries && mainSeries._tvKind === 'candle';
    if (mainSeries && wantCandle === isCandle) return;
    if (mainSeries) {
      try { chart.removeSeries(mainSeries); } catch (e) {}
      mainSeries = null;
    }
    if (wantCandle) {
      mainSeries = chart.addSeries(LWC.CandlestickSeries, {
        upColor: theme.up, downColor: theme.down,
        wickUpColor: theme.up, wickDownColor: theme.down,
        borderVisible: true, borderUpColor: theme.up, borderDownColor: theme.down,
        priceLineVisible: true, lastValueVisible: true,
        priceLineStyle: LWC.LineStyle.Dotted,
      });
    } else {
      mainSeries = chart.addSeries(LWC.LineSeries, {
        color: theme.up, lineWidth: 2,
        priceLineVisible: true, lastValueVisible: true,
        priceLineStyle: LWC.LineStyle.Dotted,
      });
    }
    mainSeries._tvKind = kind;
    chart.priceScale('right').applyOptions({ scaleMargins: { top: 0.08, bottom: 0.24 } });
    if (zonePrimitive) zonePrimitive.setSeries(mainSeries);
    // re-apply price lines to the new series
    var saved = refLineDefs.slice();
    clearPriceLines();
    setRefLines(saved);
  }

  var refLineDefs = [];
  function clearPriceLines() {
    if (!mainSeries) return;
    for (var i = 0; i < priceLines.length; i++) {
      try { mainSeries.removePriceLine(priceLines[i]); } catch (e) {}
    }
    priceLines = [];
  }
  function setRefLines(lines) {
    refLineDefs = lines || [];
    clearPriceLines();
    if (!mainSeries) return;
    for (var i = 0; i < refLineDefs.length; i++) {
      var l = refLineDefs[i];
      priceLines.push(mainSeries.createPriceLine({
        price: l.price,
        color: l.color,
        lineWidth: l.lineWidth || 1,
        lineStyle: l.dotted ? LWC.LineStyle.Dotted : l.dashed ? LWC.LineStyle.Dashed : LWC.LineStyle.Solid,
        lineVisible: l.lineVisible !== false,
        axisLabelVisible: l.axisLabelVisible !== false,
        title: l.textLabel ? '' : (l.title || ''),
      }));
    }
    // Re-run autoscale so newly added fitInScale lines are folded in.
    mainSeries.applyOptions({ autoscaleInfoProvider: autoscaleWithRefLines });
    schedulePills();
  }

  // Price lines don't affect autoscale on their own — extend the series'
  // range to include fitInScale lines (EMA/VWAP/walls), matching the legacy
  // chart, so a daily EMA on a multi-day view is never silently off-screen.
  function autoscaleWithRefLines(original) {
    var res = original();
    if (!res || !res.priceRange) return res;
    var r = res.priceRange;
    for (var i = 0; i < refLineDefs.length; i++) {
      var l = refLineDefs[i];
      if (!l.fitInScale || !isFinite(l.price)) continue;
      if (l.price < r.minValue) r.minValue = l.price;
      if (l.price > r.maxValue) r.maxValue = l.price;
    }
    return res;
  }

  // ── Lazy-load backfill state ───────────────────────────────────────
  var lastLogicalRange = null;
  var lastHistoryRequest = 0;
  var historyExhausted = false;
  // Initial viewport of the current ticker/range, and whether the user has
  // touched the chart since it was framed. Until they do, data that lands
  // after the fit (the staged load's stage-2 backfill) re-applies it.
  var frameFrom = null;
  var touchedSinceFit = false;

  function applyFrame(candles) {
    try { chart.timeScale().fitContent(); } catch (e) {}
    if (frameFrom && candles.length) {
      try {
        chart.timeScale().setVisibleRange({ from: frameFrom, to: candles[candles.length - 1].t + 120 });
      } catch (e) {}
    }
  }

  function setData(msg) {
    var candles = msg.candles || [];
    if (!candles.length) return;
    var prevCount = lastCandles.length;
    // Where the user is looking BEFORE the reload: a live history poll must
    // not yank a panned-back view to the latest bar (it used to, every 30s).
    var atLiveEdge = true, savedRange = null;
    try {
      var ts0 = chart.timeScale();
      atLiveEdge = ts0.scrollPosition() > -2;
      savedRange = ts0.getVisibleLogicalRange();
    } catch (e) {}
    ensureSeries(msg.ohlc ? 'candle' : 'line');
    if (msg.ohlc) {
      mainSeries.setData(candles.map(function (c) {
        return { time: c.t, open: c.o, high: c.h, low: c.l, close: c.c };
      }));
    } else {
      mainSeries.setData(candles.map(function (c) {
        return { time: c.t, value: c.c };
      }));
    }
    // volume on its own overlay scale, pinned to the bottom
    if (!volumeSeries) {
      volumeSeries = chart.addSeries(LWC.HistogramSeries, {
        priceScaleId: '',
        priceFormat: { type: 'volume' },
      });
      chart.priceScale('').applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });
    }
    volumeSeries.setData(candles.map(function (c) {
      return {
        time: c.t,
        value: c.v || 0,
        color: c.c >= c.o ? theme.up + '80' : theme.down + '80',
      };
    }));
    if (msg.fit) {
      hidePendingAlert(); // new ticker/range — a pending ⊕ no longer applies
      // The date range is only the initial viewport now — frame it after fit.
      frameFrom = msg.visibleFrom || null;
      touchedSinceFit = false;
      applyFrame(candles);
      lastLogicalRange = null;
      lastHistoryRequest = 0;
      historyExhausted = false;
    } else if (msg.preserve && prevCount > 0) {
      // Backfill prepended bars on the left. LWC already keeps the view
      // anchored to the newest bar (its right offset is unchanged), so the
      // same bars stay on screen with no help. The old manual shift by the
      // added count moved it a second time — n bars past the last candle,
      // leaving a couple of candles pinned to the left edge of an empty
      // chart after every staged load.
      // Untouched since the fit: the first stage may have been narrower
      // than the requested range (1W over a 5-day stage 1) — re-frame now
      // that the full range is here.
      if (!touchedSinceFit) applyFrame(candles);
    } else if (atLiveEdge || !savedRange) {
      try { chart.timeScale().scrollToRealTime(); } catch (e) {}
    } else {
      // Bars only appended on the right, so logical indexes still line up.
      try { chart.timeScale().setVisibleLogicalRange(savedRange); } catch (e) {}
    }
    lastCloses = candles.map(function (c) { return { t: c.t, c: c.c }; });
    lastCandles = candles.slice();
    // Indicators after paint: candles are the priority. EMAs/VWAP/pills
    // follow on the next tick so the first frame isn't blocked by a full
    // recompute over hundreds of bars.
    var myCandles = lastCandles;
    setTimeout(function () {
      if (lastCandles !== myCandles) return; // a newer setData superseded this one
      rebuildEmas();
      rebuildVwap();
      schedulePills();
    }, 0);
  }

  // ── Timeframe EMA overlays (computed from the loaded bars) ─────────
  var emaConfig = [];
  var emaSeriesMap = {};
  var lastCloses = [];

  function emaValues(closes, period) {
    var k = 2 / (period + 1);
    var out = new Array(closes.length);
    if (!closes.length) return out;
    // TradingView-style: seed from the first close and plot from bar 0, so
    // the line is never cut off on the left. The seed's influence washes out
    // after ~period bars; with lazy-loaded history the warmup is exact.
    var prev = closes[0].c;
    for (var j = 0; j < closes.length; j++) {
      prev = closes[j].c * k + prev * (1 - k);
      out[j] = prev;
    }
    return out;
  }

  function rebuildEmas() {
    if (!chart || !inited) return;
    for (var p in emaSeriesMap) {
      try { chart.removeSeries(emaSeriesMap[p]); } catch (e) {}
    }
    emaSeriesMap = {};
    if (!lastCloses.length) return;
    emaConfig.forEach(function (cfg) {
      if (!cfg.visible) return;
      var vals = emaValues(lastCloses, cfg.period);
      var data = [];
      for (var i = 0; i < vals.length; i++) {
        if (vals[i] != null) data.push({ time: lastCloses[i].t, value: vals[i] });
      }
      if (!data.length) { plog('EMA ' + cfg.period + ': not enough bars'); return; }
      var s = chart.addSeries(LWC.LineSeries, {
        color: cfg.color,
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: true,
        crosshairMarkerVisible: true,
      });
      s.setData(data);
      emaSeriesMap[cfg.period] = s;
    });
  }

  function setEmaOverlays(msg) {
    emaConfig = msg.emas || [];
    rebuildEmas();
  }

  // ── Session VWAP (computed per-bar, resets each ET session) ──────────
  // The old straight VWAP price line is replaced by a real series: cumulative
  // typical-price×volume / cumulative volume, restarted at each ET midnight.
  // Unlike EMA it needs no warmup — it's defined from the first bar.
  var vwapVisible = false;
  var vwapSeries = null;
  var lastCandles = [];

  function etDayKey(t) {
    return new Date(t * 1000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  }

  // ET minutes-since-midnight for a unix timestamp — used to anchor VWAP
  // at the regular-session open even when extended-hours bars are shown.
  function etMinutes(t) {
    var parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York', hour: 'numeric', minute: 'numeric', hour12: false,
    }).formatToParts(new Date(t * 1000));
    var h = 0, m = 0;
    for (var i = 0; i < parts.length; i++) {
      if (parts[i].type === 'hour') h = (+parts[i].value) % 24;
      else if (parts[i].type === 'minute') m = +parts[i].value;
    }
    return h * 60 + m;
  }

  // ── Live ticks ───────────────────────────────────────────────────────
  // Update the forming bar / append a new one in place (series.update —
  // the chart keeps its viewport and follows the edge only when you're on
  // it). EMAs/VWAP are full recomputes, so they're throttled during ticks.
  var indicatorTimer = null;
  function scheduleIndicators() {
    if (indicatorTimer) return;
    indicatorTimer = setTimeout(function () {
      indicatorTimer = null;
      rebuildEmas();
      rebuildVwap();
    }, 1000);
  }
  function updateBars(msg) {
    if (!mainSeries || !lastCandles.length) return;
    var bars = msg.bars || [];
    for (var i = 0; i < bars.length; i++) {
      var c = bars[i];
      var last = lastCandles[lastCandles.length - 1];
      if (c.t < last.t) continue; // only the newest bar can change
      try {
        if (mainSeries._tvKind === 'candle') {
          mainSeries.update({ time: c.t, open: c.o, high: c.h, low: c.l, close: c.c });
        } else {
          mainSeries.update({ time: c.t, value: c.c });
        }
        if (volumeSeries) {
          volumeSeries.update({ time: c.t, value: c.v || 0, color: c.c >= c.o ? theme.up + '80' : theme.down + '80' });
        }
      } catch (e) { continue; }
      if (c.t === last.t) {
        lastCandles[lastCandles.length - 1] = c;
        lastCloses[lastCloses.length - 1] = { t: c.t, c: c.c };
      } else {
        lastCandles.push(c);
        lastCloses.push({ t: c.t, c: c.c });
      }
    }
    scheduleIndicators();
    schedulePills();
  }

  function rebuildVwap() {
    if (!chart || !inited) return;
    if (vwapSeries) { try { chart.removeSeries(vwapSeries); } catch (e) {} vwapSeries = null; }
    if (!vwapVisible || !lastCandles.length) return;
    var data = [];
    var pv = 0, v = 0, day = null, lastVal = null;
    for (var i = 0; i < lastCandles.length; i++) {
      var c = lastCandles[i];
      var k = etDayKey(c.t);
      if (k !== day) { day = k; pv = 0; v = 0; }
      // VWAP anchors at the regular-session open (09:30 ET) — extended-hours
      // bars plot on the chart but never enter the accumulation.
      if (etMinutes(c.t) < 9 * 60 + 30) continue;
      var tp = (c.h + c.l + c.c) / 3;
      var vol = c.v || 0;
      pv += tp * vol; v += vol;
      // A zero-volume bar holds the previous value so the line never gaps.
      var val = v > 0 ? pv / v : lastVal;
      if (val == null) val = tp;
      lastVal = val;
      // Break the line at session boundaries so days don't bridge. A
      // whitespace point can't do it — setData needs strictly unique,
      // ascending times, so the old same-time gap marker threw on any
      // multi-day intraday load. Instead the session's LAST point is
      // transparent: in this build a segment takes the color of the point
      // it leads INTO, and the style change strokes at the boundary — so
      // the bridge segment goes invisible while each session's own last
      // segment keeps its color.
      var sessionEnd = i + 1 < lastCandles.length && k !== etDayKey(lastCandles[i + 1].t);
      data.push(sessionEnd
        ? { time: c.t, value: val, color: 'rgba(0,0,0,0)' }
        : { time: c.t, value: val });
    }
    vwapSeries = chart.addSeries(LWC.LineSeries, {
      color: '#A855F7',
      lineWidth: 2,
      lineStyle: LWC.LineStyle.Dashed,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: true,
    });
    vwapSeries.setData(data);
  }

  function setVwap(msg) {
    vwapVisible = !!msg.visible;
    rebuildVwap();
  }

  function setOptions(msg) {
    if (!chart) return;
    chart.applyOptions({
      crosshair: { mode: msg.crosshair === false ? LWC.CrosshairMode.Hidden : LWC.CrosshairMode.Normal },
    });
  }

  function setZones(msg) {
    zones.auto = msg.auto || [];
    zones.watch = msg.watch || [];
    zones.bands = msg.bands || [];
    if (zonePrimitive) {
      zonePrimitive.setZones(zones.auto.concat(zones.watch, zones.bands));
    }
    schedulePills();
  }

  function applyTheme(t) {
    theme = Object.assign({}, theme, t);
    if (!chart) return;
    chart.applyOptions({
      layout: {
        background: { type: LWC.ColorType.Solid, color: theme.background },
        textColor: theme.textSecondary,
      },
      grid: {
        vertLines: { color: theme.grid },
        horzLines: { color: theme.grid },
      },
      rightPriceScale: { borderColor: theme.separator },
      timeScale: { borderColor: theme.separator },
      crosshair: {
        vertLine: { color: theme.crosshair },
        horzLine: { color: theme.crosshair },
      },
    });
    if (mainSeries && mainSeries._tvKind === 'candle') {
      mainSeries.applyOptions({
        upColor: theme.up, downColor: theme.down,
        wickUpColor: theme.up, wickDownColor: theme.down,
        borderUpColor: theme.up, borderDownColor: theme.down,
      });
    } else if (mainSeries) {
      mainSeries.applyOptions({ color: theme.up });
    }
    document.body.style.background = theme.background;
    schedulePills();
  }

  function init(msg) {
    if (inited) return;
    inited = true;
    try {
    if (msg.theme) theme = Object.assign({}, theme, msg.theme);
    document.body.style.background = theme.background;
    plog('creating chart, LWC v' + (LWC.version ? LWC.version() : 'unknown'));
    chart = LWC.createChart(chartEl, {
      autoSize: true,
      layout: {
        background: { type: LWC.ColorType.Solid, color: theme.background },
        textColor: theme.textSecondary,
        fontSize: 11,
        fontFamily: "-apple-system, 'SF Pro Text', sans-serif",
      },
      grid: {
        vertLines: { color: theme.grid },
        horzLines: { color: theme.grid },
      },
      rightPriceScale: { borderColor: theme.separator },
      timeScale: {
        borderColor: theme.separator,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 4,
      },
      crosshair: {
        mode: LWC.CrosshairMode.Normal,
        vertLine: { color: theme.crosshair, labelBackgroundColor: theme.crosshair },
        horzLine: { color: theme.crosshair, labelBackgroundColor: theme.crosshair },
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: true,
      },
      handleScale: {
        mouseWheel: true,
        pinch: true,
        axisPressedMouseMove: true,
      },
    });
    zonePrimitive = new ZoneBandsPrimitive();
    chart.panes()[0].attachPrimitive(zonePrimitive);
    plog('primitive attached, panes=' + chart.panes().length);
    chart.timeScale().subscribeVisibleLogicalRangeChange(function (range) {
      schedulePills();
      // Lazy-load backfill: panning near the oldest loaded bar asks RN for
      // the next older window. Throttled + naturally hysteresis'd — after a
      // prepend the visible range shifts right by the added bars.
      if (!range) return;
      lastLogicalRange = range;
      var now = Date.now();
      if (range.from < 30 && !historyExhausted && now - lastHistoryRequest > 2000) {
        lastHistoryRequest = now;
        post({ type: 'requestMoreHistory' });
      }
    });
    chart.subscribeClick(onChartClick);
    // Long-press (press-and-hold) → report the crosshair price on release so
    // RN can offer a "set crossing alert here" pill. Quick taps and pans
    // never fire it:
    // - touchmove before the crosshair appears (a real pan) cancels the
    //   timer, so scrolling the chart can't pop the pill up mid-gesture;
    // - once LWC's own long-tap enters tracking mode (crosshair visible),
    //   moving the finger just repositions the crosshair — that's the
    //   "hold, drag to the exact price, release" flow, so it must NOT cancel.
    var LONG_PRESS_MS = 450;
    var MOVE_SLOP_PX2 = 100; // ~10px
    var pressTimer = null;
    var longPressArmed = false;
    var lastCrosshairPrice = null;
    var crosshairShownThisPress = false;
    var touchStartX = 0, touchStartY = 0;
    chartEl.addEventListener('touchstart', function (e) {
      touchedSinceFit = true;
      longPressArmed = false;
      lastCrosshairPrice = null;
      crosshairShownThisPress = false;
      var t = e.touches && e.touches[0];
      touchStartX = t ? t.clientX : 0;
      touchStartY = t ? t.clientY : 0;
      if (pressTimer) clearTimeout(pressTimer);
      pressTimer = setTimeout(function () { longPressArmed = true; }, LONG_PRESS_MS);
    }, { passive: true });
    chartEl.addEventListener('touchmove', function (e) {
      if (crosshairShownThisPress || !pressTimer) return;
      var t = e.touches && e.touches[0];
      if (!t) return;
      var dx = t.clientX - touchStartX, dy = t.clientY - touchStartY;
      if (dx * dx + dy * dy > MOVE_SLOP_PX2) {
        clearTimeout(pressTimer);
        pressTimer = null;
        longPressArmed = false;
      }
    }, { passive: true });
    function endPress(e) {
      if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
      // One line per press in Metro ("[TVChart] page log: press …") so a
      // long-press that doesn't offer the alert shows exactly why.
      if (longPressArmed || crosshairShownThisPress) {
        plog('press ' + (e && e.type) + ' armed=' + longPressArmed + ' crosshair=' + crosshairShownThisPress +
          ' price=' + (lastCrosshairPrice === null ? 'null' : lastCrosshairPrice.toFixed(2)));
      }
      if (longPressArmed && lastCrosshairPrice !== null) {
        showPendingAlert(lastCrosshairPrice);
      }
      longPressArmed = false;
      lastCrosshairPrice = null;
      crosshairShownThisPress = false;
    }
    chartEl.addEventListener('touchend', endPress, { passive: true });
    chartEl.addEventListener('touchcancel', endPress, { passive: true });
    chart.subscribeCrosshairMove(function (param) {
      if (param && param.point && mainSeries) {
        var p = mainSeries.coordinateToPrice(param.point.y);
        lastCrosshairPrice = (p === null || p === undefined) ? null : p;
        crosshairShownThisPress = true;
      } else {
        lastCrosshairPrice = null;
      }
    });
    post({ type: 'ready' });
    plog('ready posted');
    // flush anything that arrived early
    var q = pending;
    pending = [];
    for (var i = 0; i < q.length; i++) handleCommand(q[i]);
    } catch (err) {
      post({ type: 'error', message: 'init failed: ' + (err && err.message ? err.message : String(err)) });
    }
  }

  function handleCommand(msg) {
    if (!msg || !msg.type) return;
    if (msg.type === 'init') {
      // A repeated init (RN re-sent after a re-posted `loaded`) means RN may
      // have missed our `ready` — say it again.
      if (inited) { post({ type: 'ready' }); return; }
      init(msg);
      return;
    }
    if (!inited) { pending.push(msg); return; }
    switch (msg.type) {
      case 'setData': setData(msg); break;
      case 'updateBars': updateBars(msg); break;
      case 'setZones': setZones(msg); break;
      case 'setRefLines': setRefLines(msg.lines); break;
      case 'setEmaOverlays': setEmaOverlays(msg); break;
      case 'setVwap': setVwap(msg); break;
      case 'setCountdown': setCountdown(msg); break;
      case 'setHistoryExhausted': historyExhausted = !!msg.exhausted; break;
      case 'setOptions': setOptions(msg); break;
      case 'applyTheme': applyTheme(msg.theme); break;
    }
  }

  function onRNMessage(event) {
    var msg = null;
    try { msg = JSON.parse(event.data); } catch (e) { return; }
    handleCommand(msg);
  }
  window.addEventListener('message', onRNMessage);
  document.addEventListener('message', onRNMessage);

  // Handshake: tell RN the page script is live so it sends `init`. The
  // page then answers with `ready` once the chart exists. (Without this,
  // RN waits for `ready` and the page waits for `init` — forever spinner.)
  // Re-announce until `init` arrives: a single `loaded` lost in transit
  // (or handled before RN's onLoadStart reset) used to strand the chart on
  // its spinner for good.
  post({ type: 'loaded' });
  var loadedRetries = 0;
  var loadedTimer = setInterval(function () {
    if (inited || ++loadedRetries > 20) { clearInterval(loadedTimer); return; }
    post({ type: 'loaded' });
  }, 500);
})();
