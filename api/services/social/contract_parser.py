"""
Parses a free-text tweet into a structured options contract.

Two-stage: a regex fast path for the common, unambiguous shorthand these
accounts actually use ("$SPY 750c 7/10", "IWM 297p"), falling back to Claude
for anything the regex can't confidently resolve. Never fabricates a strike/
expiry it isn't reasonably sure of — an unresolved tweet is logged and
skipped, not guessed at, since tracking the wrong contract is worse than
missing one.

See docs/features/social-signal-contracts.md §5 for the design rationale.
"""

import json
import logging
import os
import re
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Optional

import anthropic

logger = logging.getLogger(__name__)

_CLAUDE_MODEL = "claude-sonnet-4-6"

# Common index/ETF/mega-cap tickers these accounts actually trade — used to
# disambiguate a bare cashtag-less mention like "IWM 297p" from ordinary words.
_KNOWN_TICKERS = {
    "SPY", "QQQ", "IWM", "DIA", "AAPL", "TSLA", "NVDA", "AMZN", "MSFT", "META",
    "GOOGL", "GOOG", "AMD", "NFLX", "COIN", "SMCI", "PLTR", "SPX", "NDX",
}

_STRIKE_TYPE_RE = re.compile(
    r"\b(\d{1,5}(?:\.\d{1,2})?)\s*(c|call|p|put)\b", re.IGNORECASE
)
_CASHTAG_RE = re.compile(r"\$([A-Z]{1,5})\b")
_BARE_TICKER_RE = re.compile(r"\b([A-Z]{1,5})\b")
_DATE_RE = re.compile(r"\b(\d{1,2})/(\d{1,2})(?:/(\d{2,4}))?\b")


@dataclass
class ParsedContract:
    ticker: str
    option_type: str  # 'CALL' | 'PUT'
    strike: float
    expiry: str        # 'YYYY-MM-DD'
    method: str         # 'regex' | 'claude'


def _next_weekday_on_or_after(d: date, target_weekday: int) -> date:
    """target_weekday: Monday=0 ... Sunday=6"""
    days_ahead = (target_weekday - d.weekday()) % 7
    return d + timedelta(days=days_ahead)


def _resolve_bare_date(month: int, day: int, year: Optional[int], today: date) -> Optional[str]:
    """
    '7/10' with no year -> this year, unless the date is so far in the past
    that it can only mean a wrap into next year (posted in late December
    about an early-January date).

    Previously any bare date even one day in the past rolled forward a full
    year — these accounts almost always post about today or very recently,
    so a date '1 day ago' is virtually always a stale reference or typo, not
    a signal for a contract expiring 12 months out. That bug produced a
    NVDA contract dated a year in the future from a tweet that said "7/15"
    the day after ("2026-07-16 ... 7/15" -> wrongly resolved to
    "2027-07-15" instead of "2026-07-15"), which the contract module's own
    docstring explicitly says not to do ("never fabricates a ... expiry it
    isn't reasonably sure of"). 30 days safely separates "posted about
    yesterday" from a genuine December->January wraparound.
    """
    try:
        y = year if year else today.year
        if year and year < 100:
            y = 2000 + year
        d = date(y, month, day)
        if not year and d < today and (today - d).days > 30:
            d = date(y + 1, month, day)
        return d.isoformat()
    except ValueError:
        return None


