"""
Single shared "is it market hours right now" check for gating BOOT-TIME
auto-start decisions (see api/app.py).

Deliberately separate from the several existing, slightly-drifted
market-hours checks already living inside individual services
(OrbService.is_market_hours() starts its window at 9:15 for its own
pre-market warm-up; OptionsContractMonitorService._is_market_hours() and
SignalIngestService's window each define their own boundaries too — see the
2026-08-04 investigation into inconsistent windows). This module is NOT a
replacement for those — each service's internal loop still decides for
itself when to actually do work. This is only the coarse "should a fresh
process boot even attempt to arm a service" gate, using the plain NYSE
session (9:30 AM - 4:00 PM ET, Mon-Fri, no holiday calendar).
"""

from datetime import datetime, time
import pytz

_ET = pytz.timezone("America/New_York")
_OPEN = time(9, 30)
_CLOSE = time(16, 0)


def is_market_hours(now: datetime | None = None) -> bool:
    """
    True during the plain NYSE session — no holiday calendar, no early-close
    awareness. Good enough for "should a boot-time self-heal arm a service
    right now", where a false positive on a market holiday just means it
    idles in its own internal wait loop same as any other closed day.
    """
    current = (now or datetime.now(_ET))
    if current.tzinfo is None:
        current = _ET.localize(current)
    else:
        current = current.astimezone(_ET)
    if current.weekday() >= 5:  # Saturday / Sunday
        return False
    return _OPEN <= current.time() <= _CLOSE
