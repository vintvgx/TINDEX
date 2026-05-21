"""
Plaid Service

Handles all Plaid API interactions: link token creation, public token exchange,
holdings retrieval, investment transactions, and item removal.

Access tokens are stored in the `plaid_items` Supabase table (service-role only;
no client-facing RLS), never returned to the mobile app.

Environment variables required:
    PLAID_CLIENT_ID
    PLAID_SECRET
    PLAID_ENV          sandbox | development | production  (default: sandbox)
"""

import os
from datetime import date, timedelta
from typing import Optional
from log.logging_config import get_logger

import plaid
from plaid.api import plaid_api
from plaid.model.link_token_create_request import LinkTokenCreateRequest
from plaid.model.link_token_create_request_user import LinkTokenCreateRequestUser
from plaid.model.item_public_token_exchange_request import ItemPublicTokenExchangeRequest
from plaid.model.investments_holdings_get_request import InvestmentsHoldingsGetRequest
from plaid.model.investments_transactions_get_request import (
    InvestmentsTransactionsGetRequest,
    InvestmentsTransactionsGetRequestOptions,
)
from plaid.model.item_remove_request import ItemRemoveRequest
from plaid.model.country_code import CountryCode
from plaid.model.products import Products
from plaid.model.link_token_account_filters import LinkTokenAccountFilters
from plaid.model.investments_filter import InvestmentsFilter

logger = get_logger(__name__)

_PLAID_ENV_MAP = {
    "sandbox": plaid.Environment.Sandbox,
    "development": plaid.Environment.Development,
    "production": plaid.Environment.Production,
}

_instance: Optional["PlaidService"] = None


def get_plaid_service() -> "PlaidService":
    global _instance
    if _instance is None:
        _instance = PlaidService()
    return _instance


