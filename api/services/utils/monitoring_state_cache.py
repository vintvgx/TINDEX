"""
Monitoring State Cache

This module provides a local in-memory cache for ORB monitoring state that synchronizes
asynchronously with Supabase. This eliminates database calls from the hot path (bar handling)
while maintaining data consistency.

Architecture:
├── In-Memory Cache: All reads/writes during bar processing hit local cache
├── Dirty Tracking: Modified entries are marked dirty for batch sync
├── Async Sync: Background task periodically flushes dirty entries to database
├── Conflict Resolution: Last-write-wins with timestamp tracking
└── Recovery: Cache can be rebuilt from database on startup

Performance Benefits:
- Bar handling becomes CPU-bound, not I/O-bound
- Database writes are batched (e.g., every 5 seconds instead of per-bar)
- Reduced Supabase API calls by 90%+
- Predictable latency for bar processing

Usage:
    cache = MonitoringStateCache(supabase_client)
    await cache.start()  # Start background sync
    
    # In bar handler (fast, no I/O):
    cache.update_price(ticker, trade_date, current_price, orb_high, orb_low)
    state = cache.get_state(ticker, trade_date)
    
    # On shutdown:
    await cache.stop()  # Flush remaining dirty entries
"""

import asyncio
from dataclasses import dataclass, field
from datetime import datetime, date
from typing import Dict, Optional, Set, Any
import logging

from supabase import Client

logger = logging.getLogger(__name__)


@dataclass
class MonitoringState:
    """
    In-memory representation of orb_monitoring_state row.
    
    All fields are typed to match database schema for seamless serialization.
    """
    ticker: str
    trade_date: date
    opening_price: Optional[float] = None
    orb_high: Optional[float] = None
    orb_low: Optional[float] = None
    current_price: Optional[float] = None
    volume: int = 0
    breakout_type: str = "none"
    breakout_price: Optional[float] = None
    high_broken: bool = False
    low_broken: bool = False
    monitoring_active: bool = True
    timestamp: Optional[str] = None
    data_source: str = "alpaca"
    previous_close: Optional[float] = None
    percentage_change: Optional[float] = None
    reversal_data: Optional[Dict] = None
    options_data: Optional[Dict] = None  # Options contracts data (calls/puts)
    
    # Cache metadata (not persisted to DB)
    _dirty: bool = field(default=False, repr=False)
    _last_modified: Optional[datetime] = field(default=None, repr=False)
    
    def mark_dirty(self):
        """Mark this entry as modified and needing sync."""
        self._dirty = True
        self._last_modified = datetime.now()
    
    def mark_clean(self):
        """Mark this entry as synced with database."""
        self._dirty = False
    
    def to_db_record(self) -> Dict[str, Any]:
        """
        Convert to database record format.
        
        Excludes cache metadata fields (prefixed with _).
        """
        record = {
            "ticker": self.ticker,
            "trade_date": str(self.trade_date),
            "monitoring_active": self.monitoring_active,
            "data_source": self.data_source,
        }
        
        # Only include non-None values to avoid overwriting with nulls
        if self.opening_price is not None:
            record["opening_price"] = self.opening_price
        if self.orb_high is not None:
            record["orb_high"] = self.orb_high
        if self.orb_low is not None:
            record["orb_low"] = self.orb_low
        if self.current_price is not None:
            record["current_price"] = self.current_price
        if self.volume > 0:
            record["volume"] = self.volume
        if self.breakout_type:
            record["breakout_type"] = self.breakout_type
        if self.breakout_price is not None:
            record["breakout_price"] = self.breakout_price
        if self.timestamp:
            record["timestamp"] = self.timestamp
        if self.previous_close is not None:
            record["previous_close"] = self.previous_close
        if self.percentage_change is not None:
            record["percentage_change"] = self.percentage_change
        if self.reversal_data is not None:
            record["reversal_data"] = self.reversal_data
        if self.options_data is not None:
            record["options_data"] = self.options_data
            
        # Boolean fields always included
        record["high_broken"] = self.high_broken
        record["low_broken"] = self.low_broken
        
        return record
    
    @classmethod
    def from_db_record(cls, record: Dict[str, Any]) -> "MonitoringState":
        """
        Create MonitoringState from database record.
        
        NOTE: cls is used since it is a 'classmethod'
        
        Handles type conversions and missing fields gracefully.
        """
        trade_date = record.get("trade_date")
        if isinstance(trade_date, str):
            trade_date = datetime.strptime(trade_date, "%Y-%m-%d").date()
        elif trade_date is None:
            raise ValueError("trade_date is required in database record")
        
        return cls(
            ticker=record["ticker"],
            trade_date=trade_date,
            opening_price=record.get("opening_price"),
            orb_high=record.get("orb_high"),
            orb_low=record.get("orb_low"),
            current_price=record.get("current_price"),
            volume=record.get("volume", 0),
            breakout_type=record.get("breakout_type", "none"),
            breakout_price=record.get("breakout_price"),
            high_broken=record.get("high_broken", False),
            low_broken=record.get("low_broken", False),
            monitoring_active=record.get("monitoring_active", True),
            timestamp=record.get("timestamp"),
            data_source=record.get("data_source", "alpaca"),
            previous_close=record.get("previous_close"),
            percentage_change=record.get("percentage_change"),
            reversal_data=record.get("reversal_data"),
            options_data=record.get("options_data"),
        )


