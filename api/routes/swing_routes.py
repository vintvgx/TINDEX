"""
Swing Trade [Beta] API routes.

All endpoints use no url_prefix — paths are exactly as defined in spec §7.
Pipeline runs use the service-role Supabase client. User-owned tables (watchlist,
positions) are accessed with the service-role client but scoped to the caller id
resolved from a verified Supabase access token.
"""

import asyncio
from datetime import date, datetime

from flask import Blueprint, jsonify, request

from log.logging_config import get_logger
from services.supabase.supabase_service import get_supabase_service
from services.swing.swing_service import SwingPipeline
from services.swing.swing_exit_manager import SWING_PROFILES

logger = get_logger(__name__)

bp = Blueprint("swing", __name__)


def _sb():
    return get_supabase_service().client


def _run_async(coro):
    loop = asyncio.new_event_loop()
    try:
        asyncio.set_event_loop(loop)
        return loop.run_until_complete(coro)
    finally:
        loop.close()


def _require_authenticated_user_id():
    """Return (user_id, error_response). error_response is a Flask tuple when auth fails."""
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return None, (jsonify({"success": False, "error": "Authorization required"}), 401)

    token = auth_header.removeprefix("Bearer ").strip()
    if not token:
        return None, (jsonify({"success": False, "error": "Authorization required"}), 401)

    try:
        user_id = get_supabase_service().resolve_authenticated_user_id(token)
        return user_id, None
    except ValueError as e:
        logger.warning("[swing/auth] token validation failed: %s", e)
        return None, (jsonify({"success": False, "error": str(e)}), 401)
    except Exception as e:
        logger.error("[swing/auth] unexpected auth failure: %s", e, exc_info=True)
        return None, (jsonify({"success": False, "error": "Authentication failed"}), 401)


# ── Pipeline ──────────────────────────────────────────────────────────────────

