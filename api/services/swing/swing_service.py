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

import time
import logging
from datetime import date, datetime, timedelta
from typing import Optional

logger = logging.getLogger(__name__)

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

                scored.append({
                    "contract_symbol": flow.get("contract_symbol", f"{ticker}_{flow.get('expiry','')}_{flow.get('strike','')}_{flow.get('contract_type','')}"),
                    "scan_date": str(scan_date),
                    "ticker": ticker,
                    "strike": float(flow.get("strike") or 0),
                    "expiry": flow.get("expiry"),
                    "side": flow.get("contract_type", ""),
                    "dte": self._calc_dte(flow.get("expiry"), scan_date),
                    "composite_score": composite,
                    "tier": tier,
                    "flow_score": round(flow_score, 1),
                    "setup_score": round(tech_score, 1),
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
        try:
            import yfinance as yf
            import pandas as pd

            hist = yf.Ticker(ticker).history(period="60d", interval="1d")
            if hist.empty or len(hist) < 20:
                return {"error": "insufficient_history", "trend": "unknown"}

            close = hist["Close"]

            ema20 = close.ewm(span=20, adjust=False).mean().iloc[-1]
            ema50 = close.ewm(span=50, adjust=False).mean().iloc[-1] if len(close) >= 50 else None
            ema200 = close.ewm(span=200, adjust=False).mean().iloc[-1] if len(close) >= 200 else None
            current = float(close.iloc[-1])

            # RSI 14
            delta = close.diff()
            gain = delta.clip(lower=0).rolling(14).mean()
            loss = (-delta.clip(upper=0)).rolling(14).mean()
            rs = gain / loss.replace(0, float("nan"))
            rsi = float(100 - 100 / (1 + rs.iloc[-1]))

            # MACD (12, 26, 9)
            ema12 = close.ewm(span=12, adjust=False).mean()
            ema26 = close.ewm(span=26, adjust=False).mean()
            macd_line = ema12 - ema26
            signal_line = macd_line.ewm(span=9, adjust=False).mean()
            macd_turning_up = float(macd_line.iloc[-1]) > float(signal_line.iloc[-1])

            # ATR 14
            high = hist["High"]
            low = hist["Low"]
            tr = pd.concat([
                high - low,
                (high - close.shift()).abs(),
                (low - close.shift()).abs(),
            ], axis=1).max(axis=1)
            atr = float(tr.rolling(14).mean().iloc[-1])

            # EMA stacking
            ema_aligned = current > float(ema20)
            if ema50 is not None:
                ema_aligned = ema_aligned and float(ema20) > float(ema50)
            if ema200 is not None:
                ema_aligned = ema_aligned and (float(ema50 or ema20) > float(ema200))

            # Trend structure (simple: last 10 closes trending)
            recent = close.iloc[-10:].tolist()
            highs_rising = recent[-1] > recent[0]
            trend = "up" if ema_aligned and highs_rising else "sideways" if not ema_aligned and highs_rising else "down"

            # Distance from 20 EMA as %
            dist_from_ema20_pct = abs(current - float(ema20)) / float(ema20) * 100

            return {
                "current_price": round(current, 4),
                "ema20": round(float(ema20), 4),
                "ema50": round(float(ema50), 4) if ema50 is not None else None,
                "ema200": round(float(ema200), 4) if ema200 is not None else None,
                "rsi": round(rsi, 2),
                "macd_turning_up": macd_turning_up,
                "atr": round(atr, 4),
                "trend": trend,
                "ema_aligned": ema_aligned,
                "dist_from_ema20_pct": round(dist_from_ema20_pct, 2),
            }
        except Exception as e:
            logger.warning("[SwingPipeline] Technical fetch failed for %s: %s", ticker, e)
            return {"error": str(e), "trend": "unknown"}

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
