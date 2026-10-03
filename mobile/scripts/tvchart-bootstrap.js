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
    });
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
    if (!param || !param.point || !mainSeries) return;
    var price = mainSeries.coordinateToPrice(param.point.y);
    if (price === null) return;
    // Watch zones have no pills — hit-test the band directly.
    for (var i = 0; i < zones.watch.length; i++) {
      var z = zones.watch[i];
      if (price <= z.high && price >= z.low) {
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

  function setData(msg) {
    var candles = msg.candles || [];
    if (!candles.length) return;
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
      try { chart.timeScale().fitContent(); } catch (e) {}
    } else {
      try { chart.timeScale().scrollToRealTime(); } catch (e) {}
    }
    lastCloses = candles.map(function (c) { return { t: c.t, c: c.c }; });
    rebuildEmas();
    schedulePills();
  }

  // ── Timeframe EMA overlays (computed from the loaded bars) ─────────
  var emaConfig = [];
  var emaSeriesMap = {};
  var lastCloses = [];

  function emaValues(closes, period) {
    var k = 2 / (period + 1);
    var out = new Array(closes.length);
    if (closes.length < period) return out;
    // Seed with the SMA of the first `period` closes (TV-like warmup).
    var seed = 0;
    for (var i = 0; i < period; i++) seed += closes[i].c;
    var prev = seed / period;
    for (var j = 0; j < closes.length; j++) {
      if (j < period - 1) { out[j] = null; continue; }
      if (j === period - 1) { out[j] = prev; continue; }
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
    chart.timeScale().subscribeVisibleLogicalRangeChange(function () { schedulePills(); });
    chart.subscribeClick(onChartClick);
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
    if (msg.type === 'init') { init(msg); return; }
    if (!inited) { pending.push(msg); return; }
    switch (msg.type) {
      case 'setData': setData(msg); break;
      case 'setZones': setZones(msg); break;
      case 'setRefLines': setRefLines(msg.lines); break;
      case 'setEmaOverlays': setEmaOverlays(msg); break;
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
  post({ type: 'loaded' });
})();
