"""
Robinhood account routes — read-only account summary + holdings.

No order-placement endpoint exists here or anywhere in the Robinhood
integration, by design: this account is view-only from the app, never
traded through it.
"""

from flask import Blueprint, jsonify, request

from log.logging_config import get_logger
from services.robinhood.robinhood_service import (
    RobinhoodAuthError,
    get_account_summary,
    get_holdings,
    start_login,
    verify_code,
)

logger = get_logger(__name__)

bp = Blueprint("robinhood", __name__, url_prefix="/robinhood")


@bp.route("/account", methods=["GET"])
def get_account():
    try:
        return jsonify({"success": True, "data": get_account_summary()})
    except RobinhoodAuthError as e:
        return jsonify({
            "success": True,
            "data": {"available": False, "status": e.status, "message": e.message},
        })
    except Exception as e:
        logger.warning("[robinhood] account fetch failed: %s", e)
        return jsonify({
            "success": True,
            "data": {"available": False, "status": "error", "message": str(e)},
        })


@bp.route("/positions", methods=["GET"])
def get_positions():
    try:
        return jsonify({"success": True, "holdings": get_holdings()})
    except RobinhoodAuthError as e:
        return jsonify({
            "success": True, "holdings": [], "status": e.status, "message": e.message,
        })
    except Exception as e:
        logger.warning("[robinhood] holdings fetch failed: %s", e)
        return jsonify({
            "success": False, "holdings": [], "status": "error", "message": str(e),
        })


@bp.route("/login", methods=["POST"])
def login():
    """
    Explicit (re)trigger — "Sign In" / "Resend Code" in the app. Distinct
    from the automatic first attempt the GET routes make on their own: this
    is always a deliberate user tap, since it can send a fresh SMS.
    """
    try:
        start_login()
        return jsonify({"success": True, "status": "ok"})
    except RobinhoodAuthError as e:
        return jsonify({"success": True, "status": e.status, "message": e.message})
    except Exception as e:
        logger.warning("[robinhood] login failed: %s", e)
        return jsonify({"success": False, "status": "error", "message": str(e)})


@bp.route("/verify", methods=["POST"])
def verify():
    """Completes sign-in with the SMS code the user just received."""
    body = request.get_json(silent=True) or {}
    code = (body.get("code") or "").strip()
    if not code:
        return jsonify({"success": False, "status": "error", "message": "Code required"}), 400

    try:
        verify_code(code)
        return jsonify({"success": True, "status": "ok"})
    except RobinhoodAuthError as e:
        return jsonify({"success": True, "status": e.status, "message": e.message})
    except Exception as e:
        logger.warning("[robinhood] verify failed: %s", e)
        return jsonify({"success": False, "status": "error", "message": str(e)})
