"""
Social signal contract routes — account follow/unfollow management, ingest
service start/stop/status, read endpoints for tweets/contracts, and a
self-tracked X API spend estimate (§ "X balance display" in
docs/features/social-signal-contracts.md — X has no public endpoint for the
actual $ credit balance, only the Developer Console shows that).

Deliberately NOT wired into monitoring_routes.py's SERVICE_REGISTRY or app.py's
boot sequence — start explicitly, not swept in by a generic "start everything"
call, until this has a track record (same reasoning as the removed v1 scraper).
"""

import asyncio
import functools
import os
import threading
import time
from datetime import datetime, timezone

from flask import Blueprint, jsonify, request

from log.logging_config import get_logger
from services.social.signal_ingest_service import (
    get_signal_ingest_service,
    reset_signal_ingest_service,
)
from services.social.x_client import XApiClient, XApiAuthError, COST_POSTS_READ, COST_USER_READ
from services.supabase.supabase_service import get_supabase_service

logger = get_logger(__name__)


def _logged_route(fn):
    """
    Logs entry (method, path, args) and exit (status/duration, or exception +
    duration) for every social-signals route. Added specifically so a hang
    (request received but response never sent — e.g. the 2026-07 incident
    where GET /social-signals/contracts hung indefinitely) is visible in
    Railway logs as "IN" with no matching "OUT", rather than being invisible.
    """
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        t0 = time.time()
        logger.info("[social-signals] IN  %s %s args=%s", request.method, request.path, kwargs or "")
        try:
            result = fn(*args, **kwargs)
            status = result[1] if isinstance(result, tuple) else 200
            logger.info("[social-signals] OUT %s %s status=%s %.3fs",
                        request.method, request.path, status, time.time() - t0)
            return result
        except Exception:
            logger.error("[social-signals] ERR %s %s after %.3fs",
                         request.method, request.path, time.time() - t0, exc_info=True)
            raise
    return wrapper


bp = Blueprint("social", __name__)

INGEST_SERVICE = None
INGEST_TASK = None
ingest_lock = threading.Lock()

# "Live since" for the admin status screen — same pattern as monitoring_
# routes.py's SERVICE_LIVE_SINCE, kept local since this service is
# deliberately not wired into that module's SERVICE_REGISTRY (see module
# docstring).
_INGEST_LIVE_SINCE: str | None = None


# ── Ingest service lifecycle ─────────────────────────────────────────────────

@bp.route("/social-signals/start", methods=["POST"])
@_logged_route
def start_signal_ingest():
    global INGEST_SERVICE, INGEST_TASK

    with ingest_lock:
        if INGEST_SERVICE and INGEST_SERVICE.is_running:
            return jsonify({"message": "Social signal ingest already running"})

    try:
        INGEST_SERVICE = get_signal_ingest_service()
    except ValueError as e:
        return jsonify({"success": False, "error": str(e)}), 500

    def run():
        if INGEST_SERVICE is not None:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            loop.run_until_complete(INGEST_SERVICE.start())

    INGEST_TASK = threading.Thread(target=run, daemon=True)
    INGEST_TASK.start()
    global _INGEST_LIVE_SINCE
    _INGEST_LIVE_SINCE = datetime.now(timezone.utc).isoformat()

    return jsonify({"success": True, "message": "Social signal ingest started"})


@bp.route("/social-signals/stop", methods=["POST"])
@_logged_route
def stop_signal_ingest():
    global INGEST_SERVICE, _INGEST_LIVE_SINCE
    with ingest_lock:
        if INGEST_SERVICE and INGEST_SERVICE.is_running:
            asyncio.run(INGEST_SERVICE.stop())
            reset_signal_ingest_service()
            INGEST_SERVICE = None
            _INGEST_LIVE_SINCE = None
            return jsonify({"success": True, "message": "Social signal ingest stopped"})
    return jsonify({"message": "Social signal ingest not running"})


