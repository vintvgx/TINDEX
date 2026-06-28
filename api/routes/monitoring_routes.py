"""
ORB monitoring, options contract monitor, and unified service management routes.

Global service singletons (ORB_SERVICE, OPTIONS_MONITOR_SERVICE) live here so
they are never duplicated across the process.
"""

import asyncio
import threading

from flask import Blueprint, jsonify, request

from log.logging_config import get_logger
from services.tindex.orb_service import OrbService
from services.alpaca.alpaca_streaming_service import AlpacaStreamingService
from services.tradier.tradier_streaming_service import TradierStreamingService
from services.alpaca.options_contract_monitor import (
    get_options_contract_monitor,
    reset_options_contract_monitor,
)
from services.supabase.supabase_service import get_supabase_service

logger = get_logger(__name__)

bp = Blueprint("monitoring", __name__)

# ── Global service state ──────────────────────────────────────────────────────

ORB_SERVICE = None
ORB_TASK = None

OPTIONS_MONITOR_SERVICE = None
OPTIONS_MONITOR_TASK = None

orb_lock = threading.Lock()
options_monitor_lock = threading.Lock()


# ── Service factory ──────────────────────────────────────────────────────────

def get_orb_service(provider: str = "alpaca") -> OrbService:
    streaming = TradierStreamingService() if provider.lower() == "tradier" else AlpacaStreamingService()
    return OrbService(streaming)


# ── ORB routes ────────────────────────────────────────────────────────────────

@bp.route("/tindex/orb/start", methods=["POST"])
def start_orb_monitoring():
    global ORB_SERVICE, ORB_TASK
    try:
        debug_mode = request.args.get("debug", "").lower() == "true"
        provider = request.args.get("provider", "alpaca").lower()
        try:
            body = request.get_json(silent=True) or {}
            debug_mode = debug_mode or bool(body.get("debug", False))
            provider = body.get("provider", provider).lower()
        except Exception as e:
            logger.error("Failed to retrieve request data: %s", e)

        with orb_lock:
            if ORB_SERVICE and ORB_SERVICE.is_running:
                return jsonify({"message": "ORB service already running"})

        ORB_SERVICE = get_orb_service(provider=provider)

        def run_orb():
            if ORB_SERVICE is not None:
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                loop.run_until_complete(ORB_SERVICE.start(debug_mode=debug_mode))

        ORB_TASK = threading.Thread(target=run_orb, daemon=True)
        ORB_TASK.start()

        # Ensure strategy engines and review scheduler are live
        try:
            from services.strategy.scheduler import init_scheduler as _init_sched, schedule_daily_review as _sched_review
            from routes.strategy_routes import _engines
            for _eng in _engines.values():
                _init_sched(_eng)
            if _engines:
                next(iter(_engines.values())).notifier.notify_start(provider)
            _sched_review(get_supabase_service().client)
        except Exception as _e:
            logger.warning("[ORB Start] Engine check failed: %s", _e)

        message = "ORB Service + Engine started"
        if debug_mode:
            message += " (DEBUG MODE: Market hours check bypassed)"
        return jsonify({"success": True, "message": message, "debug_mode": debug_mode, "provider": provider})

    except Exception as e:
        logger.error("Failed to start ORB monitoring: %s", e)
        return jsonify({"error": str(e)}), 500


@bp.route("/tindex/orb/stop", methods=["POST"])
def stop_orb_monitoring():
    global ORB_SERVICE
    try:
        with orb_lock:
            if ORB_SERVICE and ORB_SERVICE.is_running:
                asyncio.run(ORB_SERVICE.stop())
                ORB_SERVICE = None
                return jsonify({"success": True, "message": "ORB monitoring stopped"})
        return jsonify({"message": "ORB service not running"})
    except Exception as e:
        logger.error("Failed to stop ORB monitoring: %s", e)
        return jsonify({"error": str(e)}), 500


@bp.route("/tindex/orb/status", methods=["GET"])
def get_orb_status():
    with orb_lock:
        if ORB_SERVICE and hasattr(ORB_SERVICE, "is_running") and ORB_SERVICE.is_running:
            return jsonify({
                "running": True,
                "calculation_phase": getattr(ORB_SERVICE, "calculation_phase", False),
                "active_tickers": list(getattr(ORB_SERVICE, "active_tickers", set())),
                "orb_ranges_count": len(getattr(ORB_SERVICE, "orb_ranges", {})),
            })
    return jsonify({"running": False})


