# services/options_analyzer.py
import pandas as pd
import numpy as np
import yfinance as yf
from datetime import datetime, timedelta
from typing import Optional, Dict, List, Union
from log.logging_config import get_logger

logger = get_logger(__name__)


class OptionsAnalyzer:
    """Analyze options contracts using existing research data."""
    
    def __init__(self, research_data: Dict, ticker: Optional[yf.Ticker] = None):
        """
        Initialize the analyzer with research data and optional ticker.
        
        Args:
            research_data: Dict containing stock research data including current_price, ticker, etc.
            ticker: Optional existing yfinance Ticker object (passed from research function)
        """
        self.research_data = research_data
        self.symbol = research_data.get('ticker')
        self.current_price = research_data.get('current_price')
        self.ticker = ticker or yf.Ticker(self.symbol)
        self.options_df = None
        self.scored_df = None
        
        # Extract other useful data from research
        self.volatility = research_data.get('beta', 1.0)
        self.volume = research_data.get('volume', 0)
        self.avg_volume = research_data.get('average_volume', 0)
        self.price_change_pct = research_data.get('price_change_percent', 0)
        self.sentiment_score = research_data.get('sentiment_score', 0)
        
        logger.info(f"Initialized OptionsAnalyzer for {self.symbol} with price ${self.current_price}")
            
    def fetch_options_chain(self, max_expirations: int = 5) -> pd.DataFrame:
        """
        Fetch options chain with Greeks and calculate additional metrics.
        
        Args:
            max_expirations: Maximum number of expiration dates to analyze
            
        Returns:
            DataFrame with all options data
        """
        try:
            options = pd.DataFrame()
            expirations = self.ticker.options[:max_expirations] if self.ticker.options else []
            
            if not expirations:
                logger.warning(f"No options available for {self.symbol}")
                return pd.DataFrame()
            
            for exp in expirations:
                try:
                    opt = self.ticker.option_chain(exp)
                    
                    # Process calls
                    calls = opt.calls.copy()
                    calls['optionType'] = 'CALL'
                    
                    # Process puts
                    puts = opt.puts.copy()
                    puts['optionType'] = 'PUT'
                    
                    # Combine
                    exp_options = pd.concat([calls, puts], ignore_index=True)
                    exp_options['expirationDate'] = exp
                    options = pd.concat([options, exp_options], ignore_index=True)
                    
                except Exception as e:
                    logger.warning(f"Error fetching options for expiration {exp}: {e}")
                    continue
            
            if options.empty:
                logger.warning(f"No options data found for {self.symbol}")
                return pd.DataFrame()
            
            # Calculate additional metrics using research data
            options['expirationDate'] = pd.to_datetime(options['expirationDate'])
            options['dte'] = (options['expirationDate'] - pd.Timestamp.now()).dt.days
            options['mark'] = (options['bid'] + options['ask']) / 2
            options['spread'] = options['ask'] - options['bid']
            options['spreadPct'] = np.where(
                options['mark'] > 0,
                (options['spread'] / options['mark']) * 100,
                0
            )
            
            if self.current_price:
                options['moneyness'] = options['strike'] / self.current_price
                
                # Calculate intrinsic and extrinsic value
                options['intrinsicValue'] = np.where(
                    options['optionType'] == 'CALL',
                    np.maximum(self.current_price - options['strike'], 0),
                    np.maximum(options['strike'] - self.current_price, 0)
                )
                options['extrinsicValue'] = options['mark'] - options['intrinsicValue']
                
                # Add momentum factor based on price change
                options['momentum_factor'] = self._calculate_momentum_factor(options)
            else:
                options['moneyness'] = 1
                options['intrinsicValue'] = 0
                options['extrinsicValue'] = options['mark']
                options['momentum_factor'] = 0

            # Adjust spreadPct calculation to handle invalid quotes. Uses 100
            # (worst-case spread, matching the fillna(100) fallback already
            # used when scoring this column) instead of NaN — NaN survives
            # into the final API response as the bare JSON token `NaN`,
            # which is invalid per RFC 8259: JS's JSON.parse throws on it,
            # so the whole /ticker/<ticker> response silently failed to
            # parse client-side for any ticker whose top-10 scored
            # opportunities included one illiquid (zero bid or ask) contract.
            options['spreadPct'] = np.where(
                (options['bid'] > 0) & (options['ask'] > 0) & (options['mark'] > 0),
                (options['spread'] / options['mark']) * 100,
                100.0
            )
            
            self.options_df = options
            return options
            
        except Exception as e:
            logger.error(f"Error fetching options chain for {self.symbol}: {e}")
            return pd.DataFrame()
    
    def _calculate_momentum_factor(self, df: pd.DataFrame) -> pd.Series:
        """Calculate momentum factor based on research data."""
        momentum = pd.Series(0, index=df.index)
        
        # Use price change from research data
        if self.price_change_pct > 2:  # Bullish momentum
            # Favor calls and OTM calls especially
            call_mask = df['optionType'] == 'CALL'
            momentum[call_mask] = 1 + (self.price_change_pct / 100)
            
            # Extra boost for slightly OTM calls
            otm_calls = call_mask & (df['moneyness'] > 1.0) & (df['moneyness'] < 1.1)
            momentum[otm_calls] *= 1.2
            
        elif self.price_change_pct < -2:  # Bearish momentum
            # Favor puts and OTM puts especially
            put_mask = df['optionType'] == 'PUT'
            momentum[put_mask] = 1 + (abs(self.price_change_pct) / 100)
            
            # Extra boost for slightly OTM puts
            otm_puts = put_mask & (df['moneyness'] < 1.0) & (df['moneyness'] > 0.9)
            momentum[otm_puts] *= 1.2
            
        return momentum
    
    def calculate_scores(self) -> pd.DataFrame:
        """
        Calculate comprehensive scores for each option using research data.
        
        Returns:
            DataFrame with scored options
        """
        if self.options_df is None or self.options_df.empty:
            logger.warning("No options data to score")
            return pd.DataFrame()
            
        df = self.options_df.copy()
        
        # Initialize score components
        df['volume_score'] = self._calculate_volume_score(df)
        df['liquidity_score'] = self._calculate_liquidity_score(df)
        df['greek_score'] = self._calculate_greek_score(df)
        df['value_score'] = self._calculate_value_score(df)
        df['momentum_score'] = self._calculate_momentum_score(df)  # New: uses research data
        df['sentiment_score'] = self._calculate_sentiment_based_score(df)  # New: uses sentiment
        
        # Calculate total score with weights
        df['total_score'] = (
            df['volume_score'] * 1.0 +
            df['liquidity_score'] * 1.0 + 
            df['greek_score'] * 1.0 +
            df['value_score'] * 1.0 +
            df['momentum_score'] * 0.5 +  # Half weight for momentum
            df['sentiment_score'] * 0.5    # Half weight for sentiment
        )
        
        # Apply momentum factor to total score
        df['total_score'] *= (1 + df.get('momentum_factor', 0) * 0.1)
        
        # Determine action signal
        df['signal'] = df['total_score'].apply(self._determine_signal)
        df['signal_color'] = df['signal'].map({
            'BUY': 'GREEN',
            'CONSIDER': 'YELLOW', 
            'AVOID': 'RED'
        })
        
        # Add recommendation reasons
        df['reasons'] = df.apply(self._generate_reasons, axis=1)
        
        self.scored_df = df
        return df
    
    def _calculate_momentum_score(self, df: pd.DataFrame) -> pd.Series:
        """Calculate momentum score based on research data."""
        scores = pd.Series(0, index=df.index)
        
        # Strong bullish momentum
        if self.price_change_pct > 3:
            call_mask = df['optionType'] == 'CALL'
            scores[call_mask] += 10
            
            # Bonus for near-the-money calls
            ntm_calls = call_mask & (df['moneyness'] > 0.95) & (df['moneyness'] < 1.05)
            scores[ntm_calls] += 5
            
        # Strong bearish momentum
        elif self.price_change_pct < -3:
            put_mask = df['optionType'] == 'PUT'
            scores[put_mask] += 10
            
            # Bonus for near-the-money puts
            ntm_puts = put_mask & (df['moneyness'] > 0.95) & (df['moneyness'] < 1.05)
            scores[ntm_puts] += 5
            
        # Volume spike from research data
        if self.volume and self.avg_volume:
            volume_ratio = self.volume / self.avg_volume
            if volume_ratio > 1.5:  # 50% above average
                scores += 3
            if volume_ratio > 2.0:  # 100% above average
                scores += 2
                
        return scores
    
    def _calculate_sentiment_based_score(self, df: pd.DataFrame) -> pd.Series:
        """Calculate score based on sentiment from research data."""
        scores = pd.Series(0, index=df.index)
        
        if self.sentiment_score:
            if self.sentiment_score >= 2:  # Bullish sentiment
                call_mask = df['optionType'] == 'CALL'
                scores[call_mask] += 5 * min(self.sentiment_score / 4, 1)
                
            elif self.sentiment_score <= -2:  # Bearish sentiment
                put_mask = df['optionType'] == 'PUT'
                scores[put_mask] += 5 * min(abs(self.sentiment_score) / 4, 1)
                
        # Adjust for volatility (beta)
        if self.volatility:
            if self.volatility > 1.2:  # High beta stocks
                # Favor options with more time value
                high_extrinsic = df['extrinsicValue'] > df['intrinsicValue']
                scores[high_extrinsic] += 3
                
        return scores
    
    def _calculate_volume_score(self, df: pd.DataFrame) -> pd.Series:
        """Calculate score based on volume and open interest."""
        scores = pd.Series(0, index=df.index)
        
        # Handle missing values
        df['volume'] = df['volume'].fillna(0)
        df['openInterest'] = df['openInterest'].fillna(0)
        
        # Volume relative to open interest
        df['vol_oi_ratio'] = np.where(
            df['openInterest'] > 0,
            df['volume'] / df['openInterest'],
            0
        )
        
        # Compare to stock volume if available
        if self.volume and self.volume > 0:
            # Options volume as percentage of stock volume
            df['opt_stock_vol_ratio'] = df['volume'] / self.volume
            scores += np.where(df['opt_stock_vol_ratio'] > 0.001, 3, 0)  # >0.1% of stock volume
            scores += np.where(df['opt_stock_vol_ratio'] > 0.005, 2, 0)  # >0.5% of stock volume
        
        # High volume gets points
        scores += np.where(df['volume'] > 100, 5, 0)
        scores += np.where(df['volume'] > 500, 5, 0)
        scores += np.where(df['volume'] > 1000, 5, 0)
        
        # High open interest gets points
        scores += np.where(df['openInterest'] > 100, 3, 0)
        scores += np.where(df['openInterest'] > 500, 2, 0)
        
        # Good volume/OI ratio (unusual activity)
        scores += np.where(df['vol_oi_ratio'] > 0.5, 3, 0)
        
        return scores
    
    def _calculate_liquidity_score(self, df: pd.DataFrame) -> pd.Series:
        """Calculate score based on bid-ask spread."""
        scores = pd.Series(0, index=df.index)
        
        # Tight spreads are better
        spread_pct = df['spreadPct'].fillna(100)
        scores += np.where(spread_pct < 5, 10, 0)
        scores += np.where(spread_pct < 3, 5, 0)
        scores += np.where(spread_pct < 2, 5, 0)
        scores -= np.where(spread_pct > 10, 5, 0)
        
        # Penalize wide spreads
        scores -= np.where(df['spreadPct'] > 10, 5, 0)
        
        # Minimum bid size
        scores += np.where(df['bid'] > 0.05, 5, 0)
        
        return np.maximum(scores, 0)
    
    def _calculate_greek_score(self, df: pd.DataFrame) -> pd.Series:
        """Calculate score based on Greeks analysis."""
        scores = pd.Series(0, index=df.index)
        
        # Check if Greeks columns exist
        if 'delta' not in df.columns:
            logger.debug("Greeks not available for scoring")
            return scores
        
        # Handle missing Greeks
        for greek in ['delta', 'gamma', 'theta', 'vega']:
            if greek not in df.columns:
                df[greek] = 0
        
        # Adjust Greek scoring based on market conditions from research data
        momentum_adjustment = 1 + (abs(self.price_change_pct) / 100)
        
        # For CALLS
        call_mask = df['optionType'] == 'CALL'
        
        # Delta sweet spot for calls (0.3 - 0.7)
        scores.loc[call_mask] += np.where(
            (df.loc[call_mask, 'delta'] > 0.3) & (df.loc[call_mask, 'delta'] < 0.7), 
            8 * momentum_adjustment, 0
        )
        
        # Gamma for momentum
        scores.loc[call_mask] += np.where(df.loc[call_mask, 'gamma'] > 0.01, 5, 0)
        
        # Vega for volatility plays (higher weight if beta is high)
        vega_multiplier = 1 + (self.volatility - 1) if self.volatility > 1 else 1
        scores.loc[call_mask] += np.where(df.loc[call_mask, 'vega'] > 0, 4 * vega_multiplier, 0)
        
        # Theta decay
        scores.loc[call_mask] += np.where(df.loc[call_mask, 'theta'] > -0.05, 4, 0)
        
        # For PUTS
        put_mask = df['optionType'] == 'PUT'
        
        # Delta sweet spot for puts (-0.3 to -0.7)
        scores.loc[put_mask] += np.where(
            (df.loc[put_mask, 'delta'] < -0.3) & (df.loc[put_mask, 'delta'] > -0.7), 
            8 * momentum_adjustment, 0
        )
        
        scores.loc[put_mask] += np.where(df.loc[put_mask, 'gamma'] > 0.01, 5, 0)
        scores.loc[put_mask] += np.where(df.loc[put_mask, 'vega'] > 0, 4 * vega_multiplier, 0)
        scores.loc[put_mask] += np.where(df.loc[put_mask, 'theta'] > -0.05, 4, 0)
        
        # IV consideration
        if 'impliedVolatility' in df.columns:
            scores += np.where(df['impliedVolatility'] < 0.5, 4, 0)
        
        return scores
    
    def _calculate_value_score(self, df: pd.DataFrame) -> pd.Series:
        """Calculate score based on value metrics."""
        scores = pd.Series(0, index=df.index)
        
        if self.current_price:
            # Calculate potential return
            df['potential_return'] = np.where(
                df['optionType'] == 'CALL',
                np.where(df['mark'] > 0, 
                        (df['strike'] * 1.05 - self.current_price) / df['mark'], 
                        0),
                np.where(df['mark'] > 0, 
                        (self.current_price - df['strike'] * 0.95) / df['mark'], 
                        0)
            )
            
            scores += np.where(df['potential_return'] > 1, 10, 0)
            scores += np.where(df['potential_return'] > 2, 5, 0)
        
        # Optimal DTE (15-45 days)
        scores += np.where((df['dte'] > 15) & (df['dte'] < 45), 7, 0)
        
        # Not too far OTM
        if 'moneyness' in df.columns:
            scores += np.where(
                (df['moneyness'] > 0.95) & (df['moneyness'] < 1.05), 
                3, 0
            )
        
        return scores
    
    def _determine_signal(self, score: float) -> str:
        """Determine buy signal based on total score."""
        if score >= 70:
            return 'BUY'
        elif score >= 50:
            return 'CONSIDER'
        else:
            return 'AVOID'
    
    def _generate_reasons(self, row: pd.Series) -> str:
        """Generate explanation for the recommendation."""
        reasons = []
        
        if row['volume_score'] > 15:
            reasons.append("High volume/activity")
        if row['liquidity_score'] > 15:
            reasons.append("Tight spread")
        if row['greek_score'] > 15:
            reasons.append("Favorable Greeks")
        if row['value_score'] > 15:
            reasons.append("Good risk/reward")
        if row.get('momentum_score', 0) > 5:
            reasons.append(f"{'Bullish' if self.price_change_pct > 0 else 'Bearish'} momentum")
        if row.get('sentiment_score', 0) > 3:
            reasons.append("Aligned with sentiment")
            
        if row.get('spreadPct', 0) > 10:
            reasons.append("⚠️ Wide spread")
        if row.get('dte', 0) < 7:
            reasons.append("⚠️ Near expiration")
        if row.get('volume', 0) < 10:
            reasons.append("⚠️ Low volume")
            
        return " | ".join(reasons) if reasons else "Standard contract"
    
    def get_top_opportunities(self, n: int = 10) -> Dict:
        """
        Get top N opportunities formatted for storage.
        
        Args:
            n: Number of top opportunities to return
            
        Returns:
            Dict with formatted opportunities
        """
        if self.scored_df is None:
            self.calculate_scores()
            
        if self.scored_df is None or self.scored_df.empty:
            return {
                'has_opportunities': False,
                'opportunities': [],
                'summary': {'total_analyzed': 0},
                'market_context': {
                    'price_change_pct': self.price_change_pct,
                    'sentiment': self.research_data.get('sentiment'),
                    'volume_ratio': self.volume / self.avg_volume if self.avg_volume else 1
                }
            }
            
        # Get top N by score
        top_options = self.scored_df.nlargest(n, 'total_score')
        
        # Format for storage
        opportunities = []
        for _, row in top_options.iterrows():
            opportunity = {
                'contractSymbol': row.get('contractSymbol'),
                'optionType': row.get('optionType'),
                'strike': float(row.get('strike', 0)),
                'expirationDate': row.get('expirationDate').isoformat() if pd.notna(row.get('expirationDate')) else None,
                'dte': int(row.get('dte', 0)),
                'bid': float(row.get('bid', 0)),
                'ask': float(row.get('ask', 0)),
                'mark': float(row.get('mark', 0)),
                'volume': int(row.get('volume', 0)) if pd.notna(row.get('volume')) else 0,
                'openInterest': int(row.get('openInterest', 0)) if pd.notna(row.get('openInterest')) else 0,
                'impliedVolatility': float(row.get('impliedVolatility', 0)) if pd.notna(row.get('impliedVolatility')) else 0,
                'delta': float(row.get('delta', 0)) if pd.notna(row.get('delta')) else None,
                'gamma': float(row.get('gamma', 0)) if pd.notna(row.get('gamma')) else None,
                'theta': float(row.get('theta', 0)) if pd.notna(row.get('theta')) else None,
                'vega': float(row.get('vega', 0)) if pd.notna(row.get('vega')) else None,
                # Defense in depth: same NaN->safe-value guard already applied
                # to delta/gamma/theta/vega above — spreadPct is typed
                # non-nullable on the frontend (unlike the Greeks), so this
                # falls back to 0 rather than None if a NaN ever reaches here.
                'spreadPct': float(row.get('spreadPct', 0)) if pd.notna(row.get('spreadPct')) else 0.0,
                'moneyness': float(row.get('moneyness', 1)),
                'intrinsicValue': float(row.get('intrinsicValue', 0)),
                'extrinsicValue': float(row.get('extrinsicValue', 0)),
                'total_score': float(row.get('total_score', 0)),
                'signal': row.get('signal'),
                'signal_color': row.get('signal_color'),
                'reasons': row.get('reasons'),
                'score_breakdown': {
                    'volume': float(row.get('volume_score', 0)),
                    'liquidity': float(row.get('liquidity_score', 0)),
                    'greeks': float(row.get('greek_score', 0)),
                    'value': float(row.get('value_score', 0)),
                    'momentum': float(row.get('momentum_score', 0)),
                    'sentiment': float(row.get('sentiment_score', 0))
                }
            }
            opportunities.append(opportunity)
        
        # Summary statistics
        summary = {
            'total_analyzed': len(self.scored_df),
            'buy_signals': len(self.scored_df[self.scored_df['signal'] == 'BUY']),
            'consider_signals': len(self.scored_df[self.scored_df['signal'] == 'CONSIDER']),
            'avoid_signals': len(self.scored_df[self.scored_df['signal'] == 'AVOID']),
            'avg_spread_pct': float(self.scored_df['spreadPct'].mean()) if not self.scored_df.empty else 0,
            'avg_volume': float(self.scored_df['volume'].mean()) if not self.scored_df.empty else 0
        }
        
        # Add market context from research data
        market_context = {
            'current_price': self.current_price,
            'price_change_pct': self.price_change_pct,
            'sentiment': self.research_data.get('sentiment'),
            'sentiment_score': self.sentiment_score,
            'volume_ratio': self.volume / self.avg_volume if self.avg_volume else 1,
            'beta': self.volatility
        }
        
        return {
            'has_opportunities': len(opportunities) > 0,
            'opportunities': opportunities,
            'summary': summary,
            'market_context': market_context
        }