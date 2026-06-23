# ORB-STRAT-UPDATE Branch — Progress Report
**Branch:** `ORB-STRAT-UPDATE` → `Master`
**Period:** June 7 – June 18, 2026
**Total scope:** 409 commits · 403 files changed · ~73K lines added

---

## Summary

This branch delivers the full ORB (Opening Range Breakout) automated trading strategy — backend engine, mobile UI, real-time data, AI agent integration, and supporting infrastructure.

---

## Feature Areas

### 1. ORB Engine (Backend — `api/services/strategy/`)
- **Core engine** (`orb_engine.py`) built from scratch: opening range detection, breakout confirmation, position sizing, entry/exit logic
- **Profiles system** (`profiles.py`): Bull Dog, Thunder Cat, Wolf, and REVERSAL profiles — each with distinct risk/reward configs
- **Exit manager** (`exit_manager.py`): configurable trailing stops, profit targets, `runner_mode` flag for letting winners run
- **Contract selector** (`contract_selector.py`): 0DTE options selection with OTM budget mode
- **Trade logger** (`trade_logger.py`): full trade lifecycle logging with stock data enrichment, session-level stats
- **Scheduler** (`scheduler.py`): market-hours cron scheduling, session start/end hooks
- **Session notifications** (`notifier.py`): push alerts on session start, breakout detected, trade placed, session close
- **Debug log** (`debug_log.py`): structured per-session debug capture with mobile-accessible API
- **Option stream** (`option_stream.py`): real-time options quote streaming for live position monitoring
- **ORB service** (`tindex/orb_service.py`): orchestration layer — startup, breakout direction tracking, breakout state machine

### 2. Strategy API Routes (`api/routes/strategy_routes.py`)
- CRUD for strategy configs (create, update, delete with data reset)
- Session state endpoint
- Immediate trade endpoints (by ticker, manual trigger)
- Debug mode toggle
- Trade log and position queries
- Runner mode configuration
- Simulation mode endpoints

### 3. AI Agent Integration (`api/services/anthropic/`)
- `anthropic_service.py` expanded: contract scoring, trade analysis, chat completions
- New `/api/agent/chat` and `/api/agent/score_contract` endpoints wired into `app.py`
- Supabase persistence for agent conversation history
- Mobile `AgentService.ts` + full-screen chat modal in app

### 4. Mobile — Strategy Screen (`mobile/app/(app)/(tabs)/strategy.tsx`)
- Profile selector (Bull Dog / Thunder Cat / Wolf / REVERSAL) with guide modal
- Custom thresholds editor per profile
- Live session state display (ORB range, breakout status, current position)
- Immediate trade trigger panel
- Debug mode toggle + log viewer
- Strategy deletion flow with data reset confirmation

### 5. Mobile — ImmediateTradePanel (`mobile/common/components/strategy/ImmediateTradePanel.tsx`)
- Full-panel component replacing the old modal (`ImmediateTradeModal.tsx` removed)
- Ticker search, contract preview, live price stream
- Paper/live trade toggle
- Execution confirmation + post-trade feedback

### 6. Mobile — Trade Log Screen (`mobile/app/(app)/(tabs)/tradelog.tsx`)
- Scrollable trade history with P&L per trade
- Session grouping
- Contract detail expansion
- Sell / exit position actions via `ExitTradeModal`

### 7. Mobile — Feed Screen (`mobile/app/(app)/(tabs)/feed.tsx`)
- Trading insight cards with milestone badges
- Immediate trade panel surfaced directly from feed
- ORB service-down alert banner (`useOrbServiceAlert.ts` hook)
- Strategy data reset trigger accessible from feed

### 8. Real-Time Data (`api/services/websocket/`, `mobile/hooks/useMarketStream.ts`)
- `PriceStreamService` refactored to ref-count ticker subscriptions — no duplicate WebSocket connections
- `useMarketStream` hook updated to subscribe/unsubscribe cleanly on mount/unmount
- Watchlist screen updated to leverage new stream lifecycle

### 9. ORBAdminModal (`mobile/common/components/admin/ORBAdminModal.tsx`)
- Admin panel for paper/live toggle, session reset, force-stop engine
- Protected behind admin flag

### 10. Supabase Migrations
| Migration | Purpose |
|---|---|
| `20260609_strategy_configs_debug_mode.sql` | `debug_mode` column on strategy_configs |
| `20260611_orb_debug_logs.sql` | `orb_debug_logs` table |
| `20260615_strategy_configs_missing_columns.sql` | Smart contracts + missing config columns |
| `20260616_orb_trades_paper_trade_type.sql` | `paper_trade` type column on orb_trades |
| `20260617_create_ai_agent_tables.sql` | `ai_agent_conversations`, `ai_agent_messages` tables |

### 11. Supporting Changes
- App version bumped to **0.3.12**
- `ProfileGuideModal` — per-profile explainer with risk ratings and strategy description
- `ProfileCard` and `PositionCard` minor enhancements
- `formatContract.ts` utility for consistent contract display formatting
- `useSellPosition`, `useResetStrategyData`, `useStrategySessionState`, `useAlpacaAccounts` hooks added
- `ExitTradeModal` component added

