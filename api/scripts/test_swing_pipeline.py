"""
Swing pipeline dry-run — no UW key, no Supabase, no Alpaca required.

Injects realistic mock flow alerts (the same shape UW returns) and runs
the full real SwingPipeline:
  - Real yfinance technical data (EMA, RSI, MACD, ATR)
  - Real scoring & tier assignment
  - No persistence (supabase_client=None)

Usage (from the api/ directory):
    python scripts/test_swing_pipeline.py
"""

import sys
import os
import json
from datetime import date, timedelta
from unittest.mock import MagicMock, patch

# ── Make the api package importable ──────────────────────────────────────────
API_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, API_DIR)

# ── Mock flow alerts ───────────────────────────────────────────────────────────
# These mirror the exact fields returned by UW's /api/option-trades/flow-alerts.
# Expiries are set 45–85 DTE from today so they pass the 30–90 DTE filter.

today = date.today()

def _expiry(dte: int) -> str:
    # Snap to the nearest Friday for realism
    d = today + timedelta(days=dte)
    offset = (4 - d.weekday()) % 7  # days until next Friday
    return str(d + timedelta(days=offset))

# Prices verified against market data as of 2026-06-29.
# NVDA ~$192.53 (confirmed screenshot), PLTR ~$112.93 (confirmed screenshot).
# Remaining tickers are current estimates; on Railway yfinance supplies live values.
MOCK_TECH = {
    "NVDA": {"current_price": 192.53, "ema20": 187.40, "ema50": 175.80, "ema200": 148.60,
             "rsi": 58.4, "macd_turning_up": True, "atr": 6.3500, "trend": "up",
             "ema_aligned": True, "dist_from_ema20_pct": 2.7},
    "TSLA": {"current_price": 322.80, "ema20": 308.50, "ema50": 288.40, "ema200": 238.70,
             "rsi": 62.1, "macd_turning_up": True, "atr": 12.4000, "trend": "up",
             "ema_aligned": True, "dist_from_ema20_pct": 4.6},
    "META": {"current_price": 697.40, "ema20": 688.20, "ema50": 662.80, "ema200": 580.10,
             "rsi": 54.8, "macd_turning_up": True, "atr": 16.9000, "trend": "up",
             "ema_aligned": True, "dist_from_ema20_pct": 1.3},
    "AAPL": {"current_price": 207.30, "ema20": 203.80, "ema50": 196.40, "ema200": 178.20,
             "rsi": 51.9, "macd_turning_up": True, "atr": 4.1200, "trend": "up",
             "ema_aligned": True, "dist_from_ema20_pct": 1.7},
    "AMD":  {"current_price": 168.40, "ema20": 164.10, "ema50": 154.30, "ema200": 136.90,
             "rsi": 60.8, "macd_turning_up": True, "atr": 6.2800, "trend": "up",
             "ema_aligned": True, "dist_from_ema20_pct": 2.6},
    "MSFT": {"current_price": 458.20, "ema20": 453.60, "ema50": 438.10, "ema200": 402.70,
             "rsi": 53.2, "macd_turning_up": False, "atr": 9.4000, "trend": "up",
             "ema_aligned": True, "dist_from_ema20_pct": 1.0},
    "AMZN": {"current_price": 236.80, "ema20": 232.10, "ema50": 221.50, "ema200": 195.80,
             "rsi": 55.7, "macd_turning_up": True, "atr": 5.6300, "trend": "up",
             "ema_aligned": True, "dist_from_ema20_pct": 2.0},
    "PLTR": {"current_price": 112.93, "ema20": 107.60, "ema50": 97.40, "ema200": 74.20,
             "rsi": 66.8, "macd_turning_up": True, "atr": 4.8200, "trend": "up",
             "ema_aligned": True, "dist_from_ema20_pct": 4.9},
    "JPM":  {"current_price": 287.60, "ema20": 282.30, "ema50": 272.80, "ema200": 248.10,
             "rsi": 50.8, "macd_turning_up": False, "atr": 5.9400, "trend": "sideways",
             "ema_aligned": True, "dist_from_ema20_pct": 1.9},
    "COIN": {"current_price": 286.40, "ema20": 298.70, "ema50": 318.20, "ema200": 265.80,
             "rsi": 37.4, "macd_turning_up": False, "atr": 18.3000, "trend": "down",
             "ema_aligned": False, "dist_from_ema20_pct": 4.1},
    "MSTR": {"current_price": 492.60, "ema20": 504.30, "ema50": 528.70, "ema200": 445.20,
             "rsi": 33.9, "macd_turning_up": False, "atr": 31.4000, "trend": "down",
             "ema_aligned": False, "dist_from_ema20_pct": 2.3},
    "GOOGL":{"current_price": 197.80, "ema20": 193.50, "ema50": 185.20, "ema200": 163.40,
             "rsi": 48.6, "macd_turning_up": False, "atr": 4.6100, "trend": "sideways",
             "ema_aligned": True, "dist_from_ema20_pct": 2.2},
}

