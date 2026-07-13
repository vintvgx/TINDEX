import json

from flask import Flask, request
from flask_sock import Sock  # pylint: disable=import-error

from log.logging_config import get_logger

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


# ── Blueprints ─────────────────────────────────────────────────────────────────

from routes.ticker_routes import bp as ticker_bp
from routes.yahoo_routes import bp as yahoo_bp
from routes.monitoring_routes import bp as monitoring_bp
from routes.options_routes import bp as options_bp
from routes.portfolio_routes import bp as portfolio_bp
from routes.agent_routes import bp as agent_bp
from routes.flow_routes import bp as flow_bp
from routes.swing_routes import bp as swing_bp
from routes.zero_dte_routes import bp as zero_dte_bp
from routes.social_routes import bp as social_bp

app.register_blueprint(ticker_bp)
app.register_blueprint(yahoo_bp)
app.register_blueprint(monitoring_bp)
app.register_blueprint(options_bp)
app.register_blueprint(portfolio_bp)
app.register_blueprint(agent_bp)
app.register_blueprint(flow_bp)
app.register_blueprint(swing_bp)
app.register_blueprint(social_bp)
app.register_blueprint(zero_dte_bp)


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
        logger.info("[WS] client cleanup done")


# ── ORB Strategy Engine ────────────────────────────────────────────────────────

try:
    from services.strategy.orb_engine import ORBEngine, STRATEGY_DEFAULTS
    from services.strategy.trade_logger import TradeLogger as StrategyLogger
    from services.strategy.scheduler import init_scheduler as init_strategy_scheduler
    from services.strategy.option_stream import OptionStreamManager
    from routes.strategy_routes import strategy_bp, init_routes as init_strategy_routes

    _option_stream_manager = OptionStreamManager()

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

    # Schedule the 4:15 PM ET daily review at startup so it survives Railway restarts.
    # Previously this was only registered inside /tindex/orb/start — meaning a mid-day
    # server restart would silently drop the job and produce no review that day.
    try:
        from services.strategy.scheduler import schedule_daily_review as _sched_review
        from services.supabase.supabase_service import get_supabase_service as _get_sb
        _sched_review(_get_sb().client)
        logger.info("[App] Daily review job registered at startup")
    except Exception as _rev_err:
        logger.warning("[App] Daily review scheduler registration failed: %s", _rev_err)

    try:
        from services.strategy.scheduler import schedule_zero_dte_scans as _sched_zero_dte
        _sched_zero_dte(_get_sb().client)
        logger.info("[App] 0DTE scan jobs registered at startup")
    except Exception as _zdre:
        logger.warning("[App] 0DTE scan scheduler failed: %s", _zdre)

    # Auto-start the ORB data hub on every process boot — not a replacement for
    # the 9:20 AM daily cron that hits /tindex/orb/start, but a self-healing
    # backstop for it. ORB_SERVICE is a plain in-process global (monitoring_routes.py);
    # any mid-session Railway restart (redeploy, platform restart, crash) wipes it
    # to None with nothing to bring it back until the NEXT day's cron fires — the
    # strategy engines above rebuild themselves automatically on every boot and look
    # "armed" in the UI regardless, so a restart like this silently blinded every
    # strategy for the rest of the session with no visible symptom (2026-07-09 incident).
    # Calling this unconditionally is safe outside market hours too — OrbService.start()
    # already just enters a lightweight 60s-poll wait loop until the market opens.
    try:
        from routes.monitoring_routes import start_orb_service as _start_orb
        _start_orb_result = _start_orb(notify=False)
        logger.info("[App] ORB hub auto-start at boot: %s", _start_orb_result.get("message"))
    except Exception as _orb_boot_err:
        logger.warning("[App] ORB hub auto-start at boot failed: %s", _orb_boot_err)

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

    @sock.route("/ws/social-signals/live")
    def ws_social_signals_live(ws):
        """
        Live mid-price ticks for every currently-tracked social-signal
        contract (tracked_options_contracts, status='tracking', source=
        'social_signal') — one shared connection multiplexing all of them,
        not one WS per card. Reuses the same OptionStreamManager instance the
        ORB engines stream through — no second connection to Alpaca.

        Resync (picking up newly-tracked/entered/removed contracts) is a
        30s poll against tracked_options_contracts for the lifetime of this
        connection — simple and self-contained; see
        docs/features/social-signal-contracts.md §7's noted open question on
        push-based resync as a possible later optimization.
        """
        import queue as _queue
        import time as _time

        client_q: "_queue.Queue" = _queue.Queue(maxsize=100)
        subscribed: dict[str, "callable"] = {}  # contract_symbol -> callback
        stop_event = threading.Event()

        def _make_callback(symbol: str):
            def _cb(mid_price: float):
                try:
                    client_q.put_nowait(json.dumps({
                        "type": "price_update",
                        "contract_symbol": symbol,
                        "mid_price": round(mid_price, 4),
                    }))
                except _queue.Full:
                    pass
            return _cb

        def _resync_loop():
            # Dedicated client, NOT the shared get_supabase_service() singleton —
            # this loop runs every 30s for the entire lifetime of the WS
            # connection (which can be minutes/hours), and sharing the one
            # process-wide client with every HTTP route risked exactly the
            # kind of connection-pool contention that made GET /social-signals/
            # contracts hang indefinitely (2026-07 incident). Each background
            # loop in this codebase (SignalIngestService, OptionsContractMonitorService)
            # already follows this same "create your own client" convention —
            # this loop was the one exception, now fixed.
            import os as _os
            from supabase import create_client as _create_client
            _sb = _create_client(_os.getenv("SUPABASE_URL"), _os.getenv("SUPABASE_SERVICE_ROLE_KEY"))

            while not stop_event.is_set():
                t0 = _time.time()
                try:
                    rows = (
                        _sb.table("tracked_options_contracts")
                        .select("contract_symbol")
                        .eq("status", "tracking")
                        .eq("tracked_from_source", "social_signal")
                        .execute().data or []
                    )
                    live_symbols = {r["contract_symbol"] for r in rows}

                    for symbol in live_symbols - subscribed.keys():
                        cb = _make_callback(symbol)
                        subscribed[symbol] = cb
                        _option_stream_manager.subscribe(symbol, cb)

                    for symbol in list(subscribed.keys() - live_symbols):
                        _option_stream_manager.unsubscribe(symbol, subscribed.pop(symbol))

                    logger.info("[WS/social-signals] resync ok — %d tracked, %.2fs",
                                len(live_symbols), _time.time() - t0)
                except Exception as exc:
                    logger.warning("[WS/social-signals] resync error after %.2fs: %s",
                                   _time.time() - t0, exc)
                stop_event.wait(30)

        resync_thread = threading.Thread(target=_resync_loop, daemon=True)
        resync_thread.start()

        try:
            while True:
                try:
                    msg = client_q.get(timeout=30)
                    ws.send(msg)
                except _queue.Empty:
                    ws.send(json.dumps({"type": "ping"}))
        except Exception as exc:
            logger.debug("[WS/social-signals] client disconnected: %s", exc)
        finally:
            stop_event.set()
            for symbol, cb in subscribed.items():
                _option_stream_manager.unsubscribe(symbol, cb)

except Exception as _strategy_init_err:
    logger.warning("[App] ORB strategy engine init failed (non-fatal): %s", _strategy_init_err)


if __name__ == "__main__":
    app.run(debug=True)
