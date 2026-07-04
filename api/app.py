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

app.register_blueprint(ticker_bp)
app.register_blueprint(yahoo_bp)
app.register_blueprint(monitoring_bp)
app.register_blueprint(options_bp)
app.register_blueprint(portfolio_bp)
app.register_blueprint(agent_bp)
app.register_blueprint(flow_bp)
app.register_blueprint(swing_bp)
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
