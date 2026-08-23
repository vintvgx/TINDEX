import json

from flask import Flask, request
from flask_sock import Sock  # pylint: disable=import-error

from log.logging_config import get_logger
from services.utils.market_hours import is_market_hours

logger = get_logger(__name__)

# ── App + WebSocket ────────────────────────────────────────────────────────────

app = Flask(__name__)
sock = Sock(app)

# ── Middleware ─────────────────────────────────────────────────────────────────

@app.before_request
def log_request_info():
    logger.info("Request: %s %s - User-Agent: %s", request.method, request.path, request.headers.get("User-Agent", "Unknown"))


@app.after_request
def log_response_info(response):
    logger.info("Response: %s for %s %s", response.status_code, request.method, request.path)
    return response


# ── Live price broadcast ───────────────────────────────────────────────────────

from services.websocket.price_stream_service import price_stream
price_stream.start()

# Per-chart real-time equity stream (ws_chart_live below) polls yfinance
# directly rather than importing stock_chart_stream's paper-key Alpaca
# stream — that connection was erroring on Railway, so it's been pulled out
# of this path. stock_chart_stream.py is left in place, unused, in case the
# Alpaca stream gets re-enabled later.

# Single shared Alpaca option-data-stream connection for the whole process.
# Constructed here (module scope, before the ORB engine's try/except below)
# so a failure initialising ORB engines can never take this down — but its
# construction itself is just object setup (no network I/O), so it's safe to
# create unconditionally rather than tucking it inside a try/except. Do not
# create a second OptionStreamManager anywhere else: this account's Alpaca
# plan allows only one live connection per API key, and a second one causes
# a "connection limit exceeded" reconnect storm (see
# services/websocket/social_signals_stream.py's docstring for the incident).
from services.strategy.option_stream import OptionStreamManager
_option_stream_manager = OptionStreamManager()

from services.websocket.social_signals_stream import social_signals_stream
social_signals_stream.set_stream_manager(_option_stream_manager)
social_signals_stream.start()


@sock.route("/ws/social-signals/live")
def ws_social_signals_live(ws):
    """
    Live mid-price ticks for every currently-tracked social-signal contract —
    one shared connection per client, fanned out from social_signals_stream's
    single background broadcast loop (see that module's docstring for why
    this isn't one poll-loop-per-connection, and why this route is registered
    here at module scope rather than nested inside the ORB engine's
    try/except below — a failure initialising ORB engines must never be able
    to silently take the social-signals stream down with it).
    """
    import queue as _queue

    client_q = social_signals_stream.add_client()
    try:
        while True:
            try:
                msg = client_q.get(timeout=30)
                ws.send(msg)
            except _queue.Empty:
                ws.send(json.dumps({"type": "ping"}))
    except Exception as exc:
        logger.debug("[WS/social-signals] connection ended: %s", exc)
    finally:
        social_signals_stream.remove_client(client_q)


# ── Blueprints ─────────────────────────────────────────────────────────────────

from routes.ticker_routes import bp as ticker_bp
from routes.yahoo_routes import bp as yahoo_bp
from routes.monitoring_routes import bp as monitoring_bp
from routes.options_routes import bp as options_bp
from routes.portfolio_routes import bp as portfolio_bp
from routes.agent_routes import bp as agent_bp
from routes.swing_routes import bp as swing_bp
from routes.social_routes import bp as social_bp
from routes.robinhood_routes import bp as robinhood_bp
from routes.review_notes_routes import bp as review_notes_bp
from routes.price_level_routes import bp as price_levels_bp

app.register_blueprint(ticker_bp)
app.register_blueprint(yahoo_bp)
app.register_blueprint(monitoring_bp)
app.register_blueprint(options_bp)
app.register_blueprint(portfolio_bp)
app.register_blueprint(agent_bp)
app.register_blueprint(swing_bp)
app.register_blueprint(social_bp)
app.register_blueprint(robinhood_bp)
app.register_blueprint(review_notes_bp)
app.register_blueprint(price_levels_bp)


# ── WebSocket: live price stream ───────────────────────────────────────────────

@sock.route("/ws/prices")
def ws_prices(ws):
    import queue as _queue
    import threading as _threading

    client_queue = price_stream.add_client()
    tickers_lock = _threading.Lock()
    client_tickers: list[str] = []

    def _apply_tickers(new_tickers: list[str]):
        nonlocal client_tickers
        with tickers_lock:
            for t in client_tickers:
                price_stream.unsubscribe(t)
            client_tickers = [t.upper() for t in new_tickers]
            for t in client_tickers:
                price_stream.subscribe(t)
        logger.info("[WS] subscribed to %d tickers: %s", len(client_tickers), client_tickers)

    def _reader():
        while True:
            try:
                raw = ws.receive(timeout=60)
                if raw is None:
                    break
                msg = json.loads(raw)
                if "tickers" in msg:
                    _apply_tickers(msg["tickers"])
            except Exception:
                break

    reader_thread = _threading.Thread(target=_reader, daemon=True, name="ws-price-reader")
    reader_thread.start()

    try:
        while True:
            try:
                payload = client_queue.get(timeout=30)
                ws.send(payload)
            except _queue.Empty:
                ws.send(json.dumps({"type": "ping"}))
    except Exception as exc:
        logger.debug("[WS] client disconnected: %s", exc)
    finally:
        price_stream.remove_client(client_queue)
        with tickers_lock:
            for ticker in client_tickers:
                price_stream.unsubscribe(ticker)


