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

  var LWC = window.LightweightCharts;
  if (!LWC) return;

  var chartEl = document.getElementById('chart');
  var pillsEl = document.getElementById('pills');

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

  function post(msg) {
    if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
      window.ReactNativeWebView.postMessage(JSON.stringify(msg));
    }
  }

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
  ZoneBandsPrimitive.prototype.paneViews = function () {
    var self = this;
    if (!self._view) {
      var drawBand = function (target, forBackground) {
        target.useBitmapCoordinateSpace(function (scope) {
          var ctx = scope.context;
          var s = self._series;
          if (!s) return;
          var vpr = scope.verticalPixelRatio;
          var w = scope.bitmapSize.width;
          for (var i = 0; i < self._zones.length; i++) {
            var z = self._zones[i];
            // background pass draws fills only, foreground pass edges only
            var yH = s.priceToCoordinate(z.high);
            var yL = s.priceToCoordinate(z.low);
            if (yH === null || yL === null) continue;
            var top = Math.round(yH * vpr);
            var bot = Math.round(yL * vpr);
            if (forBackground) {
              ctx.save();
              ctx.globalAlpha = z.opacity;
              ctx.fillStyle = z.color;
              ctx.fillRect(0, top, w, Math.max(1, bot - top));
              ctx.restore();
            } else {
              ctx.save();
              ctx.globalAlpha = z.edgeOpacity;
              ctx.strokeStyle = z.color;
              ctx.lineWidth = Math.max(1, Math.round(vpr));
              if (z.dashed) ctx.setLineDash([4 * vpr, 4 * vpr]);
              ctx.beginPath();
              ctx.moveTo(0, top + 0.5);
              ctx.lineTo(w, top + 0.5);
              ctx.moveTo(0, bot - 0.5);
              ctx.lineTo(w, bot - 0.5);
              ctx.stroke();
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
  // Real HTML so they're tappable. Right-aligned like the legacy chart.
  // Collision handling: sort by y, stagger downward on overlap, hide any
  // pill pushed off the plot or into the time-axis strip, and hide pills
  // whose anchor price is outside the visible range (priceToCoordinate
  // returns null). Pills sit left of the price axis (right:76px) so they
  // can never overlap the axis gutter horizontally.
  var PILL_H = 22;
  var PILL_GAP = 5;
  var PILL_RIGHT = 76;
  var TIME_AXIS_H = 28;

  function layoutPills() {
    pillsEl.innerHTML = '';
    if (!chart || !mainSeries) return;
    var H = chartEl.clientHeight;
    var W = chartEl.clientWidth;
    if (!H || !W) return;
    var items = [];
    for (var i = 0; i < zones.auto.length; i++) {
      var z = zones.auto[i];
      var y = mainSeries.priceToCoordinate(z.high);
      if (y === null) continue;
      items.push({ z: z, y: y });
    }
    items.sort(function (a, b) { return a.y - b.y; });
    var lastBottom = -Infinity;
    for (var k = 0; k < items.length; k++) {
      var it = items[k];
      var top = Math.round(it.y - PILL_H / 2);
      if (top < lastBottom + PILL_GAP) top = lastBottom + PILL_GAP;
      var bottom = top + PILL_H;
      if (top < 0 || bottom > H - TIME_AXIS_H) continue; // off-plot
      lastBottom = bottom;
      var pill = document.createElement('div');
      pill.className = 'zpill';
      pill.style.top = top + 'px';
      pill.style.right = PILL_RIGHT + 'px';
      pill.style.color = theme.text;
      pill.style.background = theme.background + 'D9';
      pill.style.borderColor = it.z.color + '55';
      pill.setAttribute('data-zone-id', it.z.id);
      var dot = document.createElement('span');
      dot.style.cssText = 'width:7px;height:7px;border-radius:4px;background:' + it.z.color + ';flex:none;';
      var label = document.createElement('span');
      label.textContent = Math.round(it.z.score);
      pill.appendChild(dot);
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
        borderVisible: false,
        priceLineVisible: true, lastValueVisible: true,
      });
    } else {
      mainSeries = chart.addSeries(LWC.LineSeries, {
        color: theme.up, lineWidth: 2,
        priceLineVisible: true, lastValueVisible: true,
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
        lineWidth: 1,
        lineStyle: l.dashed ? LWC.LineStyle.Dashed : LWC.LineStyle.Solid,
        axisLabelVisible: true,
        title: l.title || '',
      }));
    }
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
    layoutPills();
  }

  function setZones(msg) {
    zones.auto = msg.auto || [];
    zones.watch = msg.watch || [];
    zones.bands = msg.bands || [];
    if (zonePrimitive) {
      zonePrimitive.setZones(zones.auto.concat(zones.watch, zones.bands));
    }
    layoutPills();
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
      });
    } else if (mainSeries) {
      mainSeries.applyOptions({ color: theme.up });
    }
    document.body.style.background = theme.background;
    layoutPills();
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
    chart.timeScale().subscribeVisibleLogicalRangeChange(function () { layoutPills(); });
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
      case 'setRefLines': setRefLines(msg); break;
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
})();
