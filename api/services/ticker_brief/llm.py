"""
The Ticker Brief's LLM-derived pieces — linked companies, catalyst news, and
the Bottom Line's plain-English explanation of the Technicals Gate verdict.

Guardrails, enforced in code rather than trusted to the prompt:
  - The explanation may only mention numbers present in the gate JSON it
    was given; one that cites any other number is discarded (the app then
    shows the verdict without an explanation). It never produces a verdict.
  - Output mentioning gamma/GEX is dropped — positioning in this app is
    OI-based only.
  - Linked-company tickers must look like real symbols or become "";
    relations are limited to a fixed set; notes are capped at 18 words.

Uses the app's existing Anthropic client (no new keys).
"""

import hashlib
import json
import logging
import re

from services.ticker_brief.fetch import cached

logger = logging.getLogger(__name__)

TTL_LINKED = 30 * 86400
TTL_EXPLAIN = 86400
TTL_CATALYST_NEWS = 86400

_BANNED = re.compile(r"\b(gamma|gex)\b", re.IGNORECASE)
_RELATIONS = {"Supplier", "Customer", "Competitor", "Partner", "Peer"}
_TICKER_RE = re.compile(r"^[A-Z]{1,5}(\.[A-Z]{1,2})?$")
_NUM_RE = re.compile(r"\d+(?:\.\d+)?")
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

EXPLAIN_SYSTEM_PROMPT = (
    "You are explaining the system's verdict — every number you mention must appear in the input JSON. "
    "Never invent prices, targets, or dates. Never contradict the verdict. "
    "You are given the app's Technicals Gate output for one ticker (a CALL verdict and a PUT verdict, "
    "each ENTER, WAIT or DONT_ENTER, with its reasons). Write at most 35 words of plain English explaining "
    "why the gate says what it says. Do not recommend a trade, do not give your own verdict, do not add "
    "information that is not in the JSON. Reply with the explanation text only."
)


def _client():
    from services.anthropic.anthropic_service import anthropic_service, AGENT_UTILITY_MODEL
    return anthropic_service.sync_client, AGENT_UTILITY_MODEL


def _text(resp) -> str:
    return "".join(b.text for b in resp.content if getattr(b, "type", None) == "text").strip()


def _web_search_call(system: str, prompt: str, max_searches: int = 3) -> str:
    """One Claude call with the server-side web_search tool, resuming
    pause_turn the same way the market digest does."""
    client, model = _client()
    tools = [{"type": "web_search_20250305", "name": "web_search", "max_uses": max_searches}]
    messages = [{"role": "user", "content": prompt}]
    for _ in range(6):
        resp = client.messages.create(model=model, max_tokens=1200, system=system,
                                      messages=messages, tools=tools)
        if resp.stop_reason == "pause_turn":
            messages.append({"role": "assistant", "content": resp.content})
            continue
        return _text(resp)
    raise RuntimeError("web search did not finish")


def _json_array(text: str) -> list:
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip())
    try:
        val = json.loads(cleaned)
    except (json.JSONDecodeError, TypeError):
        start, end = cleaned.find("["), cleaned.rfind("]")
        if start == -1 or end <= start:
            raise ValueError("no JSON array in response")
        val = json.loads(cleaned[start:end + 1])
    if not isinstance(val, list):
        raise ValueError("response is not a JSON array")
    return val


def _cap_words(s: str, n: int) -> str:
    words = (s or "").split()
    return " ".join(words[:n])


# ── Linked companies ────────────────────────────────────────────────────────

def clean_linked(raw: list, symbol: str) -> list:
    """Validates/normalizes the model's linked-company list. Pure."""
    out = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        relation = str(item.get("relation") or "").strip().title()
        note = _cap_words(str(item.get("note") or "").strip(), 18)
        ticker = str(item.get("ticker") or "").strip().upper().lstrip("$")
        if not name or relation not in _RELATIONS:
            continue
        if _BANNED.search(name) or _BANNED.search(note):
            continue
        if not _TICKER_RE.match(ticker) or ticker == symbol:
            ticker = ""
        out.append({"name": name, "ticker": ticker, "relation": relation, "note": note})
        if len(out) == 4:
            break
    return out


