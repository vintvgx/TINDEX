"""
Morning-brief thresholds as config (TODO 8 part 3) — tuned from the weekly
review instead of edited in code. Stored as one JSON row in `brief_config`
(id = 1); anything missing falls back to DEFAULTS.

`validate_patch` is pure and bounds-checks every key, so a typo or a fat
finger in the app can't set, say, a 0.1× volume multiple.
"""

import logging
import threading
import time as _time

logger = logging.getLogger(__name__)

# key: (default, min, max, cast)
SCHEMA = {
    "min_setup_score":       (80.0,  50.0, 100.0, float),  # cut at the 9:28 lock
    "min_trigger_zone_score": (0.0,   0.0, 100.0, float),  # trigger zone must score at least this
    "trigger_volume_mult":   (1.2,   1.0,   5.0, float),   # 1m volume vs baseline
    "stale_pct":             (0.003, 0.001, 0.02, float),  # no-chase / drift band (0.3%)
    "limit_timeout_seconds": (75,    30,   180,  int),
    "confirm_ttl_seconds":   (300,   60,   600,  int),   # capped at 10:00 ET
    "max_losses_per_day":    (2,     1,    10,   int),
    "max_open_trades":       (2,     1,    4,    int),
    "earnings_block_days":   (2,     0,    10,   int),
}
DEFAULTS = {k: v[0] for k, v in SCHEMA.items()}


def validate_patch(patch: dict) -> dict:
    """Cleaned patch, or ValueError naming the first bad key."""
    if not isinstance(patch, dict) or not patch:
        raise ValueError("send at least one setting")
    out = {}
    for k, v in patch.items():
        if k not in SCHEMA:
            raise ValueError(f"unknown setting '{k}'")
        _, lo, hi, cast = SCHEMA[k]
        try:
            val = cast(v)
        except (TypeError, ValueError):
            raise ValueError(f"{k} must be a number")
        if not lo <= val <= hi:
            raise ValueError(f"{k} must be between {lo} and {hi}")
        out[k] = val
    return out


def merged(stored: "dict | None") -> dict:
    """DEFAULTS overlaid with whatever valid keys are stored."""
    cfg = dict(DEFAULTS)
    for k, v in (stored or {}).items():
        if k in SCHEMA:
            try:
                cfg.update(validate_patch({k: v}))
            except ValueError as e:
                logger.warning("[brief] ignoring stored config %s=%r: %s", k, v, e)
    return cfg


class ConfigStore:
    """Cached read (30s) + write of the `brief_config` row."""

    TTL = 30

    def __init__(self, sb_factory):
        self._sb = sb_factory
        self._lock = threading.Lock()
        self._cached: "dict | None" = None
        self._at = 0.0

    def get(self) -> dict:
        with self._lock:
            if self._cached is not None and _time.time() - self._at < self.TTL:
                return dict(self._cached)
        stored = None
        try:
            rows = self._sb().table("brief_config").select("settings").eq("id", 1).limit(1).execute().data or []
            stored = rows[0]["settings"] if rows else None
        except Exception as e:
            logger.warning("[brief] config read failed, using defaults: %s", e)
        cfg = merged(stored)
        with self._lock:
            self._cached, self._at = cfg, _time.time()
        return dict(cfg)

    def update(self, patch: dict) -> dict:
        clean = validate_patch(patch)
        current = self.get()
        new = {**current, **clean}
        self._sb().table("brief_config").upsert({"id": 1, "settings": new}, on_conflict="id").execute()
        with self._lock:
            self._cached, self._at = new, _time.time()
        return dict(new)
