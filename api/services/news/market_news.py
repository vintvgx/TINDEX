"""
General market news for the Home card's headlines (2026-10-12).

Finnhub `general_news` (category "general"), normalized to
[{headline, source, url, image, published_at}], newest first, capped.
Cached 15 min in-process (one gunicorn worker → shared by every phone);
a failed or empty fetch isn't cached, so the next request retries.
"""
import logging
from datetime import datetime, timezone

from services.utils.short_cache import ShortCache

logger = logging.getLogger(__name__)

CACHE_TTL_S = 15 * 60
MAX_ITEMS = 20

_cache = ShortCache(ttl=CACHE_TTL_S)


def _fetch() -> list:
    from services.strategy.sentiment import _get_finnhub_client
    client = _get_finnhub_client()
    if client is None:
        return []
    try:
        raw = client.general_news("general", min_id=0) or []
    except Exception as e:
        logger.warning("[MarketNews] Finnhub general_news failed: %s", e)
        return []
    items = []
    for a in raw:
        headline = (a.get("headline") or "").strip()
        url = (a.get("url") or "").strip()
        if not headline or not url:
            continue
        ts = a.get("datetime")
        items.append({
            "headline": headline,
            "source": (a.get("source") or "").strip(),
            "url": url,
            "image": (a.get("image") or "").strip() or None,
            "published_at": (datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()
                             if isinstance(ts, (int, float)) and ts > 0 else None),
            "_ts": ts or 0,
        })
    items.sort(key=lambda x: x["_ts"], reverse=True)
    for it in items:
        it.pop("_ts", None)
    return items[:MAX_ITEMS]


def get_market_news() -> list:
    return _cache.get_or_compute("general", _fetch, cacheable=lambda items: bool(items))