CHART_POLL_INTERVAL = 5  # seconds — matches price_stream_service's cadence

# ── WebSocket: per-chart real-time equity stream (Yahoo-backed) ────────────────

@sock.route("/ws/chart/<ticker>/live")
def ws_chart_live(ws, ticker: str):
    """
    Last-trade price for exactly one ticker, for whichever chart is currently
    open. Polls yfinance directly on this connection's own thread (via
    batch_fetch_current_prices — the same yfinance path /ws/prices already
    relies on) rather than the paper-key Alpaca stream in stock_chart_stream.py,
    which was pulled from this path after it started erroring on Railway.
    Independent of /ws/prices itself and of the ORB engines' own live-account
    stock stream.
    """
    import time as _time
    from services.portfolio.portfolio_service import batch_fetch_current_prices

    symbol = ticker.upper()
    try:
        while True:
            price = None
            try:
                price = batch_fetch_current_prices([symbol]).get(symbol)
            except Exception as exc:
                logger.warning("[WS/chart] price fetch failed for %s: %s", symbol, exc)

            if price is not None:
                ws.send(json.dumps({"type": "price_update", "price": price}))
            else:
                ws.send(json.dumps({"type": "ping"}))
            _time.sleep(CHART_POLL_INTERVAL)
    except Exception as exc:
        logger.debug("[WS/chart] client disconnected: %s", exc)


# ── ORB Strategy Engine ────────────────────────────────────────────────────────