class PlaidService:
    def __init__(self):
        client_id = os.getenv("PLAID_CLIENT_ID")
        secret = os.getenv("PLAID_SECRET")
        env_str = os.getenv("PLAID_ENV", "sandbox").lower()

        if not client_id or not secret:
            raise ValueError("PLAID_CLIENT_ID and PLAID_SECRET must be set")

        host = _PLAID_ENV_MAP.get(env_str, plaid.Environment.Sandbox)

        configuration = plaid.Configuration(
            host=host,
            api_key={"clientId": client_id, "secret": secret},
        )
        api_client = plaid.ApiClient(configuration)
        self.client = plaid_api.PlaidApi(api_client)
        logger.info("[PlaidService] initialized (env=%s)", env_str)

    # ------------------------------------------------------------------
    # Link token
    # ------------------------------------------------------------------

    def create_link_token(
        self,
        user_id: str,
        redirect_uri: Optional[str] = None,
        brokerage_only: bool = True,
    ) -> dict:
        """
        Create a Plaid link token scoped to brokerage investment accounts.

        Args:
            user_id:        Supabase user UUID (used as Plaid client_user_id)
            redirect_uri:   OAuth redirect URI for institutions that use OAuth
            brokerage_only: When True restricts to brokerage subtype only;
                            False allows all investment subtypes (IRA, 401k, etc.)
        """
        user = LinkTokenCreateRequestUser(client_user_id=user_id)

        account_filters = None
        if brokerage_only:
            account_filters = LinkTokenAccountFilters(
                investment=InvestmentsFilter(
                    account_subtypes=["brokerage"]
                )
            )

        kwargs: dict = dict(
            products=[Products("investments")],
            client_name="Alethia",
            country_codes=[CountryCode("US")],
            language="en",
            user=user,
        )
        if account_filters:
            kwargs["account_filters"] = account_filters
        if redirect_uri:
            kwargs["redirect_uri"] = redirect_uri

        request = LinkTokenCreateRequest(**kwargs)
        response = self.client.link_token_create(request)

        return {
            "link_token": response["link_token"],
            "expiration": str(response["expiration"]),
            "request_id": response["request_id"],
        }

    # ------------------------------------------------------------------
    # Public token exchange
    # ------------------------------------------------------------------

    def exchange_public_token(self, public_token: str) -> dict:
        """
        Exchange a public_token for an access_token + item_id.
        The caller is responsible for persisting the access_token securely.
        """
        request = ItemPublicTokenExchangeRequest(public_token=public_token)
        response = self.client.item_public_token_exchange(request)
        return {
            "access_token": response["access_token"],
            "item_id": response["item_id"],
            "request_id": response["request_id"],
        }

    # ------------------------------------------------------------------
    # Holdings
    # ------------------------------------------------------------------

    def get_holdings(self, access_token: str) -> dict:
        """
        Retrieve all investment holdings for a linked item.
        Returns holdings, securities, and account details.
        """
        request = InvestmentsHoldingsGetRequest(access_token=access_token)
        response = self.client.investments_holdings_get(request)

        def _holding(h) -> dict:
            return {
                "account_id": h["account_id"],
                "security_id": h["security_id"],
                "institution_price": float(h["institution_price"]),
                "institution_price_as_of": str(h.get("institution_price_as_of") or ""),
                "institution_value": float(h["institution_value"]),
                "cost_basis": float(h["cost_basis"]) if h.get("cost_basis") is not None else None,
                "quantity": float(h["quantity"]),
                "iso_currency_code": h.get("iso_currency_code"),
            }

        def _security(s) -> dict:
            return {
                "security_id": s["security_id"],
                "isin": s.get("isin"),
                "name": s.get("name"),
                "ticker_symbol": s.get("ticker_symbol"),
                "is_cash_equivalent": bool(s.get("is_cash_equivalent", False)),
                "type": str(s.get("type", "")),
                "close_price": float(s["close_price"]) if s.get("close_price") is not None else None,
                "close_price_as_of": str(s.get("close_price_as_of") or ""),
                "iso_currency_code": s.get("iso_currency_code"),
            }

        def _account(a) -> dict:
            bal = a.get("balances", {})
            return {
                "account_id": a["account_id"],
                "name": a.get("name", ""),
                "official_name": a.get("official_name"),
                "type": str(a.get("type", "")),
                "subtype": str(a.get("subtype", "")) if a.get("subtype") else None,
                "mask": a.get("mask"),
                "balances": {
                    "available": float(bal["available"]) if bal.get("available") is not None else None,
                    "current": float(bal["current"]) if bal.get("current") is not None else None,
                    "limit": float(bal["limit"]) if bal.get("limit") is not None else None,
                    "iso_currency_code": bal.get("iso_currency_code"),
                },
            }

        return {
            "holdings": [_holding(h) for h in response.get("holdings", [])],
            "securities": [_security(s) for s in response.get("securities", [])],
            "accounts": [_account(a) for a in response.get("accounts", [])],
        }

    # ------------------------------------------------------------------
    # Investment transactions
    # ------------------------------------------------------------------

    def get_investment_transactions(
        self,
        access_token: str,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        offset: int = 0,
        count: int = 100,
    ) -> dict:
        """
        Retrieve investment transactions for a linked item.

        Args:
            access_token:  Plaid access token
            start_date:    YYYY-MM-DD (default: 90 days ago)
            end_date:      YYYY-MM-DD (default: today)
            offset:        Pagination offset
            count:         Number of transactions to return (max 500)
        """
        today = date.today()
        start = (
            date.fromisoformat(start_date)
            if start_date
            else today - timedelta(days=90)
        )
        end = date.fromisoformat(end_date) if end_date else today

        options = InvestmentsTransactionsGetRequestOptions(
            offset=offset,
            count=min(count, 500),
        )
        request = InvestmentsTransactionsGetRequest(
            access_token=access_token,
            start_date=start,
            end_date=end,
            options=options,
        )
        response = self.client.investments_transactions_get(request)

        def _txn(t) -> dict:
            return {
                "investment_transaction_id": t["investment_transaction_id"],
                "account_id": t["account_id"],
                "security_id": t.get("security_id"),
                "date": str(t["date"]),
                "name": t.get("name", ""),
                "quantity": float(t.get("quantity") or 0),
                "amount": float(t.get("amount") or 0),
                "price": float(t.get("price") or 0),
                "fees": float(t["fees"]) if t.get("fees") is not None else None,
                "type": str(t.get("type", "")),
                "subtype": str(t.get("subtype", "")),
                "iso_currency_code": t.get("iso_currency_code"),
            }

        def _security(s) -> dict:
            return {
                "security_id": s["security_id"],
                "name": s.get("name"),
                "ticker_symbol": s.get("ticker_symbol"),
                "type": str(s.get("type", "")),
                "close_price": float(s["close_price"]) if s.get("close_price") is not None else None,
            }

        return {
            "investment_transactions": [_txn(t) for t in response.get("investment_transactions", [])],
            "securities": [_security(s) for s in response.get("securities", [])],
            "accounts": [
                {"account_id": a["account_id"], "name": a.get("name", "")}
                for a in response.get("accounts", [])
            ],
            "total_investment_transactions": response.get("total_investment_transactions", 0),
        }

    # ------------------------------------------------------------------
    # Remove item (unlink)
    # ------------------------------------------------------------------

    def remove_item(self, access_token: str) -> dict:
        """Revoke the access_token and remove the item from Plaid."""
        request = ItemRemoveRequest(access_token=access_token)
        response = self.client.item_remove(request)
        return {"removed": True, "request_id": response["request_id"]}