# ── Options contract monitor routes ──────────────────────────────────────────

@bp.route("/contracts/monitor/start", methods=["POST"])
def start_contracts_monitor():
    global OPTIONS_MONITOR_SERVICE, OPTIONS_MONITOR_TASK

    debug_mode = request.args.get("debug", "").lower() == "true"
    try:
        body = request.get_json(silent=True) or {}
        debug_mode = debug_mode or bool(body.get("debug", False))
    except Exception:
        pass

    with options_monitor_lock:
        if OPTIONS_MONITOR_SERVICE and OPTIONS_MONITOR_SERVICE.is_running:
            return jsonify({"message": "Options contract monitor already running"})

    OPTIONS_MONITOR_SERVICE = get_options_contract_monitor()
    if debug_mode:
        OPTIONS_MONITOR_SERVICE._is_market_hours = lambda: True

    def run_monitor():
        if OPTIONS_MONITOR_SERVICE is not None:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            loop.run_until_complete(OPTIONS_MONITOR_SERVICE.start())

    OPTIONS_MONITOR_TASK = threading.Thread(target=run_monitor, daemon=True)
    OPTIONS_MONITOR_TASK.start()

    message = "Options contract monitor started"
    if debug_mode:
        message += " (DEBUG MODE: market hours check bypassed)"
    return jsonify({"success": True, "message": message, "debug_mode": debug_mode})


@bp.route("/contracts/monitor/stop", methods=["POST"])
def stop_contracts_monitor():
    global OPTIONS_MONITOR_SERVICE
    with options_monitor_lock:
        if OPTIONS_MONITOR_SERVICE and OPTIONS_MONITOR_SERVICE.is_running:
            asyncio.run(OPTIONS_MONITOR_SERVICE.stop())
            reset_options_contract_monitor()
            OPTIONS_MONITOR_SERVICE = None
            return jsonify({"success": True, "message": "Options contract monitor stopped"})
    return jsonify({"message": "Options contract monitor not running"})


@bp.route("/contracts/monitor/status", methods=["GET"])
def get_contracts_monitor_status():
    with options_monitor_lock:
        if OPTIONS_MONITOR_SERVICE and hasattr(OPTIONS_MONITOR_SERVICE, "is_running") and OPTIONS_MONITOR_SERVICE.is_running:
            return jsonify({"running": True, "poll_interval_seconds": 300, "market_hours_only": True})
    return jsonify({"running": False})


# ── Unified service management ─────────────────────────────────────────────────

def _svc_start_orb(debug: bool = False, provider: str = "alpaca", **_) -> dict:
    global ORB_SERVICE, ORB_TASK
    with orb_lock:
        if ORB_SERVICE and ORB_SERVICE.is_running:
            return {"success": True, "message": "ORB already running", "was_running": True}
    svc = get_orb_service(provider=provider)
    ORB_SERVICE = svc

    def _run():
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        loop.run_until_complete(svc.start(debug_mode=debug))

    ORB_TASK = threading.Thread(target=_run, daemon=True)
    ORB_TASK.start()

    try:
        from services.strategy.scheduler import init_scheduler as _init_sched
        from routes.strategy_routes import _engines
        for _eng in _engines.values():
            _init_sched(_eng)
        if _engines:
            next(iter(_engines.values())).notifier.notify_start(provider)
    except Exception as _e:
        logger.warning("[ORB Start] Engine check failed: %s", _e)

    msg = "ORB Service + Engine started"
    if debug:
        msg += " [debug]"
    return {"success": True, "message": msg, "was_running": False}


def _svc_stop_orb(**_) -> dict:
    global ORB_SERVICE
    with orb_lock:
        if ORB_SERVICE and ORB_SERVICE.is_running:
            asyncio.run(ORB_SERVICE.stop())
            ORB_SERVICE = None
            return {"success": True, "message": "ORB monitoring stopped"}
    return {"success": True, "message": "ORB not running"}


def _svc_status_orb() -> dict:
    with orb_lock:
        if ORB_SERVICE and getattr(ORB_SERVICE, "is_running", False):
            return {
                "running": True,
                "calculation_phase": getattr(ORB_SERVICE, "calculation_phase", False),
                "active_tickers": list(getattr(ORB_SERVICE, "active_tickers", set())),
                "orb_ranges_count": len(getattr(ORB_SERVICE, "orb_ranges", {})),
            }
    return {"running": False}