@bp.route("/swing/pipeline/run", methods=["POST"])
def run_pipeline():
    """Trigger a full funnel run. Also wired to cron."""
    body = request.get_json(silent=True) or {}
    scan_date_str = body.get("scan_date")
    limit = min(int(body.get("limit", 20)), 20)

    scan_date = None
    if scan_date_str:
        try:
            scan_date = date.fromisoformat(scan_date_str)
        except ValueError:
            return jsonify({"success": False, "error": "Invalid scan_date format. Use YYYY-MM-DD"}), 400

    try:
        pipeline = SwingPipeline(supabase_client=_sb())
        result = pipeline.run_pipeline(scan_date=scan_date, limit=limit)
        return jsonify(result), 200 if result["success"] else 503
    except Exception as e:
        logger.error("[swing/pipeline/run] %s", e, exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@bp.route("/swing/pipeline/stage/<int:stage_n>", methods=["POST"])
def run_pipeline_stage(stage_n: int):
    """Run a single pipeline stage (debug / backfill). Stages 1-4 all run the full pipeline."""
    if stage_n not in (1, 2, 3, 4):
        return jsonify({"success": False, "error": "stage must be 1, 2, 3, or 4"}), 400
    body = request.get_json(silent=True) or {}
    scan_date_str = body.get("scan_date")
    scan_date = None
    if scan_date_str:
        try:
            scan_date = date.fromisoformat(scan_date_str)
        except ValueError:
            return jsonify({"success": False, "error": "Invalid scan_date format"}), 400
    try:
        pipeline = SwingPipeline(supabase_client=_sb())
        result = pipeline.run_pipeline(scan_date=scan_date, limit=20)
        result["stage_requested"] = stage_n
        return jsonify(result), 200 if result["success"] else 503
    except Exception as e:
        logger.error("[swing/pipeline/stage/%d] %s", stage_n, e, exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


# ── Scores (dashboard source) ─────────────────────────────────────────────────

@bp.route("/swing/scores", methods=["GET"])
def get_swing_scores():
    """Return scored opportunities for a given scan date (default: today)."""
    scan_date_str = request.args.get("scan_date") or str(date.today())
    tier_filter = request.args.get("tier")         # 'Prime' | 'Strong' | 'Watch'
    side_filter = request.args.get("side")          # 'call' | 'put'
    limit = min(int(request.args.get("limit", 20)), 20)

    try:
        query = _sb().table("swing_scores").select("*").eq("scan_date", scan_date_str)
        if tier_filter:
            query = query.eq("tier", tier_filter)
        if side_filter:
            query = query.eq("side", side_filter.lower())
        query = query.order("composite_score", desc=True).limit(limit)
        rows = query.execute().data or []
        return jsonify({"success": True, "data": rows, "scan_date": scan_date_str, "count": len(rows)})
    except Exception as e:
        logger.error("[swing/scores] %s", e, exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


# ── Config ────────────────────────────────────────────────────────────────────

@bp.route("/swing/config", methods=["GET"])
def get_swing_config():
    """Return available strategy profiles and stage config."""
    return jsonify({"success": True, "profiles": SWING_PROFILES})


# ── Watchlist ─────────────────────────────────────────────────────────────────

@bp.route("/swing/watchlist", methods=["GET"])
def get_swing_watchlist():
    user_id, auth_error = _require_authenticated_user_id()
    if auth_error:
        return auth_error
    try:
        rows = _sb().table("swing_watchlist").select("*").eq("user_id", user_id).order("added_at", desc=True).execute().data or []
        return jsonify({"success": True, "data": rows})
    except Exception as e:
        logger.error("[swing/watchlist GET] %s", e, exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@bp.route("/swing/watchlist", methods=["POST"])
def add_swing_watchlist():
    user_id, auth_error = _require_authenticated_user_id()
    if auth_error:
        return auth_error
    body = request.get_json(silent=True) or {}
    contract_symbol = body.get("contract_symbol")
    if not contract_symbol:
        return jsonify({"success": False, "error": "contract_symbol required"}), 400
    try:
        row = _sb().table("swing_watchlist").upsert({
            "user_id": user_id,
            "contract_symbol": contract_symbol,
            "ticker": body.get("ticker"),
            "note": body.get("note"),
        }, on_conflict="user_id,contract_symbol").execute().data
        return jsonify({"success": True, "data": row[0] if row else None})
    except Exception as e:
        logger.error("[swing/watchlist POST] %s", e, exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@bp.route("/swing/watchlist/<watchlist_id>", methods=["DELETE"])
def remove_swing_watchlist(watchlist_id: str):
    user_id, auth_error = _require_authenticated_user_id()
    if auth_error:
        return auth_error
    try:
        _sb().table("swing_watchlist").delete().eq("id", watchlist_id).eq("user_id", user_id).execute()
        return jsonify({"success": True})
    except Exception as e:
        logger.error("[swing/watchlist DELETE] %s", e, exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


# ── Positions ─────────────────────────────────────────────────────────────────

@bp.route("/swing/positions", methods=["GET"])
def get_swing_positions():
    user_id, auth_error = _require_authenticated_user_id()
    if auth_error:
        return auth_error
    status_filter = request.args.get("status", "open")
    try:
        query = _sb().table("swing_positions").select("*").eq("user_id", user_id)
        if status_filter != "all":
            query = query.eq("status", status_filter)
        rows = query.order("entry_at", desc=True).execute().data or []
        return jsonify({"success": True, "data": rows})
    except Exception as e:
        logger.error("[swing/positions GET] %s", e, exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@bp.route("/swing/positions/enter", methods=["POST"])
def enter_swing_position():
    """
    Open a paper or live position.
    Body: { contract_symbol, ticker, qty, entry_price, mode, strategy_profile, side }
    For live mode: routes order via Alpaca.
    """
    user_id, auth_error = _require_authenticated_user_id()
    if auth_error:
        return auth_error
    body = request.get_json(silent=True) or {}
    required = ["contract_symbol", "ticker", "qty", "entry_price", "strategy_profile"]
    for field in required:
        if not body.get(field):
            return jsonify({"success": False, "error": f"{field} is required"}), 400

    contract_symbol = body["contract_symbol"]
    qty = int(body["qty"])
    entry_price = float(body["entry_price"])
    mode = body.get("mode", "paper")
    strategy_profile = body["strategy_profile"]
    side = body.get("side", "")

    if strategy_profile not in SWING_PROFILES:
        return jsonify({"success": False, "error": f"Unknown profile. Valid: {list(SWING_PROFILES)}"}), 400
    if mode not in ("paper", "live"):
        return jsonify({"success": False, "error": "mode must be 'paper' or 'live'"}), 400

    profile = SWING_PROFILES[strategy_profile]
    tp_ladder = [
        {"level": "TP1", "pct": profile["tp1_pct"], "qty_pct": profile["tp1_qty_pct"], "hit": False},
    ]
    if profile.get("tp2_pct"):
        tp_ladder.append({"level": "TP2", "pct": profile["tp2_pct"], "qty_pct": profile.get("tp2_qty_pct", 0), "hit": False})

    stop_config = {
        "type": profile["stop_type"],
        "atr_mult": profile.get("stop_atr_mult"),
        "fixed_pct": profile.get("stop_fixed_pct"),
        "max_loss_pct": profile["max_loss_pct"],
        "ratchet_be": profile["ratchet_be"],
        "time_stop_dte": profile["time_stop_dte"],
        "entry_price": entry_price,
        "be_ratcheted": False,
        "effective_stop": None,
    }

    # 1. Persist a pending record BEFORE touching the broker so every Alpaca
    #    order has a corresponding local row, even if the confirm step fails.
    try:
        pending = _sb().table("swing_positions").insert({
            "user_id": user_id,
            "mode": mode,
            "contract_symbol": contract_symbol,
            "ticker": body.get("ticker"),
            "side": side,
            "qty": qty,
            "entry_price": entry_price,
            "entry_at": datetime.utcnow().isoformat(),
            "realized_pnl": 0.0,
            "strategy_profile": strategy_profile,
            "stop_config": stop_config,
            "tp_ladder": tp_ladder,
            "status": "pending",
            "broker_order_ids": None,
        }).execute().data
        position_id = pending[0]["id"]
    except Exception as e:
        logger.error("[swing/positions/enter] Supabase pre-insert failed: %s", e, exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500

    # 2. Place broker order (live only). On failure, mark the pending row so it
    #    is visible and reconcilable — no silent orphan at the broker.
    broker_order_ids = None
    if mode == "live":
        try:
            from services.alpaca.alpaca_option_service import get_alpaca_option_service
            order = _run_async(get_alpaca_option_service().place_option_order(
                symbol=contract_symbol,
                qty=qty,
                side="buy",
                order_type="market",
                paper=False,
            ))
            broker_order_ids = {"alpaca_order_id": order.get("id")} if order else None
        except Exception as e:
            logger.error("[swing/positions/enter] Alpaca order failed: %s", e, exc_info=True)
            try:
                _sb().table("swing_positions").update({"status": "failed"}).eq("id", position_id).execute()
            except Exception:
                pass  # best-effort; pending row still exists and is detectable
            return jsonify({"success": False, "error": f"Live order failed: {str(e)}"}), 500

    # 3. Confirm the record as open now that broker execution succeeded (or paper).
    try:
        row = _sb().table("swing_positions").update({
            "status": "open",
            "broker_order_ids": broker_order_ids,
        }).eq("id", position_id).execute().data
        return jsonify({"success": True, "data": row[0] if row else None})
    except Exception as e:
        # Broker order placed but confirm failed — row stays "pending" (detectable,
        # not a silent orphan). Log with position_id for manual reconciliation.
        logger.error("[swing/positions/enter] Supabase confirm failed pos=%s: %s", position_id, e, exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@bp.route("/swing/positions/<position_id>/exit", methods=["POST"])
def exit_swing_position(position_id: str):
    """
    Manual exit or partial close.
    Body: { qty?, exit_price?, reason? }
    """
    user_id, auth_error = _require_authenticated_user_id()
    if auth_error:
        return auth_error
    body = request.get_json(silent=True) or {}

    try:
        pos_rows = _sb().table("swing_positions").select("*").eq("id", position_id).eq("user_id", user_id).execute().data or []
        if not pos_rows:
            return jsonify({"success": False, "error": "Position not found"}), 404
        pos = pos_rows[0]
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

    qty_to_close = int(body.get("qty") or pos["qty"])
    exit_price = float(body.get("exit_price") or 0)
    entry_price = float(pos.get("entry_price") or 0)
    pnl = (exit_price - entry_price) * qty_to_close * 100 if exit_price and entry_price else None

    # Live close via Alpaca — broker result is authoritative; do not update local state on failure.
    if pos.get("mode") == "live":
        try:
            from services.alpaca.alpaca_option_service import get_alpaca_option_service
            _run_async(get_alpaca_option_service().close_option_position(
                symbol=pos["contract_symbol"],
                qty=qty_to_close,
                paper=False,
            ))
        except Exception as e:
            logger.error("[swing/positions/exit] Alpaca close failed: %s", e, exc_info=True)
            return jsonify({"success": False, "error": f"Live close failed: {str(e)}"}), 500

    new_qty = (pos.get("qty") or 0) - qty_to_close
    new_status = "closed" if new_qty <= 0 else "partially_closed"
    realized = float(pos.get("realized_pnl") or 0) + (pnl or 0)

    try:
        _sb().table("swing_positions").update({
            "status": new_status,
            "realized_pnl": realized,
            "closed_at": datetime.utcnow().isoformat() if new_status == "closed" else None,
        }).eq("id", position_id).execute()

        _sb().table("swing_trade_logs").insert({
            "position_id": position_id,
            "user_id": user_id,
            "event_type": "MANUAL",
            "qty_closed": qty_to_close,
            "price": exit_price or None,
            "pnl": pnl,
            "reason": body.get("reason", "Manual exit"),
        }).execute()

        return jsonify({"success": True, "status": new_status, "realized_pnl": realized, "qty_closed": qty_to_close})
    except Exception as e:
        logger.error("[swing/positions/exit] %s", e, exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


# ── Update exits (SL / TP) ───────────────────────────────────────────────────

@bp.route("/swing/positions/<position_id>/exits", methods=["PATCH"])
def update_swing_exits(position_id: str):
    """
    Update stop-loss and/or TP levels for a swing position.
    Body: { hard_stop?, tp1_pct?, tp2_pct? }
      - hard_stop: absolute premium price (e.g. 0.18)
      - tp1_pct:   TP1 as % gain on entry (e.g. 0.15 = +15%)
      - tp2_pct:   TP2 as % gain on entry (e.g. 0.30 = +30%), optional
    These are persisted to stop_config / tp_ladder so the exit manager
    reads the new values on the next evaluation cycle.
    """
    user_id, auth_error = _require_authenticated_user_id()
    if auth_error:
        return auth_error
    body = request.get_json(silent=True) or {}

    try:
        rows = _sb().table("swing_positions").select("*").eq("id", position_id).eq("user_id", user_id).execute().data or []
        if not rows:
            return jsonify({"success": False, "error": "Position not found"}), 404
        pos = rows[0]
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

    if pos.get("status") not in ("open", "partially_closed"):
        return jsonify({"success": False, "error": "Position is already closed"}), 409

    entry_price = float(pos.get("entry_price") or 0)
    stop_config = dict(pos.get("stop_config") or {})
    tp_ladder = list(pos.get("tp_ladder") or [])
    changed = {}

    if "hard_stop" in body:
        val = float(body["hard_stop"])
        if val <= 0:
            return jsonify({"success": False, "error": "hard_stop must be > 0"}), 400
        stop_config["effective_stop"] = round(val, 4)
        stop_config["override_hard_stop"] = round(val, 4)
        changed["hard_stop"] = round(val, 4)

    if "tp1_pct" in body and entry_price:
        pct = float(body["tp1_pct"])
        new_tp1 = round(entry_price * (1 + pct), 4)
        for rung in tp_ladder:
            if rung.get("level") == "TP1":
                rung["pct"] = pct
                rung["price"] = new_tp1
        changed["tp1_pct"] = pct
        changed["tp1_price"] = new_tp1

    if "tp2_pct" in body and entry_price:
        pct = float(body["tp2_pct"])
        new_tp2 = round(entry_price * (1 + pct), 4)
        tp2_rung = next((r for r in tp_ladder if r.get("level") == "TP2"), None)
        if tp2_rung:
            tp2_rung["pct"] = pct
            tp2_rung["price"] = new_tp2
        else:
            tp_ladder.append({"level": "TP2", "pct": pct, "price": new_tp2, "hit": False})
        changed["tp2_pct"] = pct
        changed["tp2_price"] = new_tp2

    if not changed:
        return jsonify({"success": False, "error": "No valid fields provided"}), 400

    try:
        _sb().table("swing_positions").update({
            "stop_config": stop_config,
            "tp_ladder": tp_ladder,
        }).eq("id", position_id).execute()
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

    logger.info("[swing/exits] Updated position %s: %s", position_id, changed)
    return jsonify({"success": True, "updated": changed, "stop_config": stop_config, "tp_ladder": tp_ladder})


# ── Contract live quote ───────────────────────────────────────────────────────

@bp.route("/swing/contract/<symbol>/quote", methods=["GET"])
def get_swing_contract_quote(symbol: str):
    """On-demand live quote / Greeks for a contract symbol."""
    try:
        from services.alpaca.alpaca_option_service import get_alpaca_option_service
        result = _run_async(get_alpaca_option_service().get_contract_snapshot(symbol.upper()))
        if not result:
            return jsonify({"success": False, "error": "No quote data available for this contract"}), 404
        return jsonify({"success": True, "data": result})
    except Exception as e:
        logger.error("[swing/contract/quote] %s: %s", symbol, e, exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


# ── Run logs ──────────────────────────────────────────────────────────────────

@bp.route("/swing/run-logs", methods=["GET"])
def get_swing_run_logs():
    limit = min(int(request.args.get("limit", 30)), 100)
    try:
        rows = _sb().table("swing_run_logs").select("*").order("run_at", desc=True).limit(limit).execute().data or []
        return jsonify({"success": True, "data": rows})
    except Exception as e:
        logger.error("[swing/run-logs] %s", e, exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500
