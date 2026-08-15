"""
Daily Review notes/TODOs — freeform per-date journal entries shown on the
Daily Review calendar (orange dot = note, red dot = todo) and in the
app-wide backlog screen. Unauthenticated/single-tenant, same as
performance_reviews in strategy_routes.py (this is a personal app instance,
no per-user scoping anywhere in that table family either).
"""

from datetime import datetime, timezone

from flask import Blueprint, jsonify, request

from log.logging_config import get_logger
from services.supabase.supabase_service import get_supabase_service

logger = get_logger(__name__)

bp = Blueprint("review_notes", __name__)

_VALID_KINDS = {"note", "todo"}


@bp.route("/review/notes", methods=["GET"])
def list_notes():
    """
    All notes/todos, optionally filtered. Query params:
      start_date, end_date — inclusive date range (YYYY-MM-DD)
      kind                 — "note" | "todo"
      done                 — "true" | "false" (todo-only filter)
    No limit — the calendar needs every dot for the visible month, and the
    backlog screen needs the full set to filter/sort client-side.
    """
    try:
        sb = get_supabase_service().client
        q = sb.table("review_notes").select("*")

        start_date = request.args.get("start_date")
        end_date = request.args.get("end_date")
        kind = request.args.get("kind")
        done = request.args.get("done")

        if start_date:
            q = q.gte("note_date", start_date)
        if end_date:
            q = q.lte("note_date", end_date)
        if kind in _VALID_KINDS:
            q = q.eq("kind", kind)
        if done is not None:
            q = q.eq("is_done", done.lower() == "true")

        rows = q.order("note_date").execute().data or []
        return jsonify({"success": True, "data": rows})
    except Exception as e:
        logger.error("[review/notes GET] %s", e, exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@bp.route("/review/notes", methods=["POST"])
def create_note():
    """Body: { note_date: "YYYY-MM-DD", kind: "note"|"todo", content: str }"""
    body = request.get_json(silent=True) or {}
    note_date = (body.get("note_date") or "").strip()
    kind = (body.get("kind") or "").strip()
    content = (body.get("content") or "").strip()

    if not note_date:
        return jsonify({"success": False, "error": "note_date is required"}), 400
    if kind not in _VALID_KINDS:
        return jsonify({"success": False, "error": "kind must be 'note' or 'todo'"}), 400
    if not content:
        return jsonify({"success": False, "error": "content is required"}), 400

    try:
        sb = get_supabase_service().client
        res = sb.table("review_notes").insert({
            "note_date": note_date,
            "kind": kind,
            "content": content,
        }).execute()
        if not res.data:
            return jsonify({"success": False, "error": "Failed to create note"}), 500
        return jsonify({"success": True, "data": res.data[0]})
    except Exception as e:
        logger.error("[review/notes POST] %s", e, exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@bp.route("/review/notes/<note_id>", methods=["PATCH"])
def update_note(note_id: str):
    """
    Body (all optional): { note_date?, kind?, content?, is_done?, is_deferred?, completion_note? }
    Covers the "reassign to a different date" / "mark finished" toggle, plus
    recording what was actually done to resolve a TODO (e.g. from Claude Code).

    completed_at is derived, not settable directly: it's stamped when is_done
    flips to true and cleared when a TODO is reopened.

    is_deferred is a third state, distinct from "resolved" — set aside for
    later without claiming the work was actually done. Setting is_deferred
    true always forces is_done true too (so a deferred item drops out of
    every existing ?done=false query — the backlog's open list, the
    /work-todos skill — with no change needed to any read/filter path);
    explicitly setting is_done false in the SAME request re-opens the note
    and clears is_deferred, since "reopened" and "deferred" can't both be
    true at once.
    """
    body = request.get_json(silent=True) or {}
    patch = {}
    if "note_date" in body:
        patch["note_date"] = body["note_date"]
    if "kind" in body:
        if body["kind"] not in _VALID_KINDS:
            return jsonify({"success": False, "error": "kind must be 'note' or 'todo'"}), 400
        patch["kind"] = body["kind"]
    if "content" in body:
        content = (body["content"] or "").strip()
        if not content:
            return jsonify({"success": False, "error": "content cannot be empty"}), 400
        patch["content"] = content
    if "completion_note" in body:
        patch["completion_note"] = (body["completion_note"] or "").strip() or None
    if "is_done" in body:
        is_done = bool(body["is_done"])
        patch["is_done"] = is_done
        patch["completed_at"] = datetime.now(timezone.utc).isoformat() if is_done else None
        # Either direction supersedes a prior deferred state — reopening
        # clearly isn't "still deferred," and a plain resolve (not through
        # the defer action) means it's actually done now, not just set
        # aside. The is_deferred block below runs after and wins if the
        # SAME request also explicitly passes is_deferred.
        patch["is_deferred"] = False
    if "is_deferred" in body:
        is_deferred = bool(body["is_deferred"])
        patch["is_deferred"] = is_deferred
        if is_deferred:
            patch["is_done"] = True
            if "completed_at" not in patch:
                patch["completed_at"] = datetime.now(timezone.utc).isoformat()
    if not patch:
        return jsonify({"success": False, "error": "nothing to update"}), 400
    patch["updated_at"] = datetime.now(timezone.utc).isoformat()

    try:
        sb = get_supabase_service().client
        res = sb.table("review_notes").update(patch).eq("id", note_id).execute()
        if not res.data:
            return jsonify({"success": False, "error": "note not found"}), 404
        return jsonify({"success": True, "data": res.data[0]})
    except Exception as e:
        logger.error("[review/notes/%s PATCH] %s", note_id, e, exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@bp.route("/review/notes/<note_id>", methods=["DELETE"])
def delete_note(note_id: str):
    try:
        sb = get_supabase_service().client
        res = sb.table("review_notes").delete().eq("id", note_id).execute()
        if not res.data:
            return jsonify({"success": False, "error": "note not found"}), 404
        return jsonify({"success": True})
    except Exception as e:
        logger.error("[review/notes/%s DELETE] %s", note_id, e, exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500
