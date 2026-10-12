"""GET /market-news (Home card headlines, 2026-10-12).

Run from api/:  python -m pytest tests/test_market_news.py
"""
import types

import pytest

import services.news.market_news as mn
from services.utils.short_cache import ShortCache


@pytest.fixture
def finnhub(monkeypatch):
    calls = {"n": 0, "items": []}

    def general_news(category, min_id=0):
        calls["n"] += 1
        return calls["items"]

    import services.strategy.sentiment as sentiment
    monkeypatch.setattr(sentiment, "_get_finnhub_client",
                        lambda: types.SimpleNamespace(general_news=general_news))
    monkeypatch.setattr(mn, "_cache", ShortCache(ttl=900))
    return calls


def test_normalizes_sorts_and_caps(finnhub):
    finnhub["items"] = [
        {"headline": "Old", "source": "Reuters", "url": "https://r/1", "image": "", "datetime": 100},
        {"headline": "New", "source": "CNBC", "url": "https://c/2", "image": "https://img/2.jpg", "datetime": 200},
        {"headline": "", "url": "https://x"},                       # dropped: no headline
    ] + [{"headline": f"h{i}", "source": "s", "url": f"https://u/{i}", "datetime": 50} for i in range(30)]
    items = mn.get_market_news()
    assert len(items) == mn.MAX_ITEMS
    assert items[0]["headline"] == "New" and items[0]["image"] == "https://img/2.jpg"
    assert items[1]["headline"] == "Old" and items[1]["image"] is None
    assert items[0]["published_at"].startswith("1970-01-01T00:03:20")


def test_cached_and_empty_not_cached(finnhub):
    assert mn.get_market_news() == [] and mn.get_market_news() == []
    assert finnhub["n"] == 2                                         # empty → retried
    finnhub["items"] = [{"headline": "A", "source": "s", "url": "https://a", "datetime": 1}]
    mn.get_market_news(); mn.get_market_news()
    assert finnhub["n"] == 3                                         # then served from cache