def build_linked(symbol: str):
    def _fetch():
        system = (
            "You map a public company's key business relationships. Use web search to verify. "
            "Return ONLY a JSON array, no prose: "
            '[{"name": "...", "ticker": "...", "relation": "Supplier|Customer|Competitor|Partner|Peer", '
            '"note": "..."}]. At most 4 entries. note: at most 18 words, factual, no numbers you did not '
            "find. ticker: the company's real exchange ticker, or an empty string if it is private or "
            "you are not sure — never guess a ticker."
        )
        text = _web_search_call(system, f"Key linked companies for {symbol}.")
        return clean_linked(_json_array(text), symbol)
    data, fetched_at = cached(f"linked:{symbol}", TTL_LINKED, _fetch)
    return data, TTL_LINKED, fetched_at


# ── Catalyst news ───────────────────────────────────────────────────────────

def clean_catalyst_news(raw: list) -> list:
    """≤2 events, each {title, date|None}; drops earnings items (those come
    from yfinance) and anything with a malformed date. Pure."""
    out = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        title = _cap_words(str(item.get("title") or "").strip(), 20)
        if not title or _BANNED.search(title) or "earnings" in title.lower():
            continue
        d = str(item.get("date") or "").strip()
        out.append({"title": title, "date": d if _DATE_RE.match(d) else None})
        if len(out) == 2:
            break
    return out


def catalyst_news(symbol: str) -> tuple:
    def _fetch():
        system = (
            "You list upcoming or very recent non-earnings catalysts for a stock (product launches, "
            "regulatory decisions, investor days, index changes, major contracts). Use web search. "
            'Return ONLY a JSON array, no prose: [{"title": "...", "date": "YYYY-MM-DD"}]. At most 2 '
            "entries, title at most 20 words. Use a date only if a source states it; otherwise use an "
            "empty string. Never invent dates. Return [] if nothing notable."
        )
        return clean_catalyst_news(_json_array(_web_search_call(system, f"Catalysts for {symbol}.")))
    return cached(f"catnews:{symbol}", TTL_CATALYST_NEWS, _fetch)


# ── Bottom Line explanation ─────────────────────────────────────────────────

def gate_digest(gate: dict) -> dict:
    """The subset of the entry-check payload the explanation may draw on —
    small, stable, and the only input the model sees."""
    def _v(v):
        if not isinstance(v, dict):
            return None
        return {k: v.get(k) for k in ("decision", "reason", "blockers", "missing", "factors_agree", "factors_total")} | {
            "factors": [{"key": f.get("key"), "ok": f.get("ok"), "note": f.get("note")}
                        for f in (v.get("factors") or [])],
        }
    verdicts = gate.get("verdicts") or {}
    return {
        "ticker": gate.get("ticker"),
        "signal": gate.get("signal"),
        "price": gate.get("price"),
        "rows": gate.get("rows"),
        "CALL": _v(verdicts.get("CALL")),
        "PUT": _v(verdicts.get("PUT")),
    }


def numbers_grounded(text: str, source_json: str) -> bool:
    """Every number in `text` appears in `source_json` (compared as numbers,
    so 52.0 matches 52). Pure."""
    source_nums = {float(n) for n in _NUM_RE.findall(source_json)}
    for n in _NUM_RE.findall(text):
        if float(n) not in source_nums:
            return False
    return True


def explain_gate(symbol: str, gate: dict):
    """(explanation | None, fetched_at). None when the model's text fails a
    guardrail — the verdict then shows without an explanation."""
    digest = gate_digest(gate)
    source = json.dumps(digest, sort_keys=True, default=str)
    key = "explain:" + symbol + ":" + hashlib.sha1(source.encode()).hexdigest()

    def _fetch():
        client, model = _client()
        resp = client.messages.create(model=model, max_tokens=150, system=EXPLAIN_SYSTEM_PROMPT,
                                      messages=[{"role": "user", "content": source}])
        text = _cap_words(_text(resp), 35)
        if not text or _BANNED.search(text):
            logger.info("[ticker_brief] explain %s rejected: empty or banned term", symbol)
            return ""
        if not numbers_grounded(text, source):
            logger.info("[ticker_brief] explain %s rejected: ungrounded number in %r", symbol, text)
            return ""
        return text
    text, fetched_at = cached(key, TTL_EXPLAIN, _fetch)
    return (text or None), fetched_at
