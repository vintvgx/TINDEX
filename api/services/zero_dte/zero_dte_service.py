"""
0DTE intraday options watchlist scanner.

Runs 5× per market day (9:45, 10:30, 11:30, 12:30, 13:30 ET) to surface
high-conviction same-day options plays from UW flow. Covers ETFs and major
single stocks with active 0DTE markets.

Scoring: 75% flow, 25% intraday context (VWAP + 5-min trend).
"""

import time
import logging
from datetime import date, datetime
from typing import Optional

import pytz

logger = logging.getLogger(__name__)
ET = pytz.timezone("America/New_York")

ZERO_DTE_UNIVERSE = {
    "SPY", "QQQ", "IWM",
    "NVDA", "TSLA", "AAPL", "AMZN", "META", "MSFT",
    "AMD", "GOOGL", "PLTR", "COIN", "JPM",
}

_FLOW_WEIGHT  = 0.75
_TECH_WEIGHT  = 0.25
_TIER_FIRE    = 85.0
_TIER_SET     = 70.0
_TIER_WATCH   = 55.0
_MAX_RESULTS  = 20
_LAST_ENTRY_H = 14   # no new entries after 2 PM ET


class ZeroDTEScanner:

    def __init__(self, supabase_client=None):
        self._sb = supabase_client

    # ── Public ────────────────────────────────────────────────────────────────

    def run_scan(self, scan_time: Optional[datetime] = None) -> dict:
        now_et    = datetime.now(ET)
        scan_time = scan_time or now_et
        today     = date.today()

        if now_et.hour >= _LAST_ENTRY_H:
            logger.info("[ZeroDTE] Scan skipped — past 2 PM ET last-entry window")
            return {"success": True, "surfaced": [], "skipped": True, "reason": "past_last_entry", "meta": {}}

        from services.unusual_whales.unusual_whales_service import get_unusual_whales_service
        uw_svc = get_unusual_whales_service()
        if not uw_svc._available():
            return {"success": False, "error": "UW API unavailable", "surfaced": []}

        t0        = time.time()
        raw_flows = uw_svc.get_flow_alerts(limit=300) or []

        # Filter: same-day expiry only
        zero_dte_flows = [f for f in raw_flows if f.get("expiry") == str(today)]

        # Filter: our universe, dedupe by ticker+strike+side
        candidates = self._filter_candidates(zero_dte_flows)

        # 80th-pct IV for penalty calculation
        ivs     = sorted(float(f.get("implied_volatility") or 0) for f in candidates)
        iv_80th = ivs[int(len(ivs) * 0.8)] if ivs else 9999.0

        market_close      = now_et.replace(hour=16, minute=0, second=0, microsecond=0)
        minutes_remaining = max(0, int((market_close - now_et).total_seconds() / 60))
        time_penalty      = self._time_penalty(now_et)

        scored = []
        for flow in candidates:
            try:
                ticker        = (flow.get("ticker") or "").upper()
                contract_type = flow.get("contract_type", "call")

                flow_score            = self._flow_score(flow, iv_80th)
                intraday_score, intra = self._intraday_score(ticker, contract_type)
                adjusted_flow         = max(0.0, flow_score - time_penalty)
                composite             = _FLOW_WEIGHT * adjusted_flow + _TECH_WEIGHT * intraday_score
                tier                  = self._assign_tier(composite)
                if tier is None:
                    continue

                strike        = float(flow.get("strike") or 0)
                current_price = intra.get("current_price") or 0
                otm_pct       = abs(strike - current_price) / current_price * 100 if current_price else 0

                scored.append({
                    "ticker":            ticker,
                    "contract_type":     contract_type,
                    "strike":            strike,
                    "expiry":            str(today),
                    "composite_score":   round(composite, 1),
                    "tier":              tier,
                    "flow_score":        round(adjusted_flow, 1),
                    "raw_flow_score":    round(flow_score, 1),
                    "intraday_score":    round(intraday_score, 1),
                    "time_penalty":      time_penalty,
                    "dollar_flow":       float(flow.get("premium") or 0),
                    "vol_oi":            self._vol_oi(flow),
                    "is_sweep":          bool(flow.get("is_sweep")),
                    "is_floor":          bool(flow.get("is_floor")),
                    "aggressor":         flow.get("side"),
                    "uw_score":          float(flow.get("unusual_score") or 0),
                    "current_price":     current_price,
                    "vwap":              intra.get("vwap"),
                    "above_vwap":        intra.get("above_vwap"),
                    "trend_aligned":     intra.get("trend_aligned"),
                    "iv_pct":            round(float(flow.get("implied_volatility") or 0) * 100, 1),
                    "otm_pct":           round(otm_pct, 1),
                    "premium":           float(flow.get("price") or 0),
                    "volume":            int(flow.get("volume") or 0),
                    "open_interest":     int(flow.get("open_interest") or 0),
                    "minutes_remaining": minutes_remaining,
                    "scan_time":         scan_time.isoformat(),
                    "scan_date":         str(today),
                })
            except Exception as e:
                logger.warning("[ZeroDTE] Scoring failed for %s: %s", flow.get("ticker"), e)

        surfaced = sorted(scored, key=lambda x: x["composite_score"], reverse=True)[:_MAX_RESULTS]
        duration = round(time.time() - t0, 2)

        logger.info(
            "[ZeroDTE] %d raw → %d 0DTE → %d candidates → %d surfaced in %ss",
            len(raw_flows), len(zero_dte_flows), len(candidates), len(surfaced), duration,
        )

        if self._sb and surfaced:
            self._persist(surfaced)

        return {
            "success":  True,
            "surfaced": surfaced,
            "skipped":  False,
            "meta": {
                "scan_time":         scan_time.isoformat(),
                "scan_date":         str(today),
                "uw_flows_raw":      len(raw_flows),
                "zero_dte_flows":    len(zero_dte_flows),
                "candidates":        len(candidates),
                "surfaced":          len(surfaced),
                "minutes_remaining": minutes_remaining,
                "time_penalty":      time_penalty,
                "duration_sec":      duration,
            },
        }

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _filter_candidates(self, flows: list) -> list:
        out, seen = [], set()
        for f in flows:
            ticker = (f.get("ticker") or "").upper()
            if ticker not in ZERO_DTE_UNIVERSE:
                continue
            key = f"{ticker}_{f.get('strike')}_{f.get('contract_type')}"
            if key in seen:
                continue
            seen.add(key)
            out.append(f)
        return out

    def _flow_score(self, flow: dict, iv_80th: float) -> float:
        score = 0.0
        if flow.get("is_sweep"):
            score += 30
        elif flow.get("is_floor"):
            score += 20
        dollar = float(flow.get("premium") or 0)
        if dollar >= 500_000:   score += 25
        elif dollar >= 200_000: score += 15
        elif dollar >= 100_000: score += 8
        if flow.get("side") == "ask":
            score += 20
        vol_oi = self._vol_oi(flow)
        if vol_oi >= 1.0:   score += 15
        elif vol_oi >= 0.5: score += 10
        uw = float(flow.get("unusual_score") or 0)
        score += (uw / 100) * 10
        iv = float(flow.get("implied_volatility") or 0)
        if iv > iv_80th and iv_80th < 9999:
            score -= 10
        return min(max(score, 0.0), 100.0)

    def _intraday_score(self, ticker: str, contract_type: str) -> tuple:
        try:
            import yfinance as yf

            hist = yf.Ticker(ticker).history(period="1d", interval="5m")
            if hist.empty or len(hist) < 3:
                return 0.0, {}

            close   = hist["Close"]
            volume  = hist["Volume"]
            current = float(close.iloc[-1])

            typical = (hist["High"] + hist["Low"] + hist["Close"]) / 3
            vwap    = float((typical * volume).cumsum().iloc[-1] / volume.cumsum().iloc[-1])

            above_vwap    = current > vwap
            recent        = close.iloc[-5:].tolist()
            trending_up   = recent[-1] > recent[0]
            trend_aligned = (
                (contract_type == "call" and trending_up) or
                (contract_type == "put" and not trending_up)
            )
            vwap_aligned  = (
                (contract_type == "call" and above_vwap) or
                (contract_type == "put" and not above_vwap)
            )

            score = 0.0
            if vwap_aligned:  score += 15
            if trend_aligned: score += 10

            return score, {
                "current_price": round(current, 4),
                "vwap":          round(vwap, 4),
                "above_vwap":    above_vwap,
                "trend_aligned": trend_aligned,
            }
        except Exception as e:
            logger.debug("[ZeroDTE] Intraday data failed for %s: %s", ticker, e)
            return 0.0, {}

    def _time_penalty(self, now_et: datetime) -> float:
        t = now_et.hour + now_et.minute / 60.0
        if t < 11.0: return 0.0
        if t < 12.0: return 5.0
        if t < 13.0: return 10.0
        return 15.0

    def _assign_tier(self, score: float) -> Optional[str]:
        if score >= _TIER_FIRE:  return "FIRE"
        if score >= _TIER_SET:   return "SET"
        if score >= _TIER_WATCH: return "WATCH"
        return None

    def _vol_oi(self, flow: dict) -> float:
        vol = int(flow.get("volume") or 0)
        oi  = max(int(flow.get("open_interest") or 1), 1)
        return round(vol / oi, 4)

    def _persist(self, surfaced: list):
        try:
            rows = [{k: v for k, v in item.items()
                     if k in {
                         "scan_date", "scan_time", "ticker", "contract_type", "strike",
                         "expiry", "composite_score", "tier", "flow_score", "intraday_score",
                         "dollar_flow", "vol_oi", "is_sweep", "is_floor", "uw_score",
                         "current_price", "vwap", "above_vwap", "iv_pct", "otm_pct",
                         "premium", "minutes_remaining",
                     }} for item in surfaced]
            self._sb.table("zero_dte_watchlist").insert(rows).execute()
            logger.info("[ZeroDTE] Persisted %d rows", len(rows))
        except Exception as e:
            logger.error("[ZeroDTE] Persist failed: %s", e)


_scanner_instance: Optional[ZeroDTEScanner] = None


def get_zero_dte_scanner(supabase_client=None) -> ZeroDTEScanner:
    global _scanner_instance
    if _scanner_instance is None:
        _scanner_instance = ZeroDTEScanner(supabase_client)
    elif supabase_client is not None and _scanner_instance._sb is None:
        # Adopt a client if the instance was first created without one,
        # otherwise persistence would silently never happen.
        _scanner_instance._sb = supabase_client
    return _scanner_instance
