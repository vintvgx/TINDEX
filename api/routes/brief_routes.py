"""
Morning brief routes (TODO 8 part 1) — see services/brief/brief_service.py.

  POST  /brief/generate              {phase: build|rescore|lock} — pg_cron at
                                     9:00 / 9:10 / 9:20 / 9:28 ET; runs in the
                                     background and returns 202 immediately
  GET   /brief/today                 today's brief (plays, modes, statuses)
  PATCH /brief/plays/<ticker>        {mode: confirm|auto}
  POST  /brief/plays/<ticker>/confirm   approve a triggered confirm-first play
  POST  /brief/plays/<ticker>/skip      skip a play
"""

import threading

from flask import Blueprint, jsonify, request

from log.logging_config import get_logger
from services.brief.brief_service import get_brief_service

logger = get_logger(__name__)
bp = Blueprint("brief", __name__)


@bp.route("/brief/generate", methods=["POST"])
def generate():
    phase = ((request.get_json(silent=True) or {}).get("phase") or request.args.get("phase") or "build").lower()
    if phase not in ("build", "rescore", "lock"):
        return jsonify({"success": False, "error": "phase must be build, rescore or lock"}), 400

    def _run():
        try:
            brief = get_brief_service().generate(phase)
            logger.info("[brief] %s done — %d play(s)", phase, len(brief.get("plays", [])))
        except Exception as e:
            logger.error("[brief] %s failed: %s", phase, e, exc_info=True)
    threading.Thread(target=_run, daemon=True, name=f"brief-{phase}").start()
    return jsonify({"success": True, "phase": phase, "status": "started"}), 202


@bp.route("/brief/today", methods=["GET"])
def today():
    brief = get_brief_service().today_view()
    return jsonify({"success": True, "data": brief})


def _action(fn, *args):
    try:
        return jsonify({"success": True, "data": fn(*args)})
    except ValueError as e:
        return jsonify({"success": False, "error": str(e)}), 409
    except Exception as e:
        logger.error("[brief] action failed: %s", e, exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@bp.route("/brief/plays/<ticker>", methods=["PATCH"])
def set_mode(ticker):
    mode = ((request.get_json(silent=True) or {}).get("mode") or "").lower()
    return _action(get_brief_service().set_mode, ticker, mode)


@bp.route("/brief/plays/<ticker>/confirm", methods=["POST"])
def confirm(ticker):
    return _action(get_brief_service().confirm, ticker)


@bp.route("/brief/plays/<ticker>/skip", methods=["POST"])
def skip(ticker):
    return _action(get_brief_service().skip, ticker)
