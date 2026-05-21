# Plaid Integration Guide

This document covers everything required to get Plaid working end-to-end in Alethia, including backend setup, brokerage-only filtering, and the data you can expect from each connected institution.

---

## Architecture Overview

```
Mobile App
  └─ react-native-plaid-link-sdk (opens Plaid's Link UI)
       └─ on success → sends public_token to Railway backend
Railway Backend
  └─ exchanges public_token → access_token (stored server-side only)
  └─ calls Plaid Investments API using access_token
  └─ returns holdings / transactions to the app
Supabase
  └─ stores account metadata only (item_id, institution name, account names)
  └─ access_tokens are NEVER stored here
```

---

## Step 1 — Plaid Account Setup

1. Sign up at [https://dashboard.plaid.com](https://dashboard.plaid.com).
2. Create a new application (or use an existing one).
3. Copy your credentials:
   - `PLAID_CLIENT_ID`
   - `PLAID_SECRET` (use the **Sandbox** secret for development, **Production** secret for live)
4. Set the environment:
   - `sandbox` → fake institutions, test credentials, no real money
   - `development` → real institutions, up to 100 users free
   - `production` → live, billed per item

Add these to your Railway backend environment variables:
```
PLAID_CLIENT_ID=your_client_id
PLAID_SECRET=your_secret
PLAID_ENV=sandbox   # or development / production
```

---

## Step 2 — Brokerage-Only Filtering (No Whitelist Needed)

You **do not** need to build a custom whitelist. Plaid handles this natively in two ways:

### Option A — Products filter (recommended starting point)
When creating a link token, specify only the `investments` product. Plaid will automatically surface only institutions that support investment data:

```json
{
  "products": ["investments"]
}
```

### Option B — account_filters (more granular)
To further restrict to specific account subtypes (e.g., individual brokerage only, excluding IRA/401k):

```json
{
  "products": ["investments"],
  "account_filters": {
    "investment": {
      "account_subtypes": ["brokerage"]
    }
  }
}
```

Available investment subtypes: `brokerage`, `ira`, `401k`, `roth`, `401a`, `403b`, `457b`, `529`, `pension`, `ugma/utma`.

To allow all brokerage-style investment accounts (individual + retirement), omit `account_filters` and keep `products: ["investments"]`. Plaid will show all supported investment institutions and hide checking/savings/credit accounts entirely.

---

## Step 3 — Railway Backend Endpoints

Implement these five endpoints. The mobile app calls them via `PlaidService.ts`.

### POST `/api/plaid/create-link-token`

Creates a Plaid link token scoped to the authenticated user.

**Request:** Bearer token in `Authorization` header (Supabase JWT). Extract `user_id` from it.

**Plaid call:**
```python
# Python / FastAPI example
response = plaid_client.link_token_create({
    "user": {"client_user_id": user_id},
    "client_name": "Alethia",
    "products": ["investments"],
    "account_filters": {
        "investment": {"account_subtypes": ["brokerage"]}
    },
    "country_codes": ["US"],
    "language": "en",
    # Required for OAuth institutions (e.g. some brokerages redirect back to your app):
    "redirect_uri": "https://your-domain.com/plaid-oauth"  # or use app scheme
})
```

**Response to app:**
```json
{
  "link_token": "link-sandbox-...",
  "expiration": "2026-05-20T20:00:00Z",
  "request_id": "abc123"
}
```

---

### POST `/api/plaid/exchange-token`

Exchanges the `public_token` returned by Plaid Link for a permanent `access_token`. Stores the `access_token` server-side. Saves account metadata to Supabase.

**Request body (from app):**
```json
{
  "public_token": "public-sandbox-...",
  "institution_id": "ins_3",
  "institution_name": "Robinhood",
  "accounts": [
    {
      "id": "account_id_from_metadata",
      "name": "Brokerage Account",
      "mask": "1234",
      "type": "investment",
      "subtype": "brokerage"
    }
  ]
}
```

**Plaid call:**
```python
exchange = plaid_client.item_public_token_exchange({
    "public_token": public_token
})
access_token = exchange["access_token"]
item_id = exchange["item_id"]
# Store access_token securely server-side keyed by (user_id, item_id)
```

**Then insert into Supabase `plaid_accounts` for each account in the payload.**

**Response to app:**
```json
{
  "item_id": "...",
  "institution_name": "Robinhood",
  "accounts": [{ ... }]
}
```

---

### GET `/api/plaid/accounts`

Returns all linked account metadata for the authenticated user (reads from Supabase `plaid_accounts`).

**Response:**
```json
[
  {
    "id": "uuid",
    "item_id": "plaid_item_id",
    "institution_name": "Robinhood",
    "account_id": "plaid_account_id",
    "account_name": "Brokerage Account",
    "account_type": "investment",
    "account_subtype": "brokerage",
    ...
  }
]
```

---

### GET `/api/plaid/holdings?item_id=optional`

Fetches current holdings from Plaid using the stored `access_token`. If `item_id` is omitted, aggregates across all linked items for the user.

**Plaid call:**
```python
holdings = plaid_client.investments_holdings_get({
    "access_token": access_token
})
```

**Response to app** (see `PlaidHoldingsResponse` in `common/types/plaid.ts`):
```json
{
  "holdings": [...],
  "securities": [...],
  "accounts": [...]
}
```

---

### GET `/api/plaid/investment-transactions?item_id=&start_date=&end_date=`

Fetches investment transaction history.

**Plaid call:**
```python
transactions = plaid_client.investments_transactions_get({
    "access_token": access_token,
    "start_date": start_date,
    "end_date": end_date
})
```

---

### DELETE `/api/plaid/accounts/:item_id`

Removes the Plaid item (revokes access), deletes the stored `access_token`, and removes rows from Supabase `plaid_accounts` for that `item_id`.

**Plaid call:**
```python
plaid_client.item_remove({"access_token": access_token})
```

---

## Step 4 — Mobile Build

`react-native-plaid-link-sdk` is a **native module**. It cannot run in Expo Go. You must build a **development build** or a production build.

```bash
# Build a development client for your device / simulator
npx eas build --profile development --platform ios
# or
npx expo prebuild && npx expo run:ios
```

You already have `expo-dev-client` in your dependencies, so EAS Build is the recommended path.

### OAuth Redirect URI (for institutions that use OAuth)

Some institutions (like certain banks) redirect the user back to your app via a URI. Set the `redirect_uri` in your link token creation to match your app scheme. Your current scheme is `mobile` (`app.config.js` → `scheme: "mobile"`).

Example server-side redirect URI: `mobile://plaid-oauth`

On the backend, pass this in `link_token_create`:
```python
"redirect_uri": "mobile://plaid-oauth"
```

> Note: Robinhood's Plaid integration does **not** use OAuth — it authenticates directly inside the Plaid Link WebView, so this only matters for OAuth-capable institutions.

---

## Step 5 — Supabase Migration

Run `supabase/plaid_accounts.sql` in the Supabase SQL Editor. This creates the `plaid_accounts` table with RLS policies so each user can only see their own linked accounts.

---

## Data You Can Expect Per Service

All data comes through Plaid's **Investments** product. Coverage varies by institution.

### Robinhood (Priority Integration)

| Data | Available | Notes |
|------|-----------|-------|
| Account balance (current / available) | ✅ | Reflected in `accounts[].balances` |
| Stock holdings (equities) | ✅ | `security_type = "equity"` |
| ETF holdings | ✅ | `security_type = "etf"` |
| Crypto holdings | ✅ | `security_type = "cryptocurrency"` |
| Options positions | ⚠️ | `security_type = "derivative"` — Plaid returns options but with limited Greeks data. Quantity may reflect contracts (×100 shares). Strike/expiry come from `security.name` as a raw string, not structured fields. |
| Cost basis per position | ✅ | `holding.cost_basis` |
| Quantity / shares | ✅ | `holding.quantity` |
| Institution price | ✅ | `holding.institution_price` (Robinhood's own price) |
| Transaction history | ✅ | Buy, sell, dividend, transfer, fee |
| Fractional shares | ✅ | Quantity can be a decimal |
| Margin balance | ❌ | Not exposed via Plaid Investments |

#### Options caveat
Plaid does return Robinhood options positions but the structured data is limited:
- `security.name` looks like: `"AAPL 2026-06-20 call $190.00"` — you'll need to parse this string
- `holding.quantity` = number of contracts (multiply by 100 for share exposure)
- `holding.cost_basis` = total cost paid for the contracts
- No delta/gamma/theta/vega from Plaid — you'd enrich with your existing Railway options API

---

### TD Ameritrade / Schwab (post-merger)

| Data | Available | Notes |
|------|-----------|-------|
| Equities, ETFs, mutual funds | ✅ | Full holdings |
| Options | ✅ | `security_type = "derivative"` with similar string-based name |
| Bonds / fixed income | ✅ | `security_type = "fixed income"` |
| Transaction history | ✅ | Full history |

---

### Fidelity

| Data | Available | Notes |
|------|-----------|-------|
| Equities, ETFs, mutual funds | ✅ | |
| Options | ✅ | Same derivative type |
| Bonds | ✅ | |
| Retirement accounts (IRA, 401k) | ✅ | Include in `account_filters` subtypes if desired |

---

### E*TRADE / Morgan Stanley

| Data | Available | Notes |
|------|-----------|-------|
| Equities, ETFs | ✅ | |
| Options | ✅ | |
| Bonds | ✅ | |

---

### Webull

| Data | Available | Notes |
|------|-----------|-------|
| Holdings | ✅ | |
| Transactions | ✅ | |
| Options | ✅ | Limited, same as Robinhood |

---

### Coinbase / Crypto Brokerages

| Data | Available | Notes |
|------|-----------|-------|
| Crypto holdings | ✅ | `security_type = "cryptocurrency"` |
| Transaction history | ✅ | |

---

## Plaid Security Holding Object Reference

```typescript
// A single holding row from Plaid
{
  account_id: "abc123",        // links to account
  security_id: "def456",       // links to security in the securities array
  quantity: 10.5,              // shares / contracts / units
  institution_price: 190.42,   // price per unit from the institution
  institution_value: 1999.41,  // quantity × institution_price
  cost_basis: 1850.00,         // what you paid total (null if unknown)
  institution_price_as_of: "2026-05-20",
  iso_currency_code: "USD"
}

// The matching security
{
  security_id: "def456",
  ticker_symbol: "AAPL",       // null for options/derivatives
  name: "Apple Inc.",          // "AAPL 2026-06-20 call $190.00" for options
  type: "equity",              // equity | etf | derivative | cryptocurrency | etc.
  close_price: 190.00,
  is_cash_equivalent: false
}
```

---

## Recommended Next Steps

1. **Implement Railway endpoints** (Steps 3 above) — this is the remaining work before Plaid is live.
2. **Parse options names** — write a parser in `common/utils/` that extracts `ticker`, `expiry`, `callPut`, and `strike` from the Plaid security `name` string for derivatives.
3. **Sync to `portfolio_positions`** — after fetching holdings, optionally upsert Plaid equity positions into the existing `portfolio_positions` table so they appear in the P&L calendar.
4. **Periodic refresh** — set up a Railway cron or Supabase function to refresh holdings on a schedule (Plaid data is not real-time; it typically lags ~1 day for most brokerages).
5. **Sandbox testing** — use Plaid Sandbox credentials:
   - Username: `user_good`
   - Password: `pass_good`
   - MFA code: `1234`
   - Select "Robinhood" as the institution in the Link UI (available in Sandbox as institution ID `ins_3`)
