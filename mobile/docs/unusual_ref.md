
  ---
  Unusual Whales — API Response Format & Frontend Plan

  ---
  Endpoint 1: Flow Alerts (aggregated unusual activity)
  
  GET https://api.unusualwhales.com/api/option-trades/flow-
  alerts
  GET https://api.unusualwhales.com/api/stock/{ticker}/flow
  -alerts

  Headers: Authorization: Bearer <YOUR_API_KEY>

  Example Response:

  {
    "data": [
      {
        "ticker": "AAPL",
        "underlying_type": "stock",
        "contract_type": "call",
        "strike": "195.00",
        "expiry": "2025-06-20",
        "ask": "3.55",
        "midpoint": "3.475",
        "price": "3.50",
        "size": 1250,
        "open_interest": 18420,
        "volume": 4800,
        "implied_volatility": "0.3214",
        "delta": "0.6521",
        "gamma": "0.0312",
        "theta": "-0.0871",
        "vega": "0.1923",
        "premium": "437500",
        "total_premium": "437500",
        "prev_oi": 17200,
        "all_opening": true,
        "side": "ask", 
        "alert_rule": "sweep",
        "tags": ["ask_side", "bullish", "sweep",
  "oi_increase"],
        "timestamp": "2025-06-13T10:32:45Z",
        "is_floor": false,
        "is_sweep": true,
        "is_multileg": false,
        "unusual_score": "87.3",
        "sector": "Technology",
        "market_cap_size": "mega"
      },
      {
        "ticker": "SPY",
        "underlying_type": "etf",
        "contract_type": "put",
        "strike": "510.00",
        "expiry": "2025-06-27",
        "bid": "2.10",
        "ask": "2.20",
        "midpoint": "2.15",
        "price": "2.10",
        "size": 5000,
        "open_interest": 62000,
        "volume": 15200, 
        "implied_volatility": "0.1843",
        "delta": "-0.4120",
        "gamma": "0.0198",
        "theta": "-0.0541",
        "vega": "0.2011",
        "premium": "1050000",
        "total_premium": "1050000",
        "prev_oi": 60800,
        "all_opening": false,
        "side": "bid", 
        "alert_rule": "floor",
        "tags": ["bid_side", "bearish", "floor",
  "large_block"],
        "timestamp": "2025-06-13T10:28:11Z",
        "is_floor": true,
        "is_sweep": false,
        "is_multileg": false,
        "unusual_score": "92.1",
        "sector": "ETF",
        "market_cap_size": null
      }
    ]
  }

  ---
  Endpoint 2: Full Tape (every individual trade)

  GET https://api.unusualwhales.com/api/option-trades/full-
  tape/{date}

  Example Response:
  {
    "data": [
      {
        "ticker": "NVDA",
        "contract_type": "call",
        "strike": "900.00",
        "expiry": "2025-07-18",
        "price": "15.20",
        "size": 200,
        "premium": "304000",
        "bid": "15.10",
        "ask": "15.30",
        "implied_volatility": "0.5812",
        "delta": "0.5234",
        "volume": 820,
        "open_interest": 3210,
        "side": "ask",
        "condition": "single",
        "exchange": "CBOE",
        "timestamp": "2025-06-13T10:44:02Z",
        "tags": ["ask_side", "bullish", "otm"]
      }
    ]
  }

  ---
  Key Field Reference

  Field: contract_type
  Type (wire): string
  Meaning: "call" or "put"
  ────────────────────────────────────────
  Field: strike
  Type (wire): string
  Meaning: Strike price — parse to float
  ────────────────────────────────────────
  Field: expiry
  Type (wire): string
  Meaning: ISO date "YYYY-MM-DD"
  ────────────────────────────────────────
  Field: price
  Type (wire): string
  Meaning: Fill price per contract
  ────────────────────────────────────────
  Field: size
  Type (wire): number
  Meaning: Number of contracts
  ────────────────────────────────────────
  Field: premium
  Type (wire): string
  Meaning: Total dollar value = price × size × 100
  ────────────────────────────────────────
  Field: implied_volatility
  Type (wire): string
  Meaning: e.g. "0.3214" = 32.14% IV
  ────────────────────────────────────────
  Field: delta
  Type (wire): string
  Meaning: 0–1 (calls), -1–0 (puts)
  ────────────────────────────────────────
  Field: side
  Type (wire): string
  Meaning: "ask" = aggressive buy, "bid" = aggressive sell
  ────────────────────────────────────────
  Field: is_sweep
  Type (wire): boolean
  Meaning: Multi-exchange rapid fill — high urgency signal
  ────────────────────────────────────────
  Field: is_floor
  Type (wire): boolean
  Meaning: Large block traded directly on exchange floor
  ────────────────────────────────────────
  Field: tags
  Type (wire): string[]
  Meaning: e.g. ["bullish", "sweep", "earnings_next_week", 
    "oi_increase"]
  ────────────────────────────────────────
  Field: unusual_score
  Type (wire): string
  Meaning: 0–100 unusualness score
  ────────────────────────────────────────
  Field: all_opening
  Type (wire): boolean
  Meaning: All contracts appear to be opening new positions

  ▎ Important: All price/vol/greek fields come back as 
  ▎ strings. Parse with parseFloat() before any math.

  ---
  Proposed Frontend Updates
  
  1. New "Flow" tab (or section within Options tab)

  A dedicated FlowScreen or a new horizontal tab inside the
   existing Options screen.

  Component structure:
  FlowScreen
  ├── FlowFilterBar          ← call/put toggle,
  sweep/floor/all, sort by premium
  ├── FlowFeed (FlatList)
  │   └── FlowCard × N
  │       ├── Ticker + contract badge (CALL/PUT pill,
  colored green/red)
  │       ├── Strike · Expiry
  │       ├── Premium (formatted: $437.5K, $1.05M)
  │       ├── Size × contracts
  │       ├── Side badge (ASK side = bullish buying, BID
  side = bearish selling)
  │       ├── Tag chips (SWEEP · FLOOR · EARNINGS)
  │       └── IV · Delta · Unusual score
  └── (optional) FlowDetailModal  ← tap for full greeks

  2. FlowCard design notes

  - Call → green left border + green CALL pill
  - Put → red left border + red PUT pill
  - Sweep → amber "⚡ SWEEP" chip
  - Floor → purple "🏛 FLOOR" chip
  - Premium formatted as $437.5K / $1.05M (large number =
  more notable)
  - unusual_score shown as a small number badge (e.g. 87)

  3. Ticker-specific flow (inside existing 
  TickerDetailScreen)

  Add a "Flow" section to the existing ticker detail view:
  - Pull from /api/stock/{ticker}/flow-alerts
  - Small horizontal scroll list of recent flow alerts for
  that ticker
  - Tap opens FlowDetailModal with full greeks
  
  4. New hooks needed

  hooks/queries/flow/
  ├── useFlowAlerts.ts        ← paginated global flow feed
  └── useTickerFlowAlerts.ts  ← per-ticker flow for detail
  screen

  5. New types

  // common/types/flow.ts
  export interface FlowAlert {
    ticker: string;
    contract_type: 'call' | 'put';
    strike: string;           // parse to float
    expiry: string;
    price: string;
    size: number;
    premium: string;          // parse to float → format as
   $1.05M
    implied_volatility: string;
    delta: string;
    side: 'ask' | 'bid';
    is_sweep: boolean;
    is_floor: boolean;
    is_multileg: boolean;
    tags: string[];
    unusual_score: string;
    timestamp: string;
  }
