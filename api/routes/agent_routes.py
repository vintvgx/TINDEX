"""
TINDEX AI agent routes: streaming chat and contract scoring.
"""

import json
from typing import Optional

from flask import Blueprint, jsonify, request, Response, stream_with_context

from log.logging_config import get_logger
from services.anthropic.anthropic_service import anthropic_service
from services.supabase.supabase_service import get_supabase_service

logger = get_logger(__name__)

bp = Blueprint("agent", __name__)

DEFAULT_AGENT_SYSTEM_PROMPT = (
    "You are TINDEX, an expert AI financial assistant specializing in options trading "
    "and market analysis. Provide data-driven, actionable insights. Always include the "
    "disclaimer: \"Not financial advice. Always do your own research.\""
)


def _annotate_already_tracked(result: dict, user_id: str, supabase) -> dict:
    """
    Mark a freshly-parsed checklist's watch_zone/contracts as already_tracked
    when the user already has an active watch/track for the same thing, so
    the mobile card can show "Already tracked" instead of a duplicate-risking
    Submit toggle (see ChecklistCard.tsx).
    """
    ticker = result.get("ticker")
    if not ticker:
        return result

    watch_zone = result.get("watch_zone")
    if watch_zone:
        levels = supabase.get_active_watched_price_levels(user_id, ticker)
        low, high = watch_zone.get("low"), watch_zone.get("high")
        # Overlapping ranges count as the same zone — an alert re-describing
        # a level a few cents off a previously-saved one is still the same
        # thing, not a new one.
        watch_zone["already_tracked"] = low is not None and high is not None and any(
            lv.get("level_low") is not None and lv.get("level_high") is not None
            and lv["level_low"] <= high and lv["level_high"] >= low
            for lv in levels
        )

    contracts = result.get("contracts") or []
    if contracts:
        tracked = supabase.get_active_tracked_contracts(user_id, ticker)
        tracked_keys = {
            (t.get("option_type"), round(float(t["strike"]), 2), t.get("expiration_date"))
            for t in tracked if t.get("strike") is not None
        }
        for c in contracts:
            if c.get("strike") is None:
                continue
            key = (c.get("option_type"), round(float(c["strike"]), 2), c.get("expiration_date"))
            c["already_tracked"] = key in tracked_keys

    return result


def _build_ticker_context(symbols: list[str]) -> Optional[str]:
    import yfinance as yf

    blocks: list[str] = []
    for sym in symbols:
        try:
            t = yf.Ticker(sym)

            def _fi(key, *aliases):
                fi = t.fast_info
                for k in (key, *aliases):
                    try:
                        val = fi[k]
                    except (KeyError, TypeError):
                        val = getattr(fi, k, None)
                    if val is not None:
                        return val
                return None

            price = _fi("last_price", "lastPrice")
            prev = _fi("previous_close", "previousClose")
            if price is None and prev is None:
                blocks.append(f"${sym}: no market data available right now.")
                continue

            lines = [f"${sym}"]
            if price is not None:
                line = f"  Price: ${float(price):.2f}"
                if prev:
                    chg = float(price) - float(prev)
                    pct = (chg / float(prev) * 100) if prev else 0
                    line += f" ({'+' if chg >= 0 else ''}{chg:.2f}, {'+' if pct >= 0 else ''}{pct:.2f}%)"
                lines.append(line)

            day_low, day_high = _fi("day_low", "dayLow"), _fi("day_high", "dayHigh")
            if day_low and day_high:
                lines.append(f"  Day range: ${float(day_low):.2f} – ${float(day_high):.2f}")
            yr_low, yr_high = _fi("year_low", "yearLow"), _fi("year_high", "yearHigh")
            if yr_low and yr_high:
                lines.append(f"  52-week range: ${float(yr_low):.2f} – ${float(yr_high):.2f}")
            vol = _fi("last_volume", "lastVolume")
            if vol:
                lines.append(f"  Volume: {int(vol):,}")
            mcap = _fi("market_cap", "marketCap")
            if mcap:
                lines.append(f"  Market cap: ${float(mcap)/1e9:.1f}B")

            try:
                info = t.get_info() or {}
                name = info.get("shortName") or info.get("longName")
                sector = info.get("sector")
                pe = info.get("trailingPE")
                if name:
                    lines[0] = f"${sym} — {name}"
                meta = []
                if sector:
                    meta.append(sector)
                if pe:
                    meta.append(f"P/E {float(pe):.1f}")
                if meta:
                    lines.append("  " + " · ".join(meta))
            except Exception:
                pass

            blocks.append("\n".join(lines))
        except Exception as exc:
            logger.warning("[agent] ticker snapshot failed for %s: %s", sym, exc)
            blocks.append(f"${sym}: market data lookup failed.")

    return "\n\n".join(blocks) if blocks else None


