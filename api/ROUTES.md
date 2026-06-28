# API Route Structure

`app.py` is the Flask entry point (~175 lines). It registers blueprints, owns the two WebSocket handlers (which need direct access to `sock`), and initialises the ORB strategy engine. All HTTP routes live in `routes/`.

---

## Blueprint files

| File | Blueprint name | URL prefix | Owns |
|------|---------------|------------|------|
| `routes/ticker_routes.py` | `ticker` | *(none)* | Ticker research, blog posts, ticker updates, FINVIZ trending |
| `routes/yahoo_routes.py` | `yahoo` | *(none)* | Yahoo Finance gainers/losers/trending/most-active, `/watchlist/all` |
| `routes/monitoring_routes.py` | `monitoring` | *(none)* | ORB service, options contract monitor, `/services/*` unified control, global `ORB_SERVICE` / `OPTIONS_MONITOR_SERVICE` state |
| `routes/options_routes.py` | `options` | *(none)* | Options chain fetch, track-option CRUD, tracked-options list, suggested contracts |
| `routes/portfolio_routes.py` | `portfolio` | *(none)* | Portfolio price refresh, portfolio metrics |
| `routes/agent_routes.py` | `agent` | *(none)* | TINDEX AI chat (SSE stream), contract AI scoring |
| `routes/flow_routes.py` | `flow` | *(none)* | Unusual Whales flow alerts (global + per-ticker) |
| `routes/strategy_routes.py` | `strategy_bp` | *(none)* | ORB strategy CRUD, immediate-trade engine, strategy WebSocket helper |

> All blueprints use **no `url_prefix`** — every URL path is identical to what it was before the split.

---

## Where to put new routes

| New route is about… | Add to |
|--------------------|--------|
| Stock research, blog/post generation, ticker data | `ticker_routes.py` |
| Yahoo Finance screener / watchlists | `yahoo_routes.py` |
| Starting/stopping background services, ORB monitoring, contract price polling | `monitoring_routes.py` |
| Options chain, tracking contracts, suggested contracts | `options_routes.py` |
| Portfolio positions, P&L, metrics | `portfolio_routes.py` |
| AI chat, AI contract scoring | `agent_routes.py` |
| Option flow / dark pool alerts | `flow_routes.py` |
| ORB strategy config, paper/live toggle, trade history | `strategy_routes.py` |
| WebSocket handlers | `app.py` (needs `sock` object directly) |

---

## Adding a new blueprint

1. Create `routes/<name>_routes.py`:

```python
from flask import Blueprint, jsonify, request
from log.logging_config import get_logger

logger = get_logger(__name__)
bp = Blueprint("<name>", __name__)   # no url_prefix — URLs stay as-is

@bp.route("/your/path", methods=["GET"])
def your_handler():
    ...
```

2. Register it in `app.py`:

```python
from routes.<name>_routes import bp as <name>_bp
app.register_blueprint(<name>_bp)
```

---

## Global state

| Variable | Lives in |
|----------|----------|
| `ORB_SERVICE`, `ORB_TASK`, `orb_lock` | `monitoring_routes.py` |
| `OPTIONS_MONITOR_SERVICE`, `OPTIONS_MONITOR_TASK`, `options_monitor_lock` | `monitoring_routes.py` |
| `_strategy_engines` | `app.py` (init block) + imported by `strategy_routes.py` via `_engines` |
| `price_stream` | `services/websocket/price_stream_service.py` (started in `app.py`) |

---

## Shared helpers

| Helper | Lives in |
|--------|----------|
| `RequestData` / `RequestDataError` dataclasses | `ticker_routes.py` |
| `validate_and_create_ticker_request_data` | `ticker_routes.py` |
| `_build_ticker_context` (live yfinance snapshot for agent) | `agent_routes.py` |
| `DEFAULT_AGENT_SYSTEM_PROMPT` | `agent_routes.py` |
| `SERVICE_REGISTRY` | `monitoring_routes.py` |