MOCK_FLOWS = [
    # ── Sweeps with big dollar flow ────────────────────────────────────────────
    # Strikes are realistically OTM from current prices above (~3-7% OTM for institutional flow)
    {
        "ticker": "NVDA", "contract_type": "call", "strike": "200",  # ~4% OTM from $192.53
        "expiry": _expiry(52), "price": "9.50", "size": 1300,
        "premium": "1235000",
        "bid": "9.40", "ask": "9.60", "implied_volatility": "0.48",
        "delta": "0.44", "volume": 8200, "open_interest": 12000,
        "side": "ask", "is_sweep": True, "is_floor": False, "is_multileg": False,
        "tags": ["SWEEP", "OPENING"], "unusual_score": "92", "all_opening": True,
        "timestamp": "2026-06-29T09:35:00Z", "sector": "Technology",
    },
    {
        "ticker": "TSLA", "contract_type": "call", "strike": "340",  # ~5.3% OTM from $322.80
        "expiry": _expiry(47), "price": "18.40", "size": 510,
        "premium": "938400",
        "bid": "18.20", "ask": "18.60", "implied_volatility": "0.73",
        "delta": "0.43", "volume": 9500, "open_interest": 15000,
        "side": "ask", "is_sweep": True, "is_floor": False, "is_multileg": False,
        "tags": ["SWEEP", "REPEAT_HIT"], "unusual_score": "88", "all_opening": True,
        "timestamp": "2026-06-29T09:40:00Z", "sector": "Consumer Discretionary",
    },
    {
        "ticker": "META", "contract_type": "call", "strike": "720",  # ~3.2% OTM from $697.40
        "expiry": _expiry(81), "price": "34.80", "size": 280,
        "premium": "974400",
        "bid": "34.60", "ask": "35.00", "implied_volatility": "0.40",
        "delta": "0.46", "volume": 4100, "open_interest": 9800,
        "side": "ask", "is_sweep": False, "is_floor": True, "is_multileg": False,
        "tags": ["FLOOR_BLOCK", "OPENING"], "unusual_score": "85", "all_opening": True,
        "timestamp": "2026-06-29T10:05:00Z", "sector": "Communication Services",
    },
    # ── Strong flow, buyer-side ────────────────────────────────────────────────
    {
        "ticker": "AAPL", "contract_type": "call", "strike": "215",  # ~3.7% OTM from $207.30
        "expiry": _expiry(53), "price": "4.60", "size": 950,
        "premium": "437000",
        "bid": "4.55", "ask": "4.65", "implied_volatility": "0.29",
        "delta": "0.46", "volume": 3200, "open_interest": 7500,
        "side": "ask", "is_sweep": False, "is_floor": False, "is_multileg": False,
        "tags": ["OPENING"], "unusual_score": "79", "all_opening": True,
        "timestamp": "2026-06-29T10:15:00Z", "sector": "Technology",
    },
    {
        "ticker": "AMD", "contract_type": "call", "strike": "175",  # ~4% OTM from $168.40
        "expiry": _expiry(60), "price": "8.20", "size": 470,
        "premium": "385400",
        "bid": "8.10", "ask": "8.30", "implied_volatility": "0.55",
        "delta": "0.45", "volume": 5800, "open_interest": 10200,
        "side": "ask", "is_sweep": True, "is_floor": False, "is_multileg": False,
        "tags": ["SWEEP", "OPENING"], "unusual_score": "83", "all_opening": True,
        "timestamp": "2026-06-29T10:22:00Z", "sector": "Technology",
    },
    {
        "ticker": "MSFT", "contract_type": "call", "strike": "470",  # ~2.6% OTM from $458.20
        "expiry": _expiry(74), "price": "16.80", "size": 167,
        "premium": "280560",
        "bid": "16.60", "ask": "17.00", "implied_volatility": "0.28",
        "delta": "0.48", "volume": 2100, "open_interest": 6200,
        "side": "ask", "is_sweep": False, "is_floor": False, "is_multileg": False,
        "tags": ["OPENING"], "unusual_score": "76", "all_opening": True,
        "timestamp": "2026-06-29T10:30:00Z", "sector": "Technology",
    },
    {
        "ticker": "AMZN", "contract_type": "call", "strike": "245",  # ~3.5% OTM from $236.80
        "expiry": _expiry(60), "price": "11.40", "size": 300,
        "premium": "342000",
        "bid": "11.20", "ask": "11.60", "implied_volatility": "0.36",
        "delta": "0.47", "volume": 2900, "open_interest": 8100,
        "side": "ask", "is_sweep": False, "is_floor": True, "is_multileg": False,
        "tags": ["FLOOR_BLOCK"], "unusual_score": "81", "all_opening": False,
        "timestamp": "2026-06-29T10:45:00Z", "sector": "Consumer Discretionary",
    },
    # ── Mixed conviction ───────────────────────────────────────────────────────
    {
        "ticker": "PLTR", "contract_type": "call", "strike": "120",  # ~6.3% OTM from $112.93
        "expiry": _expiry(45), "price": "7.20", "size": 800,
        "premium": "576000",
        "bid": "7.10", "ask": "7.30", "implied_volatility": "0.65",
        "delta": "0.43", "volume": 12000, "open_interest": 18500,
        "side": "ask", "is_sweep": True, "is_floor": False, "is_multileg": False,
        "tags": ["SWEEP", "HIGH_VOL_OI"], "unusual_score": "91", "all_opening": True,
        "timestamp": "2026-06-29T11:00:00Z", "sector": "Technology",
    },
    {
        "ticker": "JPM", "contract_type": "call", "strike": "295",  # ~2.6% OTM from $287.60
        "expiry": _expiry(53), "price": "10.20", "size": 255,
        "premium": "260100",
        "bid": "10.10", "ask": "10.30", "implied_volatility": "0.25",
        "delta": "0.47", "volume": 1800, "open_interest": 5200,
        "side": "ask", "is_sweep": False, "is_floor": False, "is_multileg": False,
        "tags": ["OPENING"], "unusual_score": "72", "all_opening": True,
        "timestamp": "2026-06-29T11:10:00Z", "sector": "Financials",
    },
    # ── Put flow (bearish) — COIN in downtrend ────────────────────────────────
    {
        "ticker": "COIN", "contract_type": "put", "strike": "270",  # ~5.7% OTM from $286.40
        "expiry": _expiry(47), "price": "14.20", "size": 590,
        "premium": "837800",
        "bid": "14.00", "ask": "14.40", "implied_volatility": "0.88",
        "delta": "-0.43", "volume": 6200, "open_interest": 9100,
        "side": "ask", "is_sweep": True, "is_floor": False, "is_multileg": False,
        "tags": ["SWEEP", "OPENING"], "unusual_score": "86", "all_opening": True,
        "timestamp": "2026-06-29T11:20:00Z", "sector": "Financials",
    },
    # ── Weak / noisy flows (should score lower or fail tech filter) ───────────
    {
        "ticker": "MSTR", "contract_type": "call", "strike": "520",  # ~5.6% OTM from $492.60
        "expiry": _expiry(35), "price": "28.50", "size": 90,
        "premium": "256500",
        "bid": "27.50", "ask": "29.50", "implied_volatility": "1.20",
        "delta": "0.38", "volume": 800, "open_interest": 1200,
        "side": "bid",
        "is_sweep": False, "is_floor": False, "is_multileg": False,
        "tags": [], "unusual_score": "61", "all_opening": False,
        "timestamp": "2026-06-29T11:30:00Z", "sector": "Technology",
    },
    {
        "ticker": "GOOGL", "contract_type": "call", "strike": "205",  # ~3.6% OTM from $197.80
        "expiry": _expiry(88), "price": "7.80", "size": 170,
        "premium": "132600",
        "bid": "7.70", "ask": "7.90", "implied_volatility": "0.31",
        "delta": "0.44", "volume": 950, "open_interest": 4800,
        "side": "ask", "is_sweep": False, "is_floor": False, "is_multileg": False,
        "tags": [], "unusual_score": "66", "all_opening": False,
        "timestamp": "2026-06-29T11:45:00Z", "sector": "Communication Services",
    },
]