---

## Bug Fixes
- **June 15 ORB session bugs:** breakout confirmation race condition, premature exits, missing trade logs, immediate trade not firing during live session
- **Breakout state machine:** reset logic corrected in `OrbService` to prevent stale state across sessions
- **Min ORB range %:** threshold tuned after live session data review (June 16)
- **Ticker subscription leak:** `PriceStreamService` ref-count fix prevents ghost subscriptions on re-renders

---

## Live Session Review — June 23, 2026 (IWM)

### What Happened

IWM opened around 297 and formed a tight ORB (~297.00–298.50). The Trend Rider strategy entered an IWM 297C 0DTE at **$2.37** entry when IWM broke above the ORH at ~9:57 AM (IWM ~299.27). The position was immediately profitable at +$54 (+7.6%) with the contract at $2.55.

IWM reversed sharply by 10:15 AM, pulling back to ~298.25. The contract fell to **$1.63**, putting the position at **-$149 (-31.4%)**. The hard stop at $1.47 had not triggered yet, but the position was within $0.16 of being stopped out. A second strategy (IWM Tester / Retester) was also open at -$114 (-14.9%).

By 10:28 AM the session had flipped — a PUT (IWM $294P) was purchased at $0.19, suggesting a manual reversal play after the breakout failed.

### Root Cause

The take profit levels are structured as follows:

| Level | Value | % Gain on Contract |
|---|---|---|
| Entry | $2.37 | — |
| TP1 | $3.32 | +40% |
| TP2 | $5.92 | +150% |
| Stop | $1.47 | -38% |

**TP1 at +40% is too far.** A 0DTE IWM call that entered at $2.37 with IWM at ~299 needs IWM to push to ~$301+ to reach $3.32. The contract peaked around $2.55 (+7.6%) before reversing — TP1 never had a chance to trigger. The position went from +7.6% to -31.4% with no profit locked in.

---

## Strategy Improvement Recommendations

### Core Philosophy Change: "Hit TP1, then ride for free"

The goal is to take a partial profit quickly at a realistic target, then move the stop loss to entry so the worst case from that point is breakeven. If the trade continues to run, TP2 captures the extended move with zero risk.

---

### 1. Tighten TP1 to a Realistic First Target

**Current:** TP1 = +40% on contract  
**Recommended:** TP1 = +15–20% on contract

For a $2.37 entry this puts TP1 at ~**$2.72–$2.84** — within reach on a normal ORB breakout candle. At 9:57 AM the contract hit $2.55 (+7.6%), which means even a tighter TP1 at +15% ($2.73) would have been achievable with slightly more IWM continuation.

### 2. Move SL to Entry After TP1 Hits

Once TP1 fires (partial sell — 50–67% of position):
- SL immediately shifts from $1.47 → **$2.37 (entry price)**
- Worst case from this point: **breakeven**
- Remaining contracts run toward TP2 or trail

This is the key missing behavior. The engine needs an `on_tp1_hit` hook in the exit manager that updates the stop in real-time.

### 3. Restructure TP2 as the Ambition Target

Keep TP2 at its current ambitious level ($5.92 / +150%) — that target is fine for the runner portion. Once TP1 locks in profit and SL is at breakeven, there's no reason to cap upside.

Optionally add a **trailing stop** after TP1 (trail by 20–25% of contract price) so gains compound naturally if the move extends.

### 4. Trend Rider vs. Other Profiles

Trend Rider is specifically designed for momentum breakouts, which means:
- Entry is typically later in the move (confirmation-based)
- Less time for a large TP1 swing before reversal risk
- Should have the **tightest TP1** of all profiles (~+15%)

Bull Dog / Thunder Cat enter earlier (aggressive breakout), so a slightly wider TP1 (~+20–25%) is more appropriate.

### 5. Suggested Profile TP Structure

| Profile | TP1 Target | TP2 Target | SL After TP1 |
|---|---|---|---|
| Trend Rider | +15% contract | +80% contract | Move to entry |
| Bull Dog | +20% contract | +100% contract | Move to entry |
| Thunder Cat | +25% contract | +120% contract | Move to entry |
| Wolf | +20% contract | +100% contract | Move to entry |
| Reversal | +15% contract | +80% contract | Move to entry |

### 6. Implementation Notes

- `exit_manager.py` — add `tp1_hit` state flag; on trigger, update `current_sl` to `entry_price` and submit a partial close order (sell ~50% of position)
- `profiles.py` — update each profile's `tp1_multiplier` to reflect the tighter targets above
- `orb_engine.py` — TP1 partial-close logic needs to fire a sell on X contracts (not all), then continue monitoring remaining with updated SL
- `strategy_routes.py` — ensure partial close is logged correctly in `orb_trades` with a `partial_exit` flag so P&L accounting is accurate

---

## Open / Pending
- **TP1 tighten + SL-to-entry-on-TP1 logic** — highest priority based on June 23 session
- Backend `/api/agent/chat` and `/api/agent/score_contract` endpoints deployed but contract scoring integration in mobile pending full wiring
- REVERSAL profile live-tested in paper mode only
- Plaid integration (separate branch/feature) not included here
