"""
Swing Trade discovery pipeline.

Stages:
  1. Fetch UW global flow alerts (abort if API key absent)
  2. Filter to swing-appropriate DTE (30–90 days)
  3. Deduplicate to one best entry per ticker (highest unusual_score)
  4. Fetch technical indicators per candidate (yfinance daily bars)
  5. Score (tech 0-100 + flow 0-100 → composite)
  6. Tier, cap at max_surfaced (≤20), persist to Supabase

All stage thresholds and weights are config-driven (swing_config table).
"""

import math
import time
import logging
from datetime import date, datetime, timedelta
from typing import Optional

logger = logging.getLogger(__name__)

# ── Black-Scholes helpers (pure Python, no numpy) ─────────────────────────────

_RISK_FREE_RATE = 0.0525  # ~current Fed funds rate


def _norm_cdf(x: float) -> float:
    return (1.0 + math.erf(x / math.sqrt(2.0))) / 2.0


def _bs_price(S: float, K: float, T: float, sigma: float, option_type: str = "call") -> float:
    """Black-Scholes option price. T in years."""
    if T <= 0 or sigma <= 0 or S <= 0 or K <= 0:
        return max(S - K, 0.0) if option_type == "call" else max(K - S, 0.0)
    r = _RISK_FREE_RATE
    d1 = (math.log(S / K) + (r + 0.5 * sigma ** 2) * T) / (sigma * math.sqrt(T))
    d2 = d1 - sigma * math.sqrt(T)
    if option_type == "call":
        return S * _norm_cdf(d1) - K * math.exp(-r * T) * _norm_cdf(d2)
    else:
        return K * math.exp(-r * T) * _norm_cdf(-d2) - S * _norm_cdf(-d1)


def _bs_delta(S: float, K: float, T: float, sigma: float, option_type: str = "call") -> float:
    """BS delta (directional probability proxy)."""
    if T <= 0 or sigma <= 0 or S <= 0 or K <= 0:
        return 1.0 if (option_type == "call" and S > K) else 0.0
    r = _RISK_FREE_RATE
    d1 = (math.log(S / K) + (r + 0.5 * sigma ** 2) * T) / (sigma * math.sqrt(T))
    return _norm_cdf(d1) if option_type == "call" else _norm_cdf(d1) - 1.0


def _strike_increment(price: float) -> float:
    """Standard options market strike grid by underlying price."""
    if price < 30:   return 0.50
    if price < 100:  return 2.50
    if price < 200:  return 5.0
    if price < 500:  return 10.0
    return 25.0


def _round_to_strike(target: float, increment: float) -> float:
    """Snap to the nearest strike on the standard grid."""
    return round(round(target / increment) * increment, 2)


# Extra strikes beyond the UW anchor to step further OTM, by tier.
_TIER_EXTRA_STEPS = {"Prime": 3, "Strong": 2, "Watch": 1}
_MIN_DELTA = 0.14   # below this the option is too far OTM for a swing
_MAX_OTM_PCT = 0.25 # never go more than 25% OTM regardless of tier

# ── Defaults (overridden by swing_config if available) ────────────────────────
_DEFAULT_CONFIG = {
    "tech_weight": 0.45,
    "flow_weight": 0.55,
    "tier_prime": 90,
    "tier_strong": 75,
    "tier_watch": 60,
    "dte_min": 30,
    "dte_max": 90,
    "max_surfaced": 20,
    "min_tech_score": 40,
}


def _load_config(sb) -> dict:
    """Load swing_config rows; fall back to defaults on any error."""
    cfg = dict(_DEFAULT_CONFIG)
    try:
        rows = sb.table("swing_config").select("key, value").execute().data or []
        for row in rows:
            key, val = row["key"], row["value"]
            if key == "stage_weights":
                cfg["tech_weight"] = val.get("tech_weight", cfg["tech_weight"])
                cfg["flow_weight"] = val.get("flow_weight", cfg["flow_weight"])
            elif key == "tier_cutoffs":
                cfg["tier_prime"] = val.get("prime", cfg["tier_prime"])
                cfg["tier_strong"] = val.get("strong", cfg["tier_strong"])
                cfg["tier_watch"] = val.get("watch", cfg["tier_watch"])
            elif key == "dte_range":
                cfg["dte_min"] = val.get("min", cfg["dte_min"])
                cfg["dte_max"] = val.get("max", cfg["dte_max"])
            elif key == "max_surfaced":
                cfg["max_surfaced"] = int(val) if isinstance(val, (int, float)) else cfg["max_surfaced"]
            elif key == "min_tech_score":
                cfg["min_tech_score"] = float(val) if isinstance(val, (int, float)) else cfg["min_tech_score"]
    except Exception as e:
        logger.warning("[SwingPipeline] Could not load swing_config from Supabase: %s — using defaults", e)
    return cfg


