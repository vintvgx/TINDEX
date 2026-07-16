"""
Official X API v2 client — OAuth 2.0 App-only (bearer token), read-only.

Uses /2/tweets/search/recent (pay-as-you-go compatible) rather than
/2/tweets/search/stream (Filtered Stream — gated to Pro/Enterprise, ruled out
in docs/features/social-signal-contracts.md §3).

Every call that reads a billed resource logs to x_api_usage_log so the app
can show a self-tracked spend estimate (no public balance endpoint exists —
see the doc's "X balance display" section) without needing any extra API
calls of its own.
"""

import logging
import os
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import List, Optional

import requests

logger = logging.getLogger(__name__)

X_API_BASE = "https://api.x.com/2"
_REQUEST_TIMEOUT = 15

# Per docs/features/social-signal-contracts.md §5 — from the account's own
# Developer Console pricing page. Update here if X changes pricing.
COST_POSTS_READ = 0.005
COST_USER_READ  = 0.010


class XApiError(Exception):
    pass


class XApiAuthError(XApiError):
    """Bearer token missing/invalid/rejected — distinct from a transient failure
    so callers (and the status route) can surface a clear, actionable message."""


@dataclass
class Tweet:
    tweet_id: str
    author_id: str
    text: str
    created_at: Optional[str]


class XApiClient:
    def __init__(self, supabase_client=None):
        self._token = os.getenv("X_API_BEARER_TOKEN", "")
        self._sb = supabase_client  # optional — usage logging is best-effort

    def _headers(self) -> dict:
        if not self._token:
            raise XApiAuthError("X_API_BEARER_TOKEN is not set")
        return {"Authorization": f"Bearer {self._token}"}

    def _log_usage(self, resource_type: str, quantity: int, unit_cost: float):
        if not self._sb or quantity <= 0:
            return
        try:
            self._sb.table("x_api_usage_log").insert({
                "resource_type": resource_type,
                "quantity": quantity,
                "unit_cost_usd": unit_cost,
            }).execute()
        except Exception as e:
            logger.warning("[XApiClient] usage log write failed (non-fatal): %s", e)

    # ── Public API ─────────────────────────────────────────────────────────────

    def lookup_user_id(self, handle: str) -> Optional[str]:
        """Resolve @handle -> numeric X user id. One-time per followed account —
        callers should cache the result (social_signal_accounts.x_user_id)."""
        handle = handle.lstrip("@")
        t0 = time.time()
        logger.info("[XApiClient] IN  lookup_user_id handle=@%s", handle)
        resp = requests.get(
            f"{X_API_BASE}/users/by/username/{handle}",
            headers=self._headers(),
            timeout=_REQUEST_TIMEOUT,
        )
        logger.info("[XApiClient] OUT lookup_user_id handle=@%s status=%s %.3fs",
                    handle, resp.status_code, time.time() - t0)
        if resp.status_code == 401:
            raise XApiAuthError(f"X API rejected the bearer token (401): {resp.text[:200]}")
        if resp.status_code == 404:
            return None
        resp.raise_for_status()
        self._log_usage("user_read", 1, COST_USER_READ)
        data = resp.json().get("data")
        return data["id"] if data else None

    def search_recent(self, query: str, since_id: Optional[str] = None,
                       max_results: int = 100) -> List[Tweet]:
        """
        GET /2/tweets/search/recent — searches the last 7 days, paginated
        newest-first by X but we return oldest-first so callers process/notify
        in chronological order. `since_id` (if given) excludes anything at or
        older than that tweet — the same semantics as the timeline endpoint's
        since_id, just on the search endpoint instead (search/recent is used
        here specifically because it's pay-as-you-go compatible, per
        docs/features/social-signal-contracts.md §3, and lets one query cover
        every followed account instead of one request per account).
        """
        params = {
            "query": query,
            "max_results": str(min(max(max_results, 10), 100)),
            "tweet.fields": "created_at,author_id",
        }
        if since_id:
            params["since_id"] = since_id

        t0 = time.time()
        logger.info("[XApiClient] IN  search_recent query=%r since_id=%s", query, since_id)
        resp = requests.get(
            f"{X_API_BASE}/tweets/search/recent",
            headers=self._headers(),
            params=params,
            timeout=_REQUEST_TIMEOUT,
        )
        logger.info("[XApiClient] OUT search_recent status=%s %.3fs", resp.status_code, time.time() - t0)
        if resp.status_code == 401:
            raise XApiAuthError(f"X API rejected the bearer token (401): {resp.text[:200]}")
        if resp.status_code == 429:
            raise XApiError(f"X API rate limit hit (429): {resp.text[:200]}")
        resp.raise_for_status()

        body = resp.json()
        rows = body.get("data", []) or []
        logger.info("[XApiClient] search_recent returned %d tweet(s)", len(rows))
        self._log_usage("posts_read", len(rows), COST_POSTS_READ)

        tweets = [
            Tweet(
                tweet_id=r["id"],
                author_id=r.get("author_id", ""),
                text=r.get("text", ""),
                created_at=r.get("created_at"),
            )
            for r in rows
        ]
        tweets.reverse()  # X returns newest-first; we want oldest-first
        return tweets

    @staticmethod
    def build_query(handles: List[str]) -> str:
        """`(from:a OR from:b OR ...)` — search/recent's query syntax for
        "any tweet authored by any of these accounts". Excludes retweets so a
        followed account retweeting someone else's contract call-out doesn't
        get misattributed to them (their own text/verbiage, §4's keyword
        filter, wouldn't be in a retweet anyway)."""
        clause = " OR ".join(f"from:{h.lstrip('@')}" for h in handles)
        return f"({clause}) -is:retweet"
