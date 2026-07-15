"""
Orchestrates the social-signal pipeline (text accounts only — vision/image
parsing for accounts like @FL0WG0D is a later phase, out of scope here per
docs/features/social-signal-contracts.md §13 phase 2):

  poll /2/tweets/search/recent (one query, every active account)
    -> dedupe on tweet_id
    -> §4 keyword filter ("parse for" phrases)
    -> contract_parser.py (regex -> Claude fallback)
    -> seed price via AlpacaOptionService
    -> insert tracked_options_contracts (status='tracking', source='social_signal')
    -> StrategyNotifier.notify_social_signal

Lifecycle mirrors OptionsContractMonitorService / the removed v1 scraper:
start() in a background thread's event loop, stop() to shut down.
"""

import asyncio
import logging
import os
import random
from datetime import datetime, time, timezone
from typing import List, Optional

import pytz
from supabase import create_client, Client

from services.social.x_client import XApiClient, XApiAuthError, XApiError, Tweet
from services.social.keyword_filter import matches as keyword_matches
from services.social.contract_parser import parse_tweet, build_occ_symbol

logger = logging.getLogger(__name__)

ET = pytz.timezone("America/New_York")

HOT_WINDOW_START = time(9, 28)
HOT_WINDOW_END   = time(9, 50)
MARKET_CLOSE     = time(16, 0)

# Starting points per docs/features/social-signal-contracts.md §3 — the real
# ceiling is whatever rate limit the pay-as-you-go project has on
# search/recent, not yet known (open question §12.1). Back off automatically
# on a 429 rather than hard-coding a "safe" number we can't actually verify yet.
HOT_WINDOW_INTERVAL_SECONDS  = 20
COOL_WINDOW_INTERVAL_SECONDS = 150
JITTER_SECONDS = 10
RATE_LIMIT_BACKOFF_SECONDS = 120