try:
    from services.strategy.orb_engine import ORBEngine, STRATEGY_DEFAULTS
    from services.strategy.trade_logger import TradeLogger as StrategyLogger
    from services.strategy.scheduler import init_scheduler as init_strategy_scheduler
    from routes.strategy_routes import strategy_bp, init_routes as init_strategy_routes

    # _option_stream_manager is the single shared OptionStreamManager created
    # above (module scope) — reused here, not recreated, to keep exactly one
    # live Alpaca option-stream connection for the whole process.

    def _build_strategy_engines() -> dict:
        svc_logger = StrategyLogger()
        configs = svc_logger.load_configs()
        if not configs:
            default = STRATEGY_DEFAULTS.copy()
            saved = svc_logger.save_strategy_config(default)
            if saved:
                default["id"] = saved["id"]
            configs = [default]
        engines = {}
        for cfg in configs:
            try:
                eng = ORBEngine(cfg, stream_manager=_option_stream_manager)
                engines[cfg["id"]] = eng
                init_strategy_scheduler(eng)
            except Exception as _eng_err:
                logger.warning("[App] Failed to start engine for config %s: %s", cfg.get("id"), _eng_err)
        return engines

    _strategy_engines = _build_strategy_engines()
    app.register_blueprint(strategy_bp)
    init_strategy_routes(_strategy_engines, stream_manager=_option_stream_manager)
    logger.info("[App] ORB strategy engines initialised (%d configs)", len(_strategy_engines))

    # Reattach exit management to any position still open at the broker —
    # unconditional, every boot, regardless of time of day. Before this, a
    # restart mid-position silently dropped it from both display and stop-
    # loss/TP monitoring while the real Alpaca position sat untouched — that
    # cost real money on 2026-07-13. See
    # docs/incidents/2026-07-14-position-lost-on-restart.md. Not wrapped in
    # its own try/except beyond what recover_open_positions() already does
    # internally per-row — a failure recovering one position must never
    # silently skip the rest.
    try:
        from routes.strategy_routes import recover_open_positions as _recover_positions
        _recover_positions()
    except Exception as _recover_err:
        logger.error("[App] Position recovery failed: %s", _recover_err, exc_info=True)

    # The daily review used to ALSO be scheduled here via an in-process
    # APScheduler job (schedule_daily_review), on top of the Supabase pg_cron
    # job that already hits /strategy/review/generate at 4:15 PM ET — both
    # firing around the same time produced duplicate "Daily Review ready"
    # push notifications (2026-07-15). pg_cron is strictly better here (an
    # external trigger, not an in-process job that dies with the process) so
    # it's now the only path — removed the in-process registration entirely.
    #
    # The 0DTE scan scheduler (schedule_zero_dte_scans) was removed on
    # 2026-07-15 — its Supabase pg_cron jobs were unscheduled directly, see
    # supabase/migrations/20260715_remove_zero_dte_cron.sql. The Unusual
    # Whales-fed 0DTE watchlist feature itself (routes/zero_dte_routes.py,
    # services/zero_dte/) has since been removed entirely along with all
    # other Unusual Whales integration, following cancellation of the
    # Unusual Whales subscription.

    # Auto-start the ORB data hub, social-signal ingest, and options contract
    # monitor on process boot — a self-healing backstop for a MID-SESSION
    # Railway restart (redeploy, platform restart, crash) that would otherwise
    # wipe these plain in-process globals to None with nothing to bring them
    # back (2026-07-09 / 2026-07-17 incidents — see each start function's own
    # docstring in monitoring_routes.py / social_routes.py).
    #
    # Gated on is_market_hours() (2026-08-04): this used to fire unconditionally
    # on every boot, including deploys pushed well outside trading hours — e.g.
    # a routine evening/pre-market push would still arm live monitoring, which
    # then ran for the ENTIRE next session until OrbService's own market_close
    # check stopped it around 4 PM, regardless of whether that was ever
    # intended. A boot outside market hours now skips the self-heal entirely
    # and leaves these off until the normal 9:20 AM cron (or a manual Admin
    # start) — a boot DURING market hours still self-heals exactly as before,
    # since recovering a live session mid-day is the actual point of this.
    if is_market_hours():
        try:
            from routes.monitoring_routes import start_orb_service as _start_orb
            _start_orb_result = _start_orb(notify=False)
            logger.info("[App] ORB hub auto-start at boot: %s", _start_orb_result.get("message"))
        except Exception as _orb_boot_err:
            logger.warning("[App] ORB hub auto-start at boot failed: %s", _orb_boot_err)

        try:
            from routes.social_routes import start_signal_ingest_core as _start_social_ingest
            _start_social_result, _ = _start_social_ingest()
            logger.info("[App] Social signal ingest auto-start at boot: %s", _start_social_result.get("message"))
        except Exception as _social_boot_err:
            logger.warning("[App] Social signal ingest auto-start at boot failed: %s", _social_boot_err)

        try:
            from routes.monitoring_routes import start_contracts_monitor_core as _start_contracts_monitor
            _start_contracts_result = _start_contracts_monitor()
            logger.info("[App] Options contract monitor auto-start at boot: %s", _start_contracts_result.get("message"))
        except Exception as _contracts_boot_err:
            logger.warning("[App] Options contract monitor auto-start at boot failed: %s", _contracts_boot_err)
    else:
        logger.info(
            "[App] Boot auto-start skipped for ORB hub / social ingest / options "
            "monitor — outside market hours (9:30 AM-4 PM ET, Mon-Fri). The 9:20 "
            "AM cron (or a manual Admin start) will bring them up normally."
        )

    # Key-level watcher: reload any levels still in 'watching' status and
    # re-subscribe to their tickers' bars. Cheap (one DB read + in-memory
    # callback registration, no network/streaming of its own) so this runs
    # unconditionally, not gated on is_market_hours() like the blocks above —
    # it just needs to be ready to receive bars whenever OrbService is
    # running, and outside market hours it simply sees none yet.
    try:
        from services.strategy.key_level_watcher import get_key_level_watcher
        get_key_level_watcher().start()
    except Exception as _key_level_boot_err:
        logger.warning("[App] Key level watcher start failed: %s", _key_level_boot_err)

    # Daily 9 AM ET heads-up (1 day / 2 days / this week) for any open position
    # approaching its own expiration — the replacement for the blanket EOD
    # auto-close now that it's scoped to 0DTE only (2026-07-17). A single
    # global job, not per-engine, since it scans every open orb_trades row.
    try:
        from services.strategy.scheduler import schedule_expiry_reminders as _schedule_expiry_reminders
        _schedule_expiry_reminders()
        logger.info("[App] Expiry reminder job scheduled at boot")
    except Exception as _expiry_boot_err:
        logger.warning("[App] Expiry reminder job scheduling failed: %s", _expiry_boot_err)

    @sock.route("/ws/strategy/<strategy_id>/live")
    def ws_strategy_live(ws, strategy_id: str):
        import queue as _queue
        engine = _strategy_engines.get(strategy_id)
        if not engine:
            from routes.strategy_routes import get_immediate_engine
            engine = get_immediate_engine(strategy_id)
        if not engine:
            return

        client_q = _queue.Queue(maxsize=50)
        with engine._live_clients_lock:
            engine._live_clients.append(client_q)

        try:
            while True:
                try:
                    msg = client_q.get(timeout=30)
                    ws.send(msg)
                except _queue.Empty:
                    ws.send(json.dumps({"type": "ping"}))
        except Exception as exc:
            logger.debug("[WS/strategy] client disconnected: %s", exc)
        finally:
            with engine._live_clients_lock:
                if client_q in engine._live_clients:
                    engine._live_clients.remove(client_q)

except Exception as _strategy_init_err:
    logger.warning("[App] ORB strategy engine init failed (non-fatal): %s", _strategy_init_err)


if __name__ == "__main__":
    app.run(debug=True)
