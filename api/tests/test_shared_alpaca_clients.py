"""Shared Alpaca TradingClient per account (polling audit 2026-10-07, A4).

Run from api/:  python -m pytest tests/test_shared_alpaca_clients.py
"""
import pytest

from services.alpaca import shared_clients as sc


@pytest.fixture(autouse=True)
def keys(monkeypatch):
    monkeypatch.setenv("ALPACA_PAPER_API_KEY", "PK_TEST")
    monkeypatch.setenv("ALPACA_PAPER_SECRET_KEY", "ps")
    monkeypatch.setenv("ALPACA_LIVE_API_KEY", "AK_TEST")
    monkeypatch.setenv("ALPACA_LIVE_SECRET_KEY", "ls")
    sc.reset_clients()
    yield
    sc.reset_clients()


def test_same_client_is_reused_per_account():
    assert sc.get_trading_client(True) is sc.get_trading_client(True)
    assert sc.get_trading_client(False) is sc.get_trading_client(False)


def test_paper_and_live_are_separate_clients():
    assert sc.get_trading_client(True) is not sc.get_trading_client(False)


def test_key_rotation_rebuilds_the_client(monkeypatch):
    old = sc.get_trading_client(False)
    monkeypatch.setenv("ALPACA_LIVE_API_KEY", "AK_ROTATED")
    assert sc.get_trading_client(False) is not old


def test_widened_connection_pool_is_mounted():
    adapter = sc.get_trading_client(True)._session.get_adapter("https://paper-api.alpaca.markets")
    assert adapter._pool_maxsize == sc.POOL_SIZE