class SwingPipeline:
    def __init__(self, supabase_client=None):
        self._sb = supabase_client

    # ── Public entry ──────────────────────────────────────────────────────────

    def run_pipeline(self, scan_date: Optional[date] = None, limit: int = 20) -> dict:
        """
        Run the full discovery funnel.
        Returns {"success": bool, "surfaced": [...], "meta": {...}}.
        Aborts early (returns success=False) if UW API is unavailable.
        """
        t0 = time.time()
        scan_date = scan_date or date.today()
        limit = min(limit, 20)  # hard cap per spec
        errors = []

        cfg = _load_config(self._sb) if self._sb else dict(_DEFAULT_CONFIG)

        # ── Stage 1: fetch UW flows ───────────────────────────────────────────
        from services.unusual_whales.unusual_whales_service import get_unusual_whales_service
        uw_svc = get_unusual_whales_service()
        if not uw_svc._available():
            msg = "Unusual Whales API key not configured — swing pipeline aborted"
            logger.error("[SwingPipeline] %s", msg)
            duration = round(time.time() - t0, 2)
            self._persist(scan_date, [], [msg], 0, 0, 0, 0, 0, duration)
            return {"success": False, "error": msg, "surfaced": [], "meta": {}}

        raw_flows = self._fetch_uw_flows(uw_svc, limit=200)
        uw_count = len(raw_flows)
        logger.info("[SwingPipeline] UW returned %d raw flows", uw_count)

        # ── Stage 2: DTE filter ───────────────────────────────────────────────
        swing_flows = self._filter_swing_dte(raw_flows, scan_date, cfg["dte_min"], cfg["dte_max"])
        logger.info("[SwingPipeline] %d flows pass DTE filter (%d-%d)", len(swing_flows), cfg["dte_min"], cfg["dte_max"])

        # ── Stage 3: dedupe to best per ticker ───────────────────────────────
        candidates = self._best_per_ticker(swing_flows)
        logger.info("[SwingPipeline] %d unique tickers after dedupe", len(candidates))

        # ── Stage 4-5: technical + scoring ───────────────────────────────────
        # Pre-compute 80th percentile IV for the IV modifier
        ivs = [float(f.get("implied_volatility") or 0) for f in candidates]
        sorted_ivs = sorted(ivs)
        iv_80th = sorted_ivs[int(len(sorted_ivs) * 0.8)] if sorted_ivs else 9999.0

        scored = []
        for flow in candidates:
            ticker = flow.get("ticker", "")
            try:
                tech = self._fetch_technical(ticker)
                tech_score = self._technical_score(tech)
                flow_score = self._flow_score(flow, iv_80th)
                composite = self._composite(tech_score, flow_score, cfg["tech_weight"], cfg["flow_weight"])
                tier = self._assign_tier(composite, cfg)

                if tier is None or tech_score < cfg["min_tech_score"]:
                    continue  # below threshold — not surfaced

                vol = int(flow.get("volume") or 0)
                oi = int(flow.get("open_interest") or 0)
                vol_oi = round(vol / oi, 4) if oi > 0 else 0.0
                dollar_flow = float(flow.get("premium") or 0)
                iv = float(flow.get("implied_volatility") or 0)

                dte = self._calc_dte(flow.get("expiry"), scan_date) or 0
                smart = self._select_smart_contract(flow, tech, tier, dte)

                scored.append({
                    "contract_symbol": flow.get("contract_symbol", f"{ticker}_{flow.get('expiry','')}_{flow.get('strike','')}_{flow.get('contract_type','')}"),
                    "scan_date": str(scan_date),
                    "ticker": ticker,
                    "strike": float(flow.get("strike") or 0),
                    "expiry": flow.get("expiry"),
                    "side": flow.get("contract_type", ""),
                    "dte": dte,
                    "composite_score": composite,
                    "tier": tier,
                    "flow_score": round(flow_score, 1),
                    "setup_score": round(tech_score, 1),
                    "smart_contract": smart,
                    "breakdown": {
                        "tech": tech,
                        "tech_score": round(tech_score, 1),
                        "flow_score": round(flow_score, 1),
                        "vol_oi": vol_oi,
                        "dollar_flow": dollar_flow,
                        "is_sweep": flow.get("is_sweep", False),
                        "is_floor": flow.get("is_floor", False),
                        "aggressor": flow.get("side"),
                        "unusual_score_raw": flow.get("unusual_score"),
                        "iv_80th_threshold": round(iv_80th, 4),
                        "iv_penalized": iv > iv_80th,
                    },
                    "premium": float(flow.get("price") or 0),
                    "iv_pct": round(iv * 100, 2),
                    "vol": vol,
                    "oi": oi,
                    "vol_oi": vol_oi,
                    "dollar_flow": dollar_flow,
                    "pct_at_ask": 100.0 if flow.get("side") == "ask" else 0.0,
                    "is_sweep": flow.get("is_sweep", False),
                    "is_floor": flow.get("is_floor", False),
                    "unusual_score": float(flow.get("unusual_score") or 0),
                })
            except Exception as e:
                err_msg = f"{ticker}: {e}"
                logger.warning("[SwingPipeline] Scoring failed for %s: %s", ticker, e)
                errors.append(err_msg)

        # Sort by composite desc, cap at limit
        scored.sort(key=lambda x: x["composite_score"], reverse=True)
        surfaced = scored[:limit]

        duration = round(time.time() - t0, 2)
        logger.info("[SwingPipeline] Surfaced %d opportunities in %.1fs", len(surfaced), duration)

        # ── Stage 6: persist ──────────────────────────────────────────────────
        if self._sb:
            self._persist(scan_date, surfaced, errors, uw_count, len(swing_flows), len(candidates), len(scored), len(surfaced), duration)

        return {
            "success": True,
            "surfaced": surfaced,
            "meta": {
                "scan_date": str(scan_date),
                "uw_flows_raw": uw_count,
                "swing_eligible": len(swing_flows),
                "candidates": len(candidates),
                "scored": len(scored),
                "surfaced": len(surfaced),
                "duration_sec": duration,
            },
        }

    # ── Stage helpers ─────────────────────────────────────────────────────────

    def _fetch_uw_flows(self, uw_svc, limit: int = 200) -> list:
        return uw_svc.get_flow_alerts(limit=limit) or []

    def _filter_swing_dte(self, flows: list, scan_date: date, dte_min: int, dte_max: int) -> list:
        result = []
        for f in flows:
            expiry_str = f.get("expiry") or ""
            dte = self._calc_dte(expiry_str, scan_date)
            if dte is not None and dte_min <= dte <= dte_max:
                result.append(f)
        return result

    def _best_per_ticker(self, flows: list) -> list:
        best: dict = {}
        for f in flows:
            ticker = f.get("ticker", "")
            score = float(f.get("unusual_score") or 0)
            if ticker not in best or score > float(best[ticker].get("unusual_score") or 0):
                best[ticker] = f
        return list(best.values())

    def _fetch_technical(self, ticker: str) -> dict:
        from services.technical_service import get_technicals
        result = get_technicals(ticker)
        # Alias macd_above_signal → macd_turning_up for scoring compatibility
        if "macd_above_signal" in result and "macd_turning_up" not in result:
            result["macd_turning_up"] = result["macd_above_signal"]
        return result

    def _technical_score(self, tech: dict) -> float:
        if tech.get("error"):
            return 0.0
        score = 0.0
        if tech.get("ema_aligned"):
            score += 30
        trend = tech.get("trend", "unknown")
        if trend == "up":
            score += 25
        elif trend == "sideways":
            score += 8
        rsi = tech.get("rsi")
        if rsi is not None:
            if 40 <= rsi <= 65:
                score += 20
            elif 30 <= rsi < 40 or 65 < rsi <= 75:
                score += 10
            else:
                score += 0
        if tech.get("macd_turning_up"):
            score += 15
        else:
            score += 5
        dist = tech.get("dist_from_ema20_pct")
        if dist is not None and dist <= 3.0:
            score += 10
        return min(max(score, 0.0), 100.0)

    def _flow_score(self, flow: dict, iv_80th: float) -> float:
        score = 0.0
        vol = int(flow.get("volume") or 0)
        oi = int(flow.get("open_interest") or 0)
        vol_oi = vol / oi if oi > 0 else 0.0
        if vol_oi > 0.5:
            score += 20
        elif vol_oi > 0.2:
            score += 10
        dollar_flow = float(flow.get("premium") or 0)
        if dollar_flow > 500_000:
            score += 25
        elif dollar_flow > 100_000:
            score += 15
        elif dollar_flow > 50_000:
            score += 8
        if flow.get("side") == "ask":
            score += 20
        if flow.get("is_sweep") or flow.get("is_floor"):
            score += 20
        uw_score = float(flow.get("unusual_score") or 0)
        score += min(uw_score / 100 * 15, 15)
        iv = float(flow.get("implied_volatility") or 0)
        if iv > iv_80th:
            score -= 15
        return min(max(score, 0.0), 100.0)

    def _composite(self, tech: float, flow: float, w_tech: float, w_flow: float) -> float:
        return round(w_tech * tech + w_flow * flow, 1)

    def _assign_tier(self, score: float, cfg: dict) -> Optional[str]:
        if score >= cfg["tier_prime"]:
            return "Prime"
        if score >= cfg["tier_strong"]:
            return "Strong"
        if score >= cfg["tier_watch"]:
            return "Watch"
        return None

    def _calc_dte(self, expiry_str: Optional[str], from_date: date) -> Optional[int]:
        if not expiry_str:
            return None
        try:
            expiry = date.fromisoformat(str(expiry_str)[:10])
            return (expiry - from_date).days
        except Exception:
            return None

    # ── Smart contract selection ──────────────────────────────────────────────

    def _select_smart_contract(self, flow: dict, tech: dict, tier: str, dte: int) -> dict:
        """
        Suggest a retail-optimised contract: further OTM than the UW anchor for
        cheaper premium and higher % upside if the directional move plays out.

        Strategy:
          - The UW anchor strike is what institutions buy (near-ATM, high delta).
          - Retail gets better risk/reward by stepping OTM: cheaper cost per contract,
            same DTE, higher % gain if the stock reaches the target.
          - We step extra_strikes beyond the anchor, then walk back in if the resulting
            delta falls below _MIN_DELTA (too far OTM = lottery ticket).
          - Returns the anchor data too so callers can compare both contracts.
        """
        S = float(tech.get("current_price") or 0)
        anchor_K = float(flow.get("strike") or 0)
        sigma = float(flow.get("implied_volatility") or 0.40)
        option_type = flow.get("contract_type", "call")
        T = max(dte / 365.0, 1 / 365.0)

        if S <= 0 or anchor_K <= 0:
            return {"error": "missing_price_data"}

        inc = _strike_increment(S)
        extra_steps = _TIER_EXTRA_STEPS.get(tier, 1)

        # Step further OTM from anchor
        direction = 1 if option_type == "call" else -1
        smart_K = _round_to_strike(anchor_K + direction * extra_steps * inc, inc)

        # Walk back towards anchor if delta drops below minimum
        while extra_steps > 0:
            delta = _bs_delta(S, smart_K, T, sigma, option_type)
            if abs(delta) >= _MIN_DELTA:
                break
            extra_steps -= 1
            smart_K = _round_to_strike(anchor_K + direction * extra_steps * inc, inc)

        # Hard cap: never go more than _MAX_OTM_PCT from current price
        max_smart_K = S * (1 + _MAX_OTM_PCT) if option_type == "call" else S * (1 - _MAX_OTM_PCT)
        if option_type == "call":
            smart_K = min(smart_K, _round_to_strike(max_smart_K, inc))
        else:
            smart_K = max(smart_K, _round_to_strike(max_smart_K, inc))

        # Compute prices and deltas
        anchor_price  = _bs_price(S, anchor_K, T, sigma, option_type)
        smart_price   = _bs_price(S, smart_K, T, sigma, option_type)
        anchor_delta  = _bs_delta(S, anchor_K, T, sigma, option_type)
        smart_delta   = _bs_delta(S, smart_K, T, sigma, option_type)

        # Upside scenario: stock reaches the 1-standard-deviation BS implied move by expiry.
        # This is what IV "expects" is possible — a more honest target than the anchor strike
        # (which may still leave the smart contract OTM).
        # For calls: target = S + S * sigma * sqrt(T)  (1-sigma up move)
        # For puts:  target = S - S * sigma * sqrt(T)  (1-sigma down move)
        implied_move = S * sigma * math.sqrt(T)
        if option_type == "call":
            target_price = S + implied_move
        else:
            target_price = max(S - implied_move, 0.01)

        # Price the smart contract at the target, with half the DTE remaining
        gain_scenario_price = _bs_price(target_price, smart_K, T * 0.5, sigma * 0.9, option_type)
        smart_contract_cost  = smart_price * 100
        anchor_contract_cost = anchor_price * 100
        potential_gain_amt   = max(gain_scenario_price - smart_price, 0) * 100
        potential_gain_pct   = (potential_gain_amt / smart_contract_cost * 100) if smart_contract_cost > 0 else 0

        otm_pct = abs(smart_K - S) / S * 100
        savings_pct = ((anchor_price - smart_price) / anchor_price * 100) if anchor_price > 0 else 0

        # Build a plain-English rationale
        rationale_parts = [
            f"UW flagged the ${anchor_K:.0f}{option_type[0].upper()} (${anchor_price:.2f} = ${anchor_contract_cost:.0f}/contract, delta {abs(anchor_delta):.2f}).",
            f"Stepping {extra_steps} strike{'s' if extra_steps != 1 else ''} further OTM → ${smart_K:.0f}{option_type[0].upper()} (${smart_price:.2f} = ${smart_contract_cost:.0f}/contract) — {savings_pct:.0f}% cheaper.",
            f"Delta {abs(smart_delta):.2f} keeps this directional, not a lottery ticket.",
            f"IV implies {flow.get('ticker','')} could reach ~${target_price:.0f} by expiry (1-sigma move); at that price this contract est. +{potential_gain_pct:.0f}% (${potential_gain_amt:.0f}/contract).",
        ]

        return {
            "anchor_strike":        anchor_K,
            "anchor_premium":       round(anchor_price, 2),
            "anchor_cost_per_contract": round(anchor_contract_cost, 2),
            "anchor_delta":         round(abs(anchor_delta), 3),
            "smart_strike":         smart_K,
            "smart_premium":        round(smart_price, 2),
            "smart_cost_per_contract": round(smart_contract_cost, 2),
            "smart_delta":          round(abs(smart_delta), 3),
            "smart_otm_pct":        round(otm_pct, 1),
            "extra_steps_taken":    extra_steps,
            "potential_gain_pct":   round(potential_gain_pct, 1),
            "potential_gain_amt":   round(potential_gain_amt, 2),
            "savings_vs_anchor":    round(anchor_contract_cost - smart_contract_cost, 2),
            "rationale":            " ".join(rationale_parts),
        }

    # ── Persistence ───────────────────────────────────────────────────────────

    def _persist(self, scan_date, surfaced, errors, uw_raw, swing_elig, candidates, scored_count, surfaced_count, duration):
        if not self._sb:
            return
        try:
            for item in surfaced:
                self._sb.table("swing_scores").upsert(
                    {k: v for k, v in item.items()},
                    on_conflict="contract_symbol,scan_date",
                ).execute()
        except Exception as e:
            logger.error("[SwingPipeline] Failed to persist swing_scores: %s", e)

        try:
            self._sb.table("swing_run_logs").insert({
                "scan_date": str(scan_date),
                "uw_flows_raw": uw_raw,
                "swing_eligible": swing_elig,
                "candidates": candidates,
                "scored": scored_count,
                "surfaced": surfaced_count,
                "errors": errors or None,
                "duration_sec": duration,
            }).execute()
        except Exception as e:
            logger.error("[SwingPipeline] Failed to persist swing_run_logs: %s", e)