@bp.route("/api/agent/chat", methods=["POST"])
def agent_chat():
    body = request.get_json(silent=True) or {}
    user_id = body.get("user_id")
    message = (body.get("message") or "").strip()
    conversation_id = body.get("conversation_id")
    ticker = body.get("ticker")
    system_prompt = body.get("system_prompt") or DEFAULT_AGENT_SYSTEM_PROMPT

    if not user_id or not message:
        return jsonify({"error": "user_id and message are required"}), 400

    supabase = get_supabase_service()

    symbols = anthropic_service.extract_tickers(message)
    if ticker and ticker.upper() not in symbols:
        symbols.insert(0, ticker.upper())
    ticker_context = _build_ticker_context(symbols) if symbols else None

    is_new = not conversation_id
    if is_new:
        convo = supabase.create_ai_conversation(
            user_id=user_id,
            title=" ".join(message.split()[:6]) or "New conversation",
            ticker=ticker,
        )
        if not convo:
            return jsonify({"error": "Failed to create conversation"}), 500
        conversation_id = convo["id"]

    supabase.add_ai_message(conversation_id, "user", message)

    history = supabase.get_ai_messages(conversation_id, limit=20)
    chat_messages = [{"role": m["role"], "content": m["content"]} for m in history] \
        or [{"role": "user", "content": message}]

    def generate():
        full = ""
        try:
            for chunk in anthropic_service.stream_agent_chat(chat_messages, system_prompt, ticker_context):
                full += chunk
                yield f"data: {json.dumps({'type': 'chunk', 'content': chunk})}\n\n"

            saved = supabase.add_ai_message(conversation_id, "assistant", full) if full else None

            title = None
            if is_new:
                title = anthropic_service.generate_conversation_title(message)
                supabase.touch_ai_conversation(conversation_id, title=title)
            else:
                supabase.touch_ai_conversation(conversation_id)

            complete = {
                "type": "complete",
                "content": full,
                "conversationId": conversation_id,
                "messageId": (saved or {}).get("id", ""),
            }
            if title:
                complete["title"] = title
            yield f"data: {json.dumps(complete)}\n\n"
        except Exception as exc:
            logger.error("[agent] chat stream failed: %s", exc, exc_info=True)
            yield f"data: {json.dumps({'type': 'error', 'error': str(exc)})}\n\n"

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )


