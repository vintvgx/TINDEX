"""
Breakout Confirmation Service

Evaluates ORB breakouts with confidence scoring based on volume, VWAP alignment,
and range analysis.

Architecture:
- Separates breakout evaluation logic from notification system
- Provides structured scoring mechanism (0-100)
- Returns detailed metrics for enhanced notifications

Performance Considerations:
- Lightweight calculations for real-time processing
- Minimal external API calls
"""

from typing import Optional, Dict


class BreakoutConfirmation:
    """
    Evaluates ORB breakouts with confidence scoring based on volume, VWAP alignment,
    and range analysis.
    
    Architecture:
    - Separates breakout evaluation logic from notification system
    - Provides structured scoring mechanism (0-100)
    - Returns detailed metrics for enhanced notifications
    
    Performance Considerations:
    - Lightweight calculations for real-time processing
    - Minimal external API calls
    """
    
    def __init__(self, symbol: str, orb_high: float, orb_low: float):
        """
        Initialize breakout confirmation evaluator.
        
        Args:
            symbol: Stock ticker symbol
            orb_high: ORB high level
            orb_low: ORB low level
        """
        self.symbol = symbol
        self.orb_high = orb_high
        self.orb_low = orb_low
        self.orb_range = orb_high - orb_low
        
    def evaluate_breakout(
        self, 
        current_close: float,
        current_volume: int,
        avg_volume: int,
        vwap: float,
        atr: Optional[float] = None
    ) -> Dict:
        """
        Returns breakout signal with confidence metrics.
        
        Args:
            current_close: Current closing price
            current_volume: Current bar volume
            avg_volume: Average daily volume
            vwap: Volume-weighted average price
            atr: Average true range (optional)
            
        Returns:
            Dict with signal, score, confidence, reasons, and trading metrics
        """
        # Determine direction
        if current_close > self.orb_high:
            direction = "BULLISH"
            breakout_level = self.orb_high
        elif current_close < self.orb_low:
            direction = "BEARISH"
            breakout_level = self.orb_low
        else:
            return {"signal": None}
        
        # Calculate confirmations
        rvol = current_volume / avg_volume if avg_volume > 0 else 0
        vwap_aligned = (
            (direction == "BULLISH" and current_close > vwap) or
            (direction == "BEARISH" and current_close < vwap)
        )
        
        # Score the breakout (0-100)
        score = 0
        reasons = []
        
        # Volume confirmation (40 points max)
        if rvol >= 2.0:
            score += 40
            reasons.append(f"Strong volume ({rvol:.1f}x avg)")
        elif rvol >= 1.5:
            score += 30
            reasons.append(f"Good volume ({rvol:.1f}x avg)")
        elif rvol >= 1.0:
            score += 15
            reasons.append(f"Normal volume ({rvol:.1f}x avg)")
        else:
            reasons.append(f"⚠️ Weak volume ({rvol:.1f}x avg)")
        
        # VWAP alignment (30 points)
        if vwap_aligned:
            score += 30
            reasons.append("VWAP aligned")
        else:
            reasons.append("⚠️ VWAP divergence")
        
        # Range analysis (20 points)
        if atr and self.orb_range < 0.7 * atr:
            score += 20
            reasons.append("Tight ORB range")
        elif atr and self.orb_range > 1.3 * atr:
            score -= 10
            reasons.append("⚠️ Extended ORB range")
        else:
            score += 10
        
        # Clean break magnitude (10 points)
        break_magnitude = abs(current_close - breakout_level) / breakout_level
        if break_magnitude > 0.003:  # 0.3% beyond level
            score += 10
            reasons.append("Clean break")
        
        return {
            "signal": direction,
            "score": min(score, 100),
            "confidence": "HIGH" if score >= 70 else "MEDIUM" if score >= 50 else "LOW",
            "reasons": reasons,
            "rvol": rvol,
            "vwap_aligned": vwap_aligned,
            "entry_price": current_close,
            "stop_loss": self.orb_low if direction == "BULLISH" else self.orb_high,
            "risk_per_share": abs(current_close - (self.orb_low if direction == "BULLISH" else self.orb_high))
        }