def _regex_parse(tweet_text: str, today: date) -> Optional[ParsedContract]:
    strike_match = _STRIKE_TYPE_RE.search(tweet_text)
    if not strike_match:
        return None
    strike = float(strike_match.group(1))
    option_type = "CALL" if strike_match.group(2).lower().startswith("c") else "PUT"

    ticker = None
    cashtag = _CASHTAG_RE.search(tweet_text)
    if cashtag:
        ticker = cashtag.group(1)
    else:
        for m in _BARE_TICKER_RE.finditer(tweet_text):
            if m.group(1) in _KNOWN_TICKERS:
                ticker = m.group(1)
                break
    if not ticker:
        return None

    date_match = _DATE_RE.search(tweet_text)
    if date_match:
        month, day, year = date_match.groups()
        expiry = _resolve_bare_date(int(month), int(day), int(year) if year else None, today)
        if not expiry:
            return None
    else:
        # No expiry mentioned at all — these accounts post same-day 0DTE
        # calls often enough that "no date" is reasonably read as "today,
        # if today is a trading day" rather than an unresolved tweet.
        if today.weekday() >= 5:
            return None
        expiry = today.isoformat()

    return ParsedContract(ticker=ticker, option_type=option_type, strike=strike,
                           expiry=expiry, method="regex")


_CLAUDE_SYSTEM_PROMPT = """
You extract a single options contract from a tweet about trading. Reply with ONLY
raw JSON, no markdown fencing, no commentary. Two possible shapes:

Contract found — every field confidently determined from the tweet text alone:
{"contract": {"ticker": "SPY", "option_type": "CALL", "strike": 750, "expiry": "2026-07-10"}}

No confidently-resolvable single contract (missing ticker, missing strike, missing
type, ambiguous between multiple contracts, or not actually about a specific
options contract at all):
{"no_contract_found": true}

Rules:
- expiry must be an absolute YYYY-MM-DD date. If the tweet gives a relative date
  ("Friday", "tomorrow", no date at all implying same-day 0DTE) and today's date
  is given below, resolve it to an absolute date yourself.
- Never guess a strike or ticker that isn't actually stated or unambiguously implied.
- If the tweet mentions more than one contract, return no_contract_found — this
  parser only ever tracks one contract per tweet.
""".strip()


def _claude_parse(tweet_text: str, today: date) -> Optional[ParsedContract]:
    client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY", ""))
    try:
        response = client.messages.create(
            model=_CLAUDE_MODEL,
            max_tokens=200,
            system=_CLAUDE_SYSTEM_PROMPT,
            messages=[{
                "role": "user",
                "content": f"Today's date: {today.isoformat()}\n\nTweet:\n{tweet_text}",
            }],
        )
        raw = response.content[0].text.strip()
        parsed = json.loads(raw)
    except Exception as e:
        logger.warning("[ContractParser] Claude parse failed: %s", e)
        return None

    contract = parsed.get("contract")
    if not contract:
        return None
    try:
        return ParsedContract(
            ticker=str(contract["ticker"]).upper(),
            option_type="PUT" if str(contract["option_type"]).upper().startswith("P") else "CALL",
            strike=float(contract["strike"]),
            expiry=str(contract["expiry"]),
            method="claude",
        )
    except (KeyError, ValueError, TypeError) as e:
        logger.warning("[ContractParser] Claude returned malformed contract: %s (%s)", contract, e)
        return None


def parse_tweet(tweet_text: str, today: Optional[date] = None) -> Optional[ParsedContract]:
    """
    Try the regex fast path first; fall back to Claude only when the regex
    can't confidently resolve a contract. Returns None if neither can.
    """
    today = today or date.today()

    regex_result = _regex_parse(tweet_text, today)
    if regex_result:
        return regex_result

    return _claude_parse(tweet_text, today)


def build_occ_symbol(ticker: str, option_type: str, strike: float, expiry: str) -> str:
    """
    Inverse of alpaca_option_service.py's _parse_occ_*  helpers — builds an OCC
    symbol from components, matching this codebase's exact (unpadded-ticker)
    convention: IWM260427P00267000.
    """
    y, m, d = expiry.split("-")
    yy_mm_dd = f"{y[2:]}{m}{d}"
    type_char = "P" if option_type.upper().startswith("P") else "C"
    strike_str = f"{round(strike * 1000):08d}"
    return f"{ticker.upper()}{yy_mm_dd}{type_char}{strike_str}"