# ── Formatting helpers ─────────────────────────────────────────────────────────

def fmt_dollars(val):
    if val is None:
        return "—"
    v = float(val)
    if v >= 1_000_000:
        return f"${v/1_000_000:.2f}M"
    if v >= 1_000:
        return f"${v/1_000:.0f}K"
    return f"${v:.2f}"

TIER_ICONS = {"Prime": "🥇", "Strong": "💎", "Watch": "👁"}
SIDE_ICONS = {"call": "▲ CALL", "put": "▼ PUT"}


def print_result(result):
    meta = result.get("meta", {})
    surfaced = result.get("surfaced", [])

    print("\n" + "═" * 72)
    print("  TINDEX SWING TRADE PIPELINE — DRY RUN")
    print("═" * 72)
    print(f"  Scan date    : {meta.get('scan_date', today)}")
    print(f"  UW raw flows : {meta.get('uw_flows_raw', 0)}")
    print(f"  DTE eligible : {meta.get('swing_eligible', 0)}  (30–90 day filter)")
    print(f"  Unique tickers: {meta.get('candidates', 0)}")
    print(f"  Passed scoring: {meta.get('scored', 0)}")
    print(f"  Surfaced      : {meta.get('surfaced', 0)}  (cap = 20)")
    print(f"  Duration      : {meta.get('duration_sec', 0):.1f}s")
    print("═" * 72)

    if not surfaced:
        print("\n  ⚠  No opportunities surfaced — all candidates fell below score threshold.\n")
        return

    print(f"\n  {'#':<3}  {'TICKER':<7}  {'TIER':<8}  {'SCORE':<7}  {'SIDE':<8}  "
          f"{'STRIKE':<8}  {'EXPIRY':<12}  {'DTE':<5}  {'$ FLOW':<10}  "
          f"{'SETUP':<7}  {'FLOW':<6}  {'UW':<5}  {'FLAGS'}")
    print("  " + "─" * 110)

    for i, item in enumerate(surfaced, 1):
        icon = TIER_ICONS.get(item["tier"], "•")
        side_label = SIDE_ICONS.get(item["side"], item["side"].upper())
        flags = []
        if item.get("is_sweep"):
            flags.append("SWEEP")
        if item.get("is_floor"):
            flags.append("FLOOR")
        if item.get("vol_oi", 0) > 0.5:
            flags.append(f"V/OI={item['vol_oi']:.2f}")
        flag_str = " ".join(flags) if flags else "—"

        print(f"  {i:<3}  {item['ticker']:<7}  "
              f"{icon} {item['tier']:<6}  "
              f"{item['composite_score']:<7.1f}  "
              f"{side_label:<8}  "
              f"${item['strike']:<7.0f}  "
              f"{item['expiry'] or '—':<12}  "
              f"{item.get('dte', 0):<5}  "
              f"{fmt_dollars(item['dollar_flow']):<10}  "
              f"{item['flow_score']:<7.1f}  "
              f"{item['setup_score']:<6.1f}  "
              f"{item['unusual_score']:<5.0f}  "
              f"{flag_str}")

    print("\n  " + "─" * 110)
    print(f"\n  TIER BREAKDOWN")
    tiers = {"Prime": 0, "Strong": 0, "Watch": 0}
    for s in surfaced:
        tiers[s["tier"]] = tiers.get(s["tier"], 0) + 1
    for t, cnt in tiers.items():
        print(f"    {TIER_ICONS[t]} {t:<8} : {cnt}")

    # Detailed breakdown for top 3
    print("\n" + "═" * 72)
    print("  TOP 3 DETAILED BREAKDOWN")
    print("═" * 72)
    for item in surfaced[:3]:
        bd = item.get("breakdown", {})
        tech = bd.get("tech", {})
        print(f"\n  {item['ticker']}  |  {TIER_ICONS[item['tier']]} {item['tier']}  |  Score {item['composite_score']}")
        print(f"  Contract : {item.get('contract_symbol', '—')}")
        print(f"  Side     : {SIDE_ICONS.get(item['side'],'—')}  ${item['strike']}  exp {item['expiry']}  ({item.get('dte',0)}d DTE)")
        print(f"\n  ── Technical (weight 45%) ──────────────────────────")
        if tech.get("error"):
            print(f"     ⚠  Error: {tech['error']}")
        else:
            print(f"     Current price : ${tech.get('current_price', 0):.2f}")
            print(f"     20 EMA        : ${tech.get('ema20', 0):.2f}  "
                  f"({'✓ above' if tech.get('current_price',0) > tech.get('ema20',0) else '✗ below'})")
            print(f"     50 EMA        : {'${:.2f}'.format(tech['ema50']) if tech.get('ema50') else '—'}")
            print(f"     200 EMA       : {'${:.2f}'.format(tech['ema200']) if tech.get('ema200') else '—'}")
            print(f"     EMA aligned   : {'✓' if tech.get('ema_aligned') else '✗'}")
            print(f"     Trend         : {tech.get('trend','—').upper()}")
            print(f"     RSI (14)      : {tech.get('rsi', 0):.1f}")
            print(f"     MACD turning  : {'✓ UP' if tech.get('macd_turning_up') else '✗ DOWN'}")
            print(f"     Dist / EMA20  : {tech.get('dist_from_ema20_pct', 0):.1f}%")
            print(f"     ATR (14)      : ${tech.get('atr', 0):.4f}")
        print(f"     Setup score   : {item['setup_score']:.1f} / 100")

        print(f"\n  ── Flow (weight 55%) ───────────────────────────────")
        print(f"     $ Flow        : {fmt_dollars(item['dollar_flow'])}")
        print(f"     Vol / OI      : {item.get('vol_oi', 0):.2f}  ({item.get('vol',0):,} vol / {item.get('oi',0):,} OI)")
        print(f"     Aggressor     : {'BUY SIDE (ask)' if bd.get('aggressor') == 'ask' else 'SELL SIDE (bid)'}")
        print(f"     Sweep / Floor : {'SWEEP' if bd.get('is_sweep') else ''} {'FLOOR' if bd.get('is_floor') else ''}")
        print(f"     IV            : {item['iv_pct']:.1f}%  "
              f"({'⚠ penalized >80th pct' if bd.get('iv_penalized') else 'within normal range'})")
        print(f"     UW score      : {item['unusual_score']:.0f}")
        print(f"     Flow score    : {item['flow_score']:.1f} / 100")

        # Smart contract recommendation
        sc = item.get("smart_contract", {})
        if sc and "error" not in sc:
            print(f"\n  ── Smart Contract Recommendation ───────────────────")
            side_lbl = SIDE_ICONS.get(item["side"], item["side"].upper())
            anchor_sym = f"{item['ticker']} {item['expiry']} ${sc['anchor_strike']:.0f}{item['side'][0].upper()}"
            smart_sym  = f"{item['ticker']} {item['expiry']} ${sc['smart_strike']:.0f}{item['side'][0].upper()}"
            print(f"     UW anchor     : {anchor_sym}")
            print(f"       premium     : ${sc['anchor_premium']:.2f}  (${sc['anchor_cost_per_contract']:.0f}/contract)  delta {sc['anchor_delta']:.2f}")
            print(f"     → Smart pick  : {smart_sym}  ({sc['smart_otm_pct']:.1f}% OTM)")
            print(f"       premium     : ${sc['smart_premium']:.2f}  (${sc['smart_cost_per_contract']:.0f}/contract)  delta {sc['smart_delta']:.2f}")
            print(f"       savings     : ${sc['savings_vs_anchor']:.0f}/contract vs anchor")
            print(f"       upside est. : +{sc['potential_gain_pct']:.0f}%  (${sc['potential_gain_amt']:.0f}/contract on 1-sigma implied move)")
            print(f"     Why           : {sc['rationale']}")
        print()

    # ── Full recommended contract table ────────────────────────────────────────
    print("\n" + "═" * 72)
    print("  RECOMMENDED CONTRACTS (BUY LIST)")
    print("═" * 72)
    print(f"\n  {'#':<3}  {'TICKER':<7}  {'TIER':<8}  {'CONTRACT':<32}  {'PREMIUM':<9}  {'COST/CTR':<10}  {'DELTA':<7}  {'OTM%':<6}  {'EST UPSIDE'}")
    print("  " + "─" * 100)

    for i, item in enumerate(surfaced, 1):
        sc = item.get("smart_contract", {})
        if sc and "error" not in sc:
            icon = TIER_ICONS.get(item["tier"], "•")
            contract_str = f"{item['ticker']} {item['expiry']} ${sc['smart_strike']:.0f}{item['side'][0].upper()}"
            print(f"  {i:<3}  {item['ticker']:<7}  "
                  f"{icon} {item['tier']:<6}  "
                  f"{contract_str:<32}  "
                  f"${sc['smart_premium']:<8.2f}  "
                  f"${sc['smart_cost_per_contract']:<9.0f}  "
                  f"{sc['smart_delta']:<7.2f}  "
                  f"{sc['smart_otm_pct']:<6.1f}  "
                  f"+{sc['potential_gain_pct']:.0f}%")
        else:
            print(f"  {i:<3}  {item['ticker']:<7}  {item['tier']:<8}  (contract data unavailable)")

    print("\n  " + "─" * 100)
    print("  NOTE: Premiums are Black-Scholes estimates using UW-reported IV. Actual market prices will differ.")
    print("        Cost/contract = premium × 100 shares. Always check live bid/ask before entering.")
    print()


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    print("\n[pipeline] Importing SwingPipeline...")

    # Patch the UW service so it returns our mock data instead of calling the API
    mock_uw = MagicMock()
    mock_uw._available.return_value = True
    mock_uw.get_flow_alerts.return_value = MOCK_FLOWS

    # Also patch _fetch_technical to use our pre-computed values (avoids ARM64/numpy conflict locally;
    # on Railway the real yfinance call runs instead).
    from services.swing import swing_service

    def mock_fetch_technical(self, ticker):
        return MOCK_TECH.get(ticker, {"error": "no_mock_data", "trend": "unknown"})

    with patch("services.unusual_whales.unusual_whales_service.get_unusual_whales_service",
               return_value=mock_uw), \
         patch.object(swing_service.SwingPipeline, "_fetch_technical", mock_fetch_technical):

        pipeline = swing_service.SwingPipeline(supabase_client=None)  # no persistence

        print(f"[pipeline] Running with {len(MOCK_FLOWS)} mock UW flow alerts...")
        print(f"[pipeline] DTE filter: 30–90 days  (expiries between "
              f"{today + timedelta(days=30)} and {today + timedelta(days=90)})")
        print("[pipeline] Using pre-computed technical snapshots (yfinance mock — bypasses ARM64/numpy locally)")

        result = pipeline.run_pipeline(scan_date=today)

    print_result(result)

    # Also dump raw JSON for reference
    out_path = os.path.join(API_DIR, "scripts", "swing_pipeline_output.json")
    with open(out_path, "w") as f:
        json.dump(result, f, indent=2, default=str)
    print(f"\n  Full JSON output saved → {out_path}")
    print()


if __name__ == "__main__":
    main()
