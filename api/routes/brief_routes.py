"""
Morning brief routes (TODO 8 part 1) — see services/brief/brief_service.py.

  POST  /brief/generate              {phase: build|rescore|lock} — pg_cron at
                                     9:00 / 9:10 / 9:20 / 9:28 ET; runs in the
                                     background and returns 202 immediately
  GET   /brief/today                 today's brief (plays, modes, statuses)
  PATCH /brief/plays/<ticker>        {mode: confirm|auto}
  POST  /brief/plays/<ticker>/confirm   approve a triggered confirm-first play
  POST  /brief/plays/<ticker>/skip      skip a play

Paper-testing loop (part 3):
  GET   /brief/review?start=&end=&paper=1   signals in the range + the weekly
                                     aggregates (by path, zone-score bucket,
                                     setup-score bucket). Default: this week.
  POST  /brief/review/resolve        {date?} — pg_cron 16:15 ET: setup
                                     outcomes + trade P&L for that day
  GET   /brief/config                current thresholds + their bounds
  PATCH /brief/config                {key: value, …} — bounds-checked
"""

import threading
from datetime import date, datetime, timedelta

import pytz
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


# ── Paper-testing loop (part 3) ──────────────────────────────────────────────

_ET = pytz.timezone("America/New_York")


def _parse_date(value, default: date) -> date:
    return date.fromisoformat(value) if value else default


@bp.route("/brief/review", methods=["GET"])
def review():
    from services.brief.review import aggregate
    today = datetime.now(_ET).date()
    try:
        start = _parse_date(request.args.get("start"), today - timedelta(days=today.weekday()))
        end = _parse_date(request.args.get("end"), today)
    except ValueError:
        return jsonify({"success": False, "error": "start/end must be YYYY-MM-DD"}), 400
    if end < start or (end - start).days > 120:
        return jsonify({"success": False, "error": "range must be 0–120 days, start ≤ end"}), 400
    paper_only = request.args.get("paper", "1") not in ("0", "false")
    try:
        rows = get_brief_service().io.signals_between(start, end, paper_only)
    except Exception as e:
        logger.error("[brief] review query failed: %s", e, exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500
    return jsonify({"success": True, "data": {
        "start": start.isoformat(), "end": end.isoformat(), "paper_only": paper_only,
        **aggregate(rows), "signals": rows,
    }})


@bp.route("/brief/review/resolve", methods=["POST"])
def resolve():
    from services.brief.signal_log import resolve_day
    raw = (request.get_json(silent=True) or {}).get("date")
    try:
        day = _parse_date(raw, datetime.now(_ET).date())
    except ValueError:
        return jsonify({"success": False, "error": "date must be YYYY-MM-DD"}), 400

    def _run():
        try:
            logger.info("[brief] resolve %s: %s", day, resolve_day(day))
        except Exception as e:
            logger.error("[brief] resolve %s failed: %s", day, e, exc_info=True)
    threading.Thread(target=_run, daemon=True, name=f"brief-resolve-{day}").start()
    return jsonify({"success": True, "date": day.isoformat(), "status": "started"}), 202


@bp.route("/brief/config", methods=["GET"])
def get_config():
    from services.brief.config import SCHEMA
    bounds = {k: {"default": d, "min": lo, "max": hi, "type": "int" if c is int else "float"}
              for k, (d, lo, hi, c) in SCHEMA.items()}
    return jsonify({"success": True, "data": {"settings": get_brief_service().io.config(), "bounds": bounds}})


@bp.route("/brief/config", methods=["PATCH"])
def patch_config():
    return _action(get_brief_service().io.update_config, request.get_json(silent=True) or {})
