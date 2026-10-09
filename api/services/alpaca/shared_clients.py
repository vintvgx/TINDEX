"""
One shared Alpaca TradingClient per account (paper / live) for request
routes that only READ account state — accounts, positions, transfers.

Each alpaca-py TradingClient owns its own requests.Session, so a client is a
connection pool. The routes used to build a fresh client on every call (the
app polls /strategy/accounts/positions every 5s): a new TCP+TLS handshake to
Alpaca each time, no keep-alive reuse, and connection churn that contributed
to the "connection limit exceeded" bursts (polling audit 2026-10-07, A4).

The session's pool is widened to POOL_SIZE so concurrent request threads
(gunicorn runs 64) reuse connections instead of the default pool of 10
opening and discarding extras. ORB/immediate engines keep their own clients
— this is only for the stateless read routes.
"""
import os
import threading

from alpaca.trading.client import TradingClient
from requests.adapters import HTTPAdapter

POOL_SIZE = 16

_lock = threading.Lock()
_clients: dict = {}  # paper(bool) -> (key, secret, TradingClient)


def _credentials(paper: bool) -> tuple:
    if paper:
        return os.getenv("ALPACA_PAPER_API_KEY"), os.getenv("ALPACA_PAPER_SECRET_KEY")
    return os.getenv("ALPACA_LIVE_API_KEY"), os.getenv("ALPACA_LIVE_SECRET_KEY")


def get_trading_client(paper: bool) -> TradingClient:
    """The shared client for that account, built on first use. Rebuilt if the
    credentials in the environment change (e.g. a key rotation)."""
    key, secret = _credentials(paper)
    with _lock:
        cached = _clients.get(paper)
        if cached and cached[0] == key and cached[1] == secret:
            return cached[2]
        client = TradingClient(key, secret, paper=paper)
        session = getattr(client, "_session", None)
        if session is not None:
            adapter = HTTPAdapter(pool_connections=1, pool_maxsize=POOL_SIZE)
            session.mount("https://", adapter)
        _clients[paper] = (key, secret, client)
        return client


def reset_clients() -> None:
    """Drop the cached clients (tests)."""
    with _lock:
        _clients.clear()