def _svc_start_contracts(debug: bool = False, **_) -> dict:
    global OPTIONS_MONITOR_SERVICE, OPTIONS_MONITOR_TASK
    with options_monitor_lock:
        if OPTIONS_MONITOR_SERVICE and OPTIONS_MONITOR_SERVICE.is_running:
            return {"success": True, "message": "Contracts monitor already running", "was_running": True}
    svc = get_options_contract_monitor()
    OPTIONS_MONITOR_SERVICE = svc
    if debug:
        svc._is_market_hours = lambda: True

    def _run():
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        loop.run_until_complete(svc.start())

    OPTIONS_MONITOR_TASK = threading.Thread(target=_run, daemon=True)
    OPTIONS_MONITOR_TASK.start()
    msg = "Contracts monitor started"
    if debug:
        msg += " [debug]"
    return {"success": True, "message": msg, "was_running": False}


def _svc_stop_contracts(**_) -> dict:
    global OPTIONS_MONITOR_SERVICE
    with options_monitor_lock:
        if OPTIONS_MONITOR_SERVICE and OPTIONS_MONITOR_SERVICE.is_running:
            asyncio.run(OPTIONS_MONITOR_SERVICE.stop())
            reset_options_contract_monitor()
            OPTIONS_MONITOR_SERVICE = None
            return {"success": True, "message": "Contracts monitor stopped"}
    return {"success": True, "message": "Contracts monitor not running"}


def _svc_status_contracts() -> dict:
    with options_monitor_lock:
        if OPTIONS_MONITOR_SERVICE and getattr(OPTIONS_MONITOR_SERVICE, "is_running", False):
            return {"running": True, "poll_interval_seconds": 300, "market_hours_only": True}
    return {"running": False}


SERVICE_REGISTRY: dict = {
    "orb": (_svc_start_orb, _svc_stop_orb, _svc_status_orb),
    "contracts": (_svc_start_contracts, _svc_stop_contracts, _svc_status_contracts),
}


@bp.route("/services/start", methods=["POST"])
def start_services():
    body = request.get_json(silent=True) or {}
    debug = bool(body.get("debug", False)) or (request.args.get("debug", "").lower() == "true")
    provider = body.get("provider", body.get("orb_provider", "alpaca")).lower()
    requested = body.get("services", list(SERVICE_REGISTRY.keys()))

    logger.info("[services/start] triggered_by=%s services=%s debug=%s", body.get("triggered_by", "api"), requested, debug)

    results: dict = {}
    errors: list = []
    for name in requested:
        if name not in SERVICE_REGISTRY:
            results[name] = {"success": False, "message": f"Unknown service '{name}'"}
            errors.append(name)
            continue
        start_fn, _, _ = SERVICE_REGISTRY[name]
        try:
            results[name] = start_fn(debug=debug, provider=provider)
        except Exception as exc:
            logger.error("[services/start] %s failed: %s", name, exc, exc_info=True)
            results[name] = {"success": False, "message": str(exc)}
            errors.append(name)

    return jsonify({"success": not errors, "results": results, "errors": errors}), (207 if errors else 200)


@bp.route("/services/stop", methods=["POST"])
def stop_services():
    body = request.get_json(silent=True) or {}
    requested = body.get("services", list(SERVICE_REGISTRY.keys()))

    logger.info("[services/stop] triggered_by=%s services=%s", body.get("triggered_by", "api"), requested)

    results: dict = {}
    errors: list = []
    for name in requested:
        if name not in SERVICE_REGISTRY:
            results[name] = {"success": False, "message": f"Unknown service '{name}'"}
            errors.append(name)
            continue
        _, stop_fn, _ = SERVICE_REGISTRY[name]
        try:
            results[name] = stop_fn()
        except Exception as exc:
            logger.error("[services/stop] %s failed: %s", name, exc, exc_info=True)
            results[name] = {"success": False, "message": str(exc)}
            errors.append(name)

    return jsonify({"success": not errors, "results": results, "errors": errors}), (207 if errors else 200)


@bp.route("/services/status", methods=["GET"])
def get_services_status():
    status: dict = {}
    for name, (_, _, status_fn) in SERVICE_REGISTRY.items():
        try:
            status[name] = status_fn()
        except Exception as exc:
            logger.error("[services/status] %s error: %s", name, exc)
            status[name] = {"running": False, "error": str(exc)}
    return jsonify(status)