class MonitoringStateCache:
    """
    In-memory cache for ORB monitoring state with async database synchronization.
    
    This cache eliminates database I/O from the bar processing hot path by:
    1. Maintaining all state in memory for fast reads/writes
    2. Tracking dirty entries that need database sync
    3. Running a background task to batch-flush dirty entries
    
    Thread Safety:
    - All public methods are safe to call from async context
    - Background sync task uses asyncio.Lock for concurrent access
    - Dirty set operations are atomic
    
    Error Handling:
    - Database failures don't crash the cache
    - Failed syncs are retried on next cycle
    - Cache remains functional even if database is unavailable
    
    Usage:
        cache = MonitoringStateCache(supabase_client, sync_interval=5.0)
        await cache.start()
        
        # Fast operations (no I/O):
        cache.update_state(ticker, trade_date, current_price=123.45)
        state = cache.get_state(ticker, trade_date)
        
        await cache.stop()  # Flushes all dirty entries
    """
    
    def __init__(
        self,
        supabase: Client,
        sync_interval: float = 5.0,
        max_batch_size: int = 50
    ):
        """
        Initialize the monitoring state cache.
        
        Args:
            supabase: Supabase client for database operations
            sync_interval: Seconds between background sync cycles (default: 5.0)
            max_batch_size: Maximum entries to sync per cycle (default: 50)
        """
        self.supabase = supabase
        self.sync_interval = sync_interval
        self.max_batch_size = max_batch_size
        
        # Primary cache: {(ticker, trade_date): MonitoringState}
        self._cache: Dict[tuple, MonitoringState] = {}
        
        # Set of dirty cache keys for efficient dirty tracking
        self._dirty_keys: Set[tuple] = set()
        
        # Lock for concurrent access during sync
        self._lock = asyncio.Lock()
        
        # Background sync task
        self._sync_task: Optional[asyncio.Task] = None
        self._running = False
        
        # Statistics for monitoring
        self._stats = {
            "cache_hits": 0,
            "cache_misses": 0,
            "sync_cycles": 0,
            "entries_synced": 0,
            "sync_errors": 0,
        }
    
    def _cache_key(self, ticker: str, trade_date: date) -> tuple:
        """Generate cache key from ticker and trade date."""
        if isinstance(trade_date, str):
            trade_date = datetime.strptime(trade_date, "%Y-%m-%d").date()
        return (ticker, trade_date)
    
    async def cache_monitoring_start(self):
        """
        Start the cache and background sync task.
        
        This should be called once during service startup.
        """
        if self._running:
            logger.warning("MonitoringStateCache already running")
            return
        
        self._running = True
        self._sync_task = asyncio.create_task(self._sync_loop())
        logger.info(
            f"MonitoringStateCache started (sync_interval={self.sync_interval}s, "
            f"max_batch_size={self.max_batch_size})"
        )
    
    async def cache_monitoring_stop(self):
        """
        Stop the cache and flush all dirty entries.
        
        This should be called during service shutdown to ensure
        all pending changes are persisted.
        """
        self._running = False
        
        if self._sync_task:
            self._sync_task.cancel()
            try:
                await self._sync_task
            except asyncio.CancelledError:
                pass
            self._sync_task = None
        
        # Final flush of all dirty entries
        await self._flush_dirty_entries(force_all=True)
        
        logger.info(
            f"MonitoringStateCache stopped. Stats: "
            f"hits={self._stats['cache_hits']}, "
            f"misses={self._stats['cache_misses']}, "
            f"synced={self._stats['entries_synced']}, "
            f"errors={self._stats['sync_errors']}"
        )
    
    async def load_from_database(self, trade_date: date):
        """
        Load all monitoring state for a trade date from database into cache.
        
        This should be called at service startup to warm the cache.
        
        Args:
            trade_date: Trade date to load state for
        """
        try:
            response = (
                self.supabase.table("orb_monitoring_state")
                .select("*")
                .eq("trade_date", str(trade_date))
                .eq("monitoring_active", True)
                .execute()
            )
            
            loaded_count = 0
            for record in response.data:
                state = MonitoringState.from_db_record(record)
                key = self._cache_key(state.ticker, state.trade_date)
                self._cache[key] = state
                loaded_count += 1
            
            logger.info(f"Loaded {loaded_count} monitoring states from database for {trade_date}")
            
        except Exception as e:
            logger.error(f"Error loading monitoring state from database: {e}", exc_info=True)
    
    def get_state(self, ticker: str, trade_date: date) -> Optional[MonitoringState]:
        """
        Get monitoring state for a ticker/date.
        
        This is a fast, synchronous operation that only hits local cache.
        
        Args:
            ticker: Stock ticker symbol
            trade_date: Trade date
            
        Returns:
            MonitoringState if found, None otherwise
        """
        key = self._cache_key(ticker, trade_date)
        state = self._cache.get(key)
        
        if state:
            self._stats["cache_hits"] += 1
        else:
            self._stats["cache_misses"] += 1
        
        return state
    
    def get_or_create_state(
        self,
        ticker: str,
        trade_date: date,
        **initial_values
    ) -> MonitoringState:
        """
        Get existing state or create new one with initial values.
        
        This is the primary method for bar handling - it ensures a state
        object exists and returns it for modification.
        
        Args:
            ticker: Stock ticker symbol
            trade_date: Trade date
            **initial_values: Initial values if creating new state
            
        Returns:
            MonitoringState (existing or newly created)
        """
        key = self._cache_key(ticker, trade_date)
        state = self._cache.get(key)
        
        if state:
            self._stats["cache_hits"] += 1
            return state
        
        self._stats["cache_misses"] += 1
        
        # Create new state
        state = MonitoringState(
            ticker=ticker,
            trade_date=trade_date,
            **initial_values
        )
        state.mark_dirty()
        
        self._cache[key] = state
        self._dirty_keys.add(key)
        
        return state
    
    def update_state(
        self,
        ticker: str,
        trade_date: date,
        timestamp: Optional[str] = None,
        **updates
    ) -> MonitoringState:
        """
        Update monitoring state for a ticker.
        
        This is a fast, synchronous operation that:
        1. Gets or creates the state entry
        2. Applies updates
        3. Marks entry as dirty for background sync
        
        Args:
            ticker: Stock ticker symbol
            trade_date: Trade date
            timestamp: Optional timestamp for the update
            **updates: Field updates to apply
            
        Returns:
            Updated MonitoringState
        """
        state = self.get_or_create_state(ticker, trade_date)
        
        # Apply updates
        for attr_name, value in updates.items():
            if hasattr(state, attr_name) and not attr_name.startswith('_'):
                setattr(state, attr_name, value)
        
        if timestamp:
            state.timestamp = timestamp
        
        # Mark dirty
        state.mark_dirty()
        key = self._cache_key(ticker, trade_date)
        self._dirty_keys.add(key)
        
        return state
    
    def update_price(
        self,
        ticker: str,
        trade_date: date,
        current_price: float,
        orb_high: Optional[float] = None,
        orb_low: Optional[float] = None,
        timestamp: Optional[str] = None,
        percentage_change: Optional[float] = None,
    ) -> MonitoringState:
        """
        Optimized method for updating price during monitoring phase.
        
        This is the most frequently called method - optimized for minimal overhead.
        
        Args:
            ticker: Stock ticker symbol
            trade_date: Trade date
            current_price: Current stock price
            orb_high: ORB high (optional, preserves existing if not provided)
            orb_low: ORB low (optional, preserves existing if not provided)
            timestamp: Update timestamp
            percentage_change: Price change percentage
            
        Returns:
            Updated MonitoringState
        """
        key = self._cache_key(ticker, trade_date)
        state = self._cache.get(key)
        
        if state:
            self._stats["cache_hits"] += 1
            # Fast path: update existing state
            state.current_price = current_price
            if orb_high is not None:
                state.orb_high = orb_high
            if orb_low is not None:
                state.orb_low = orb_low
            if timestamp:
                state.timestamp = timestamp
            if percentage_change is not None:
                state.percentage_change = percentage_change
            
            state.mark_dirty()
            self._dirty_keys.add(key)
            return state
        
        self._stats["cache_misses"] += 1
        # Slow path: create new state
        return self.update_state(
            ticker=ticker,
            trade_date=trade_date,
            current_price=current_price,
            orb_high=orb_high,
            orb_low=orb_low,
            timestamp=timestamp,
            percentage_change=percentage_change,
        )
    
    def update_options_data(
        self,
        ticker: str,
        trade_date: date,
        options_data: Dict,
        timestamp: Optional[str] = None,
    ) -> MonitoringState:
        """
        Update options data for a ticker in the monitoring state cache.
        
        Args:
            ticker: Stock ticker symbol
            trade_date: Trade date
            options_data: Options data dict with calls/puts
            timestamp: Optional timestamp for the update
            
        Returns:
            Updated MonitoringState
        """
        state = self.get_or_create_state(ticker, trade_date)
        state.options_data = options_data
        if timestamp:
            state.timestamp = timestamp
        
        state.mark_dirty()
        key = self._cache_key(ticker, trade_date)
        self._dirty_keys.add(key)
        
        logger.debug(f"Updated options data for {ticker} on {trade_date}")
        return state
    
    def update_orb_calculation(
        self,
        ticker: str,
        trade_date: date,
        orb_high: float,
        orb_low: float,
        current_price: float,
        volume: int,
        opening_price: Optional[float] = None,
        previous_close: Optional[float] = None,
        percentage_change: Optional[float] = None,
        timestamp: Optional[str] = None,
        data_source: str = "alpaca",
    ) -> MonitoringState:
        """
        Optimized method for updating state during ORB calculation phase.
        
        Args:
            ticker: Stock ticker symbol
            trade_date: Trade date
            orb_high: Current ORB high
            orb_low: Current ORB low
            current_price: Current price (bar close)
            volume: Cumulative volume
            opening_price: Opening price (first bar's open)
            previous_close: Previous day's close
            percentage_change: Price change from open
            timestamp: Update timestamp
            data_source: Data source identifier
            
        Returns:
            Updated MonitoringState
        """
        key = self._cache_key(ticker, trade_date)
        state = self._cache.get(key)
        
        if state:
            self._stats["cache_hits"] += 1
            # Update existing state
            state.orb_high = orb_high
            state.orb_low = orb_low
            state.current_price = current_price
            state.volume = volume
            if opening_price is not None:
                state.opening_price = opening_price
            if previous_close is not None:
                state.previous_close = previous_close
            if percentage_change is not None:
                state.percentage_change = percentage_change
            if timestamp:
                state.timestamp = timestamp
            state.data_source = data_source
            
            state.mark_dirty()
            self._dirty_keys.add(key)
            return state
        
        self._stats["cache_misses"] += 1
        # Create new state with all fields
        state = MonitoringState(
            ticker=ticker,
            trade_date=trade_date,
            orb_high=orb_high,
            orb_low=orb_low,
            current_price=current_price,
            volume=volume,
            opening_price=opening_price,
            previous_close=previous_close,
            percentage_change=percentage_change,
            timestamp=timestamp,
            data_source=data_source,
            breakout_type="none",
            high_broken=False,
            low_broken=False,
            monitoring_active=True,
        )
        state.mark_dirty()
        
        self._cache[key] = state
        self._dirty_keys.add(key)
        
        return state
    
    def set_breakout(
        self,
        ticker: str,
        trade_date: date,
        breakout_type: str,
        breakout_price: float,
        is_high_broken: bool = False,
        is_low_broken: bool = False,
        timestamp: Optional[str] = None,
    ) -> MonitoringState:
        """
        Record a breakout event in cache.
        
        Args:
            ticker: Stock ticker symbol
            trade_date: Trade date
            breakout_type: "Bullish", "Bearish", "none", etc.
            breakout_price: Price at breakout
            is_high_broken: Whether ORB high was broken
            is_low_broken: Whether ORB low was broken
            timestamp: Breakout timestamp
            
        Returns:
            Updated MonitoringState
        """
        state = self.get_or_create_state(ticker, trade_date)
        
        state.breakout_type = breakout_type
        state.breakout_price = breakout_price
        state.current_price = breakout_price
        
        if is_high_broken:
            state.high_broken = True
        if is_low_broken:
            state.low_broken = True
        
        if timestamp:
            state.timestamp = timestamp
        
        state.mark_dirty()
        key = self._cache_key(ticker, trade_date)
        self._dirty_keys.add(key)
        
        return state
    
    def set_reversal(
        self,
        ticker: str,
        trade_date: date,
        reversal_data: Dict,
        current_price: float,
        timestamp: Optional[str] = None,
    ) -> MonitoringState:
        """
        Record a reversal event in cache.
        
        Args:
            ticker: Stock ticker symbol
            trade_date: Trade date
            reversal_data: Reversal detection data (JSONB)
            current_price: Current price at reversal
            timestamp: Reversal timestamp
            
        Returns:
            Updated MonitoringState
        """
        state = self.get_or_create_state(ticker, trade_date)
        
        state.breakout_type = "reversal"
        state.reversal_data = reversal_data
        state.current_price = current_price
        
        if timestamp:
            state.timestamp = timestamp
        
        state.mark_dirty()
        key = self._cache_key(ticker, trade_date)
        self._dirty_keys.add(key)
        
        return state
    
    def clear_reversal(
        self,
        ticker: str,
        trade_date: date,
        current_price: float,
        timestamp: Optional[str] = None,
    ) -> Optional[MonitoringState]:
        """
        Clear reversal state (set breakout_type back to "none").
        
        Args:
            ticker: Stock ticker symbol
            trade_date: Trade date
            current_price: Current price
            timestamp: Clear timestamp
            
        Returns:
            Updated MonitoringState or None if not found
        """
        state = self.get_state(ticker, trade_date)
        
        if not state:
            return None
        
        if state.breakout_type == "reversal":
            state.breakout_type = "none"
            state.current_price = current_price
            if timestamp:
                state.timestamp = timestamp
            
            state.mark_dirty()
            key = self._cache_key(ticker, trade_date)
            self._dirty_keys.add(key)
        
        return state
    
    def get_dirty_count(self) -> int:
        """Get number of dirty entries pending sync."""
        return len(self._dirty_keys)
    
    def get_cache_stats(self) -> Dict[str, Any]:
        """Get cache statistics for monitoring."""
        return {
            **self._stats,
            "cache_size": len(self._cache),
            "dirty_entries": len(self._dirty_keys),
        }
    
    async def force_sync(self):
        """
        Force immediate sync of all dirty entries.
        
        Use sparingly - prefer letting background sync handle it.
        """
        await self._flush_dirty_entries(force_all=True)
    
    async def _sync_loop(self):
        """
        Background task that periodically flushes dirty entries to database.
        
        This runs continuously while the cache is active, waking up every
        sync_interval seconds to batch-write dirty entries.
        """
        logger.info("MonitoringStateCache sync loop started")
        
        while self._running:
            try:
                await asyncio.sleep(self.sync_interval)
                
                if self._dirty_keys:
                    await self._flush_dirty_entries()
                    
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in cache sync loop: {e}", exc_info=True)
                self._stats["sync_errors"] += 1
        
        logger.info("MonitoringStateCache sync loop stopped")
    
    async def _flush_dirty_entries(self, force_all: bool = False):
        """
        Flush dirty entries to database.
        
        Args:
            force_all: If True, flush all dirty entries regardless of batch size
        """
        async with self._lock:
            if not self._dirty_keys:
                return
            
            self._stats["sync_cycles"] += 1
            
            # Get entries to sync
            if force_all:
                keys_to_sync = list(self._dirty_keys)
            else:
                keys_to_sync = list(self._dirty_keys)[:self.max_batch_size]
            
            if not keys_to_sync:
                return
            
            # Prepare records for upsert
            records = []
            for key in keys_to_sync:
                state = self._cache.get(key)
                if state and state._dirty:
                    records.append(state.to_db_record())
            
            if not records:
                return
            
            try:
                # Batch upsert to database
                # Note: Supabase doesn't have native batch upsert, so we use
                # individual upserts for reliability
                for record in records:
                    self.supabase.table("orb_monitoring_state").upsert(record).execute()
                
                # Mark entries as clean
                for key in keys_to_sync:
                    state = self._cache.get(key)
                    if state:
                        state.mark_clean()
                    self._dirty_keys.discard(key)
                
                self._stats["entries_synced"] += len(records)
                
                if len(records) > 0:
                    logger.debug(f"Synced {len(records)} monitoring state entries to database")
                    
            except Exception as e:
                logger.error(f"Error syncing monitoring state to database: {e}", exc_info=True)
                self._stats["sync_errors"] += 1
                # Don't remove from dirty set - will retry next cycle
    
    def clear_cache(self):
        """
        Clear all cached entries.
        
        Warning: This discards any unsaved changes!
        """
        self._cache.clear()
        self._dirty_keys.clear()
        logger.info("MonitoringStateCache cleared")
    
    def clear_for_date(self, trade_date: date):
        """
        Clear cached entries for a specific trade date.
        
        Useful for daily reset at market close.
        
        Args:
            trade_date: Trade date to clear
        """
        keys_to_remove = [
            key for key in self._cache.keys()
            if key[1] == trade_date
        ]
        
        for key in keys_to_remove:
            del self._cache[key]
            self._dirty_keys.discard(key)
        
        logger.info(f"Cleared {len(keys_to_remove)} cache entries for {trade_date}")