@bp.route("/api/agent/parse-screenshot", methods=["POST"])
def agent_parse_screenshot():
    """
    Extract a watch checklist from an options-flow alert screenshot, or
    revise a previously-extracted checklist from a text-only correction.

    Body (initial parse): { user_id, conversation_id?, message?, image_base64, media_type? }
    Body (revision):      { user_id, conversation_id?, message, previous_checklist }

    The image itself is never persisted. Two rows land in ai_messages: the
    assistant's text reply (plain content, as usual), and a second row whose
    metadata carries the full checklist JSON + a "pending" status — that
    second row is what lets the mobile client reconstruct the same
    interactive ChecklistCard (not just its text summary) after the
    conversation is reloaded. Each contract/watch-zone in the checklist is
    also annotated with already_tracked, cross-referenced against the user's
    existing watched_price_levels/tracked_options_contracts, so re-parsing
    the same alert twice shows "already tracked" instead of risking a
    duplicate watch/track on Submit.
    """
    body = request.get_json(silent=True) or {}
    user_id = body.get("user_id")
    conversation_id = body.get("conversation_id")
    message = (body.get("message") or "").strip()
    image_base64 = body.get("image_base64")
    media_type = body.get("media_type") or "image/jpeg"
    previous_checklist = body.get("previous_checklist")
    system_prompt = body.get("system_prompt") or DEFAULT_AGENT_SYSTEM_PROMPT

    if not user_id:
        return jsonify({"success": False, "error": "user_id is required"}), 400
    if not image_base64 and not previous_checklist:
        return jsonify({"success": False, "error": "image_base64 or previous_checklist is required"}), 400

    supabase = get_supabase_service()

    is_new = not conversation_id
    if is_new:
        convo = supabase.create_ai_conversation(
            user_id=user_id,
            title="Flow screenshot" if image_base64 else (message[:60] or "Flow checklist"),
            ticker=None,
        )
        if not convo:
            return jsonify({"success": False, "error": "Failed to create conversation"}), 500
        conversation_id = convo["id"]

    # Persist the user's turn as text only — the screenshot itself is never saved.
    user_text = message or ("[Attached a flow screenshot]" if image_base64 else "[Correction]")
    supabase.add_ai_message(conversation_id, "user", user_text)

    try:
        from datetime import date
        result = anthropic_service.parse_flow_screenshot(
            image_base64=image_base64,
            media_type=media_type,
            message=message or None,
            previous_checklist=previous_checklist,
            today=date.today().isoformat(),
            system_prompt=system_prompt,
        )
    except Exception as exc:
        logger.error("[agent] parse_flow_screenshot failed: %s", exc, exc_info=True)
        return jsonify({"success": False, "error": str(exc)}), 500

    result = _annotate_already_tracked(result, user_id, supabase)

    saved = supabase.add_ai_message(conversation_id, "assistant", result.get("reply") or "")
    # Separate row for the checklist itself (empty content — it renders as a
    # card, not text) so it survives a reload: metadata carries the full
    # checklist JSON plus its submit/skip status, read back by AgentModal to
    # reconstruct the same interactive card instead of losing it to
    # client-only state (see ai_messages.metadata's migration doc comment).
    checklist_saved = supabase.add_ai_message(
        conversation_id, "assistant", "",
        metadata={"checklist": result, "checklist_status": "pending"},
    )

    title = None
    if is_new:
        title = f"{result['ticker']} flow screenshot" if result.get("ticker") else "Flow screenshot"
        supabase.touch_ai_conversation(conversation_id, title=title)
    else:
        supabase.touch_ai_conversation(conversation_id)

    return jsonify({
        "success": True,
        "data": {
            "conversationId": conversation_id,
            "messageId": (saved or {}).get("id", ""),
            "checklistMessageId": (checklist_saved or {}).get("id", ""),
            "checklist": result,
            "title": title,
        },
    })


@bp.route("/api/agent/score_contract", methods=["POST"])
def agent_score_contract():
    body = request.get_json(silent=True) or {}
    user_id = body.get("user_id")
    ticker = body.get("ticker")
    contract = body.get("contract")
    tracked_contract_id = body.get("tracked_contract_id")
    system_prompt = body.get("system_prompt") or DEFAULT_AGENT_SYSTEM_PROMPT

    if not user_id or not ticker or not contract:
        return jsonify({"success": False, "error": "user_id, ticker and contract are required"}), 400

    try:
        result = anthropic_service.score_contract(ticker, contract, system_prompt)
    except Exception as exc:
        logger.error("[agent] score_contract failed: %s", exc, exc_info=True)
        return jsonify({"success": False, "error": str(exc)}), 500

    supabase = get_supabase_service()
    row = supabase.save_contract_score({
        "user_id": user_id,
        "tracked_contract_id": tracked_contract_id,
        "ticker": ticker.upper(),
        "contract_symbol": contract.get("symbol", ""),
        "score": result["score"],
        "signal": result["signal"],
        "reasoning": result.get("reasoning", ""),
        "factors": result.get("factors"),
    })

    data = row or {
        **result,
        "user_id": user_id,
        "tracked_contract_id": tracked_contract_id,
        "ticker": ticker.upper(),
        "contract_symbol": contract.get("symbol", ""),
    }
    return jsonify({"success": True, "data": data})