class SignalIngestService:
    def __init__(self):
        self.supabase_url = os.getenv("SUPABASE_URL")
        self.supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        if not self.supabase_url or not self.supabase_key:
            raise ValueError("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set")
        self.supabase: Client = create_client(self.supabase_url, self.supabase_key)
        self.x_client = XApiClient(self.supabase)
        self.is_running = False
        self._rate_limited_until: Optional[datetime] = None

        # In-memory debug surface for the admin/social-signals status screen —
        # the mobile app's Log Viewer only captures client-side console
        # output, so it has no visibility into this backend poll loop at all.
        # Exposing these via /social-signals/status is the only way to
        # "watch" ingest activity from the phone without Railway log access.
        self.last_poll_at: Optional[datetime] = None
        self.last_poll_summary: Optional[str] = None
        self.last_account_errors: dict[str, str] = {}  # account_id -> error message

    # ── Lifecycle ────────────────────────────────────────────────────────────

    async def start(self):
        logger.info("SignalIngestService: started")
        self.is_running = True
        try:
            while self.is_running:
                if self._is_market_hours() and not self._is_rate_limited():
                    try:
                        await self._poll_cycle()
                    except XApiAuthError as e:
                        logger.error("SignalIngestService: auth error — %s", e)
                    except XApiError as e:
                        logger.warning("SignalIngestService: %s — backing off %ds",
                                       e, RATE_LIMIT_BACKOFF_SECONDS)
                        self._rate_limited_until = datetime.now(timezone.utc)
                    except Exception as e:
                        logger.error("SignalIngestService: poll cycle error: %s", e, exc_info=True)
                await asyncio.sleep(self._next_interval())
        except asyncio.CancelledError:
            pass
        finally:
            self.is_running = False
            logger.info("SignalIngestService: stopped")

    async def stop(self):
        self.is_running = False

    def _is_market_hours(self) -> bool:
        now = datetime.now(ET)
        if now.weekday() >= 5:
            return False
        return HOT_WINDOW_START <= now.time() <= MARKET_CLOSE

    def _is_hot_window(self) -> bool:
        return HOT_WINDOW_START <= datetime.now(ET).time() <= HOT_WINDOW_END

    def _is_rate_limited(self) -> bool:
        if self._rate_limited_until is None:
            return False
        elapsed = (datetime.now(timezone.utc) - self._rate_limited_until).total_seconds()
        if elapsed >= RATE_LIMIT_BACKOFF_SECONDS:
            self._rate_limited_until = None
            return False
        return True

    def _next_interval(self) -> float:
        base = HOT_WINDOW_INTERVAL_SECONDS if self._is_hot_window() else COOL_WINDOW_INTERVAL_SECONDS
        return base + random.uniform(0, JITTER_SECONDS)

    # ── Poll cycle ───────────────────────────────────────────────────────────

    async def _poll_cycle(self):
        self.last_poll_at = datetime.now(timezone.utc)
        accounts = await self._load_active_accounts()
        if not accounts:
            self.last_poll_summary = "0 accounts resolved (check x_user_id lookups below)"
            return

        loop = asyncio.get_event_loop()
        cursored = [a for a in accounts if a.get("last_seen_tweet_id")]
        # Oldest cursor across all accounts, compared numerically — X's tweet
        # ids are large monotonically-increasing integers, not sortable as
        # plain strings in general (only safe when every id has equal digit
        # length, which isn't an assumption worth relying on).
        since_id = str(min(int(a["last_seen_tweet_id"]) for a in cursored)) if cursored else None
        # Any account with no cursor yet is a cold start — its tweets from
        # this poll seed the cursor but are NOT parsed/notified, the same
        # "don't blast a 7-day backlog as if it just happened" rule the v1
        # scraper design used for a fresh account.
        cold_account_ids = {a["id"] for a in accounts if not a.get("last_seen_tweet_id")}

        query = XApiClient.build_query([a["handle"] for a in accounts])
        tweets = await loop.run_in_executor(
            None, lambda: self.x_client.search_recent(query, since_id)
        )
        if not tweets:
            self.last_poll_summary = f"0 new tweets across {len(accounts)} account(s)"
            return

        logger.info("SignalIngestService: %d new tweet(s) across %d account(s)",
                     len(tweets), len(accounts))
        self.last_poll_summary = f"{len(tweets)} new tweet(s) across {len(accounts)} account(s)"

        by_author = {a.get("x_user_id"): a for a in accounts if a.get("x_user_id")}
        latest_per_account: dict[str, str] = {}

        for tweet in tweets:
            account = by_author.get(tweet.author_id)
            if not account:
                continue  # shouldn't happen given the query, but don't crash on it
            is_cold = account["id"] in cold_account_ids
            await self._process_tweet(account, tweet, cold_start=is_cold)
            latest_per_account[account["id"]] = tweet.tweet_id

        for account_id, tweet_id in latest_per_account.items():
            await self._update_cursor(account_id, tweet_id)

    async def _process_tweet(self, account: dict, tweet: Tweet, cold_start: bool = False):
        loop = asyncio.get_event_loop()

        existing = await loop.run_in_executor(None, lambda: (
            self.supabase.table("social_signal_tweets")
            .select("id").eq("tweet_id", tweet.tweet_id).limit(1).execute()
        ))
        if existing.data:
            return

        if cold_start:
            # First-ever poll for this account: seed the audit log (so it's
            # visible what was in the initial backlog) but never parse/track/
            # notify — same rationale as the removed v1 scraper's cold-start
            # handling: a 7-day backlog isn't "just happened."
            await loop.run_in_executor(None, lambda: (
                self.supabase.table("social_signal_tweets").insert({
                    "account_id": account["id"],
                    "tweet_id": tweet.tweet_id,
                    "tweet_text": tweet.text,
                    "tweet_url": f"https://x.com/{account['handle']}/status/{tweet.tweet_id}",
                    "posted_at": tweet.created_at,
                    "parse_status": "filtered_out",
                }).execute()
            ))
            return

        keywords = account.get("parse_keywords") or []
        if not keyword_matches(tweet.text, keywords):
            await loop.run_in_executor(None, lambda: (
                self.supabase.table("social_signal_tweets").insert({
                    "account_id": account["id"],
                    "tweet_id": tweet.tweet_id,
                    "tweet_text": tweet.text,
                    "tweet_url": f"https://x.com/{account['handle']}/status/{tweet.tweet_id}",
                    "posted_at": tweet.created_at,
                    "parse_status": "filtered_out",
                }).execute()
            ))
            return

        contract = parse_tweet(tweet.text)

        row = {
            "account_id": account["id"],
            "tweet_id": tweet.tweet_id,
            "tweet_text": tweet.text,
            "tweet_url": f"https://x.com/{account['handle']}/status/{tweet.tweet_id}",
            "posted_at": tweet.created_at,
            "parse_status": "no_contract" if contract is None else "parsed",
            "parsed_contract": None if contract is None else {
                "ticker": contract.ticker, "option_type": contract.option_type,
                "strike": contract.strike, "expiry": contract.expiry,
            },
            "parse_method": None if contract is None else contract.method,
        }

        if contract is None:
            await loop.run_in_executor(None, lambda: (
                self.supabase.table("social_signal_tweets").insert(row).execute()
            ))
            return

        contract_symbol = build_occ_symbol(
            contract.ticker, contract.option_type, contract.strike, contract.expiry
        )
        tracked_id = await self._track_and_notify(account, tweet, contract, contract_symbol)

        row["tracked_contract_id"] = tracked_id
        await loop.run_in_executor(None, lambda: (
            self.supabase.table("social_signal_tweets").insert(row).execute()
        ))

    async def _track_and_notify(self, account: dict, tweet: Tweet,
                                 contract, contract_symbol: str) -> Optional[str]:
        loop = asyncio.get_event_loop()

        from datetime import date as _date
        dup = await loop.run_in_executor(None, lambda: (
            self.supabase.table("tracked_options_contracts")
            .select("id")
            .eq("contract_symbol", contract_symbol)
            .eq("tracked_from_source", "social_signal")
            .gte("created_at", _date.today().isoformat())
            .limit(1)
            .execute()
        ))
        if dup.data:
            return dup.data[0]["id"]

        from services.alpaca.alpaca_option_service import get_alpaca_option_service
        option_service = get_alpaca_option_service()
        prices = await option_service.get_contract_prices_batch([contract_symbol])
        entry_price = prices.get(contract_symbol)

        owner = await loop.run_in_executor(None, lambda: (
            self.supabase.table("tracked_options_contracts")
            .select("user_id").limit(1).execute()
        ))
        if not owner.data:
            logger.error("SignalIngestService: no existing tracked_options_contracts "
                         "row to infer user_id from — cannot insert without one")
            return None
        user_id = owner.data[0]["user_id"]

        insert_row = {
            "user_id": user_id,
            "ticker": contract.ticker,
            "contract_symbol": contract_symbol,
            "option_type": contract.option_type,
            "strike": contract.strike,
            "expiration_date": contract.expiry,
            "tracking_snapshot": {
                "source": "social_signal",
                "parser": "text",
                "account_handle": account["handle"],
                "tweet_id": tweet.tweet_id,
                "tweet_url": f"https://x.com/{account['handle']}/status/{tweet.tweet_id}",
                "parse_method": contract.method,
            },
            "status": "tracking",
            "tracked_from_source": "social_signal",
            "tracking_reason": f"@{account['handle']}: \"{tweet.text[:200]}\"",
            "tracked_entry_price": entry_price,
        }
        res = await loop.run_in_executor(None, lambda: (
            self.supabase.table("tracked_options_contracts").insert(insert_row).execute()
        ))
        if not res.data:
            return None
        tracked_id = res.data[0]["id"]

        from services.strategy.notifier import StrategyNotifier
        StrategyNotifier(self.supabase).notify_social_signal(
            handle=account["handle"],
            contract_symbol=contract_symbol,
            ticker=contract.ticker,
            option_type=contract.option_type,
            strike=contract.strike,
            tweet_text=tweet.text,
            tweet_url=f"https://x.com/{account['handle']}/status/{tweet.tweet_id}",
        )
        return tracked_id

    # ── Database helpers ─────────────────────────────────────────────────────

    async def _load_active_accounts(self) -> List[dict]:
        loop = asyncio.get_event_loop()

        def fetch():
            return (
                self.supabase.table("social_signal_accounts")
                .select("id, handle, x_user_id, parse_keywords, last_seen_tweet_id")
                .eq("active", True)
                .execute()
            )

        result = await loop.run_in_executor(None, fetch)
        accounts = result.data or []

        # x_user_id is resolved lazily here (not at follow-time in the route)
        # so an account can be marked active before its id lookup succeeds —
        # simpler failure mode than blocking the follow action on X API health.
        missing = [a for a in accounts if not a.get("x_user_id")]
        for a in missing:
            try:
                uid = await loop.run_in_executor(None, lambda h=a["handle"]: self.x_client.lookup_user_id(h))
                if uid:
                    a["x_user_id"] = uid
                    self.last_account_errors.pop(a["id"], None)
                    await loop.run_in_executor(None, lambda aid=a["id"], u=uid: (
                        self.supabase.table("social_signal_accounts")
                        .update({"x_user_id": u}).eq("id", aid).execute()
                    ))
                else:
                    # Lookup call succeeded but X has no user for this handle —
                    # most likely a typo (e.g. "optionsbuffet" vs the real
                    # "OptionsBuffett") rather than an API failure, so this
                    # would otherwise silently drop the account from every
                    # poll forever with zero visibility.
                    msg = f"X API returned no user for @{a['handle']} — check the handle spelling"
                    self.last_account_errors[a["id"]] = msg
                    logger.warning("SignalIngestService: %s", msg)
            except Exception as e:
                msg = f"lookup_user_id(@{a['handle']}) failed: {e}"
                self.last_account_errors[a["id"]] = msg
                logger.warning("SignalIngestService: %s", msg)

        return [a for a in accounts if a.get("x_user_id")]

    async def _update_cursor(self, account_id: str, latest_tweet_id: str):
        loop = asyncio.get_event_loop()

        def update():
            self.supabase.table("social_signal_accounts").update({
                "last_seen_tweet_id": latest_tweet_id,
                "last_polled_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", account_id).execute()

        await loop.run_in_executor(None, update)


# ── Singleton ────────────────────────────────────────────────────────────────

_ingest_instance: Optional[SignalIngestService] = None


def get_signal_ingest_service() -> SignalIngestService:
    global _ingest_instance
    if _ingest_instance is None:
        _ingest_instance = SignalIngestService()
        logger.info("SignalIngestService initialized")
    return _ingest_instance


def reset_signal_ingest_service():
    global _ingest_instance
    _ingest_instance = None
    logger.info("SignalIngestService reset")