@bp.route("/social-signals/status", methods=["GET"])
@_logged_route
def signal_ingest_status():
    with ingest_lock:
        running = bool(INGEST_SERVICE and getattr(INGEST_SERVICE, "is_running", False))
    try:
        sb = get_supabase_service().client
        accounts = (
            sb.table("social_signal_accounts")
            .select("id, handle, active, x_user_id, parse_keywords, last_seen_tweet_id, last_polled_at")
            .execute()
            .data or []
        )
        has_token = bool(os.getenv("X_API_BEARER_TOKEN"))
    except Exception as e:
        logger.error("[social-signals/status] %s", e)
        accounts, has_token = [], None
    return jsonify({
        "running": running,
        "live_since": _INGEST_LIVE_SINCE if running else None,
        "toggle": True,
        "has_bearer_token": has_token,
        "accounts": accounts,
    })


# ── Account follow management ────────────────────────────────────────────────

@bp.route("/social-signals/accounts", methods=["GET"])
@_logged_route
def list_accounts():
    try:
        sb = get_supabase_service().client
        rows = (
            sb.table("social_signal_accounts")
            .select("id, handle, label, active, parse_keywords, last_seen_tweet_id, last_polled_at, created_at")
            .order("created_at")
            .execute()
            .data or []
        )
        return jsonify({"success": True, "data": rows})
    except Exception as e:
        logger.error("[social-signals/accounts GET] %s", e, exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@bp.route("/social-signals/accounts", methods=["POST"])
@_logged_route
def follow_account():
    """
    Follow a new X account. Body: { "handle": "OptionsBuffett", "parse_keywords"?: [...] }
    Resolves the handle via X's User: Read lookup immediately so a typo'd or
    nonexistent handle fails fast with a clear error, rather than silently
    sitting in the DB never matching any tweets.
    """
    body = request.get_json(silent=True) or {}
    handle = (body.get("handle") or "").strip().lstrip("@")
    if not handle:
        return jsonify({"success": False, "error": "handle is required"}), 400
    parse_keywords = body.get("parse_keywords") or []

    try:
        sb = get_supabase_service().client
        client = XApiClient(sb)
        user_id = client.lookup_user_id(handle)
        if user_id is None:
            return jsonify({"success": False, "error": f"@{handle} not found on X"}), 404

        res = sb.table("social_signal_accounts").upsert({
            "handle": handle,
            "x_user_id": user_id,
            "active": True,
            "parse_keywords": parse_keywords,
        }, on_conflict="handle").execute()
        return jsonify({"success": True, "data": res.data[0] if res.data else None})
    except XApiAuthError as e:
        return jsonify({"success": False, "error": str(e)}), 502
    except Exception as e:
        logger.error("[social-signals/accounts POST] %s", e, exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@bp.route("/social-signals/accounts/<account_id>", methods=["PATCH"])
@_logged_route
def update_account(account_id: str):
    """Body: { "active"?: bool, "parse_keywords"?: [str, ...] }"""
    body = request.get_json(silent=True) or {}
    patch = {}
    if "active" in body:
        patch["active"] = bool(body["active"])
    if "parse_keywords" in body:
        patch["parse_keywords"] = body["parse_keywords"] or []
    if not patch:
        return jsonify({"success": False, "error": "nothing to update"}), 400

    try:
        sb = get_supabase_service().client
        res = sb.table("social_signal_accounts").update(patch).eq("id", account_id).execute()
        if not res.data:
            return jsonify({"success": False, "error": "account not found"}), 404
        return jsonify({"success": True, "data": res.data[0]})
    except Exception as e:
        logger.error("[social-signals/accounts PATCH] %s", e, exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@bp.route("/social-signals/accounts/<account_id>", methods=["DELETE"])
@_logged_route
def unfollow_account(account_id: str):
    try:
        sb = get_supabase_service().client
        sb.table("social_signal_accounts").delete().eq("id", account_id).execute()
        return jsonify({"success": True})
    except Exception as e:
        logger.error("[social-signals/accounts DELETE] %s", e, exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


# ── Read endpoints ───────────────────────────────────────────────────────────

@bp.route("/social-signals/tweets", methods=["GET"])
@_logged_route
def list_social_signal_tweets():
    limit = min(int(request.args.get("limit", 50)), 200)
    status_filter = request.args.get("status")
    try:
        sb = get_supabase_service().client
        q = (
            sb.table("social_signal_tweets")
            .select("*, social_signal_accounts(handle)")
            .order("created_at", desc=True)
            .limit(limit)
        )
        if status_filter:
            q = q.eq("parse_status", status_filter)
        rows = q.execute().data or []
        return jsonify({"success": True, "data": rows, "count": len(rows)})
    except Exception as e:
        logger.error("[social-signals/tweets] %s", e, exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@bp.route("/social-signals/contracts", methods=["GET"])
@_logged_route
def list_social_signal_contracts():
    """tracked_options_contracts rows sourced from social_signal — the
    Signal Cards list the app surfaces to the user."""
    try:
        sb = get_supabase_service().client
        rows = (
            sb.table("tracked_options_contracts")
            .select("*")
            .eq("tracked_from_source", "social_signal")
            .order("created_at", desc=True)
            .execute()
            .data or []
        )
        return jsonify({"success": True, "data": rows, "count": len(rows)})
    except Exception as e:
        logger.error("[social-signals/contracts] %s", e, exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@bp.route("/social-signals/contracts/<contract_id>", methods=["DELETE"])
@_logged_route
def remove_social_signal_contract(contract_id: str):
    """User removes a card — mirrors 'cancelled' rather than deleting the
    row outright, matching tracked_options_contracts' existing lifecycle."""
    try:
        sb = get_supabase_service().client
        res = sb.table("tracked_options_contracts").update(
            {"status": "cancelled"}
        ).eq("id", contract_id).eq("tracked_from_source", "social_signal").execute()
        if not res.data:
            return jsonify({"success": False, "error": "contract not found"}), 404
        return jsonify({"success": True})
    except Exception as e:
        logger.error("[social-signals/contracts DELETE] %s", e, exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


# ── X API spend estimate ─────────────────────────────────────────────────────

@bp.route("/social-signals/usage", methods=["GET"])
@_logged_route
def get_usage_estimate():
    """
    Self-tracked spend estimate — X has no public endpoint for the actual $
    credit balance (only the Developer Console shows that; see
    docs/features/social-signal-contracts.md). Since this service is the only
    thing spending against the bearer token, our own x_api_usage_log is a
    complete ledger: sum(quantity * unit_cost_usd) over today / this month.
    """
    from datetime import datetime, timezone

    try:
        sb = get_supabase_service().client
        now = datetime.now(timezone.utc)
        month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0).isoformat()

        month_rows = (
            sb.table("x_api_usage_log")
            .select("resource_type, quantity, unit_cost_usd, created_at")
            .gte("created_at", month_start)
            .execute()
            .data or []
        )

        def _sum(rows):
            return round(sum(r["quantity"] * float(r["unit_cost_usd"]) for r in rows), 4)

        today_rows = [r for r in month_rows if r["created_at"] >= today_start]

        return jsonify({
            "success": True,
            "data": {
                "estimated_spend_today_usd": _sum(today_rows),
                "estimated_spend_month_usd": _sum(month_rows),
                "posts_read_month": sum(r["quantity"] for r in month_rows if r["resource_type"] == "posts_read"),
                "user_read_month": sum(r["quantity"] for r in month_rows if r["resource_type"] == "user_read"),
                "unit_costs": {"posts_read": COST_POSTS_READ, "user_read": COST_USER_READ},
                "console_url": "https://console.x.com/",
                "note": "Estimated from this service's own request log — X has no public "
                        "endpoint for the actual credit balance. Check the link above for "
                        "the authoritative figure.",
            },
        })
    except Exception as e:
        logger.error("[social-signals/usage] %s", e, exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500
