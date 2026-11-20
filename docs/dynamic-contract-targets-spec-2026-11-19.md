# Spec: Dynamic contract targets — OTM lean by expected move (0.8.06)

- **Version:** 0.8.06
- **Branch:** `0.8.06-dynamic-contract-targets`
- **Base:** Master (`1c73e60`)
- **Date:** 2026-11-19
- **Author:** Bandit (for Kareem — full control granted 2026-11-19)
- **Companion doc:** `docs/dynamic-contract-targets-design-2026-11-19.md` (why these
  changes were chosen and how the system now picks contracts)
- **Related PR (separate, do not merge into this one):** #126 — account-level
  daily loss caps + $3.00 max entry premium gate (branch
  `0.8.05-account-daily-loss-caps`). The two PRs compose (see §7) but are
  independent; this PR is based on Master without #126.

## 1. Problem

The system has no ITM/OTM preference. It targets a delta around 0.39 and an
offset around 1.875 from the breakout level. A 0.39-delta put *is* OTM, so the
design intent is already OTM — but ITM picks happen anyway, because:

1. The anchor is the level, not the live price. The offset window [1.25, 2.50]
   is measured from ORL/ORH. On a waterfall day the live price has already run
   past the level, so the strike 1.875 from the level is ITM against the live
   price. Nov 19: the 734P was 1.47 OTM vs ORL $735.47 but $1.06 ITM vs the
   $732.94 live price — and it filled at $6.21, then went flat (−$8) while
   SPY fell $4, because the premium was mostly 0DTE IV and the crush ate the
   move.
2. When greeks are missing — often on the indicative feed — the delta term in
   the scorer can't distinguish anything, so the offset term dominates and
   pulls the pick toward the level. Same failure, different path.

Kareem's requirement (2026-11-19): lean towards OTM when there is confluence
that a big drop (PUT) or a big move up (CALL) is coming. We don't have to
always pick ITM. The $3.00 premium gate (PR #126) is a *separate* dollar-risk
control — it is NOT the OTM mechanism and must not be conflated with it.

## 2. Decision process

Options considered (full reasoning in the companion design doc):

| Option | What it is | Verdict |
|---|---|---|
| A. Dynamic targets (chosen) | The scorer's target delta/offset shift with an expected-move tier (LARGE/MEDIUM/SMALL), read off the gate composite + trigger extension. Plus a live-price OTM check as the guarantee. | **Chosen.** Smallest change, stays in the strict path, reuses the time-of-day scaling pattern the code already has. |
| B. Separate big-move OTM mode | A new selector mode like budget mode — its own delta band and offset window, switched on by confluence. | Rejected for v1. Clearer separation, but a second code path to maintain; the tier already gets the same picks through the strict path. |
| C. Live-OTM check only | Just the guarantee (strike OTM vs live price), no tier. | Rejected as the whole fix. It prevents ITM picks but adds no OTM *preference* — on a big-move day it would still pick the nearest-ATM OTM strike, not lean further OTM. Included as part of A, not instead of it. |
| D. $3.00 gate as the OTM mechanism | Use the premium cap to force OTM. | Rejected. The cap is a risk control; for 0DTE SPY it happens to force OTM, but that's incidental, and a cheap ITM contract (under $3.00) would still pass it. Lives in PR #126, separate. |

The tier thresholds are fit to three November days and are a hypothesis to be
validated in the December paper test, not established fact:

- Nov 17: composite +12, trigger $1.09 past the level, SPY fell $9.40 → LARGE.
- Nov 18: composite +11, trigger $0.59 past the level, SPY reversed → not LARGE
  (strong agreement, no follow-through — the chop signature).
- Nov 19: composite +8, trigger $2.53 past the level, SPY fell $4.03 → MEDIUM.

Neither the composite nor the extension predicts move size alone (+11 chopped,
+8 moved; $1.09 moved $9.40, $2.53 moved $4.03). The tier combines them.

## 3. Requirements

### R1 — Expected-move tier (`move_tier`, `contract_selector.py`)
A pure function of (composite_total, trigger_price, breakout_level):
- **LARGE:** composite_total ≥ +10 AND |trigger_price − breakout_level| ≥ $1.00.
- **SMALL:** composite_total ≤ +5 (MODERATE entries — the move is likely small).
- **MEDIUM:** everything else, including composite_total=None (no composite
  info — don't change behavior). MUSE entries have no composite, so they are
  MEDIUM by default.

### R2 — Tier-adjusted bands (standard mode only)
`select_contract` applies the tier's bands as the effective delta/offset
bands before scoring. The scorer's targets are the midpoints of these bands,
so they shift automatically — no scorer change.
- **LARGE:** delta (0.22, 0.34), offset (2.00, 3.50). Target delta ~0.28,
  target offset ~2.75.
- **MEDIUM:** the profile bands, unchanged (TREND_RIDER: delta 0.30–0.48,
  offset 1.25–2.50).
- **SMALL:** delta (0.38, 0.52), offset (1.25, 2.00). Target delta ~0.45,
  target offset ~1.625.
- Budget mode keeps its own fib-anchored bands; the tier does not apply there.
- Time-of-day narrowing applies to the *tier* bands (not the profile bands),
  with the same proportional formula. The window width shrinks by at most 60%
  and never collapses (LARGE keeps ≥ $0.60 of width at the close).

### R3 — Live-price OTM check (standard mode only)
A new strict filter: the strike must be OTM vs the live price
(trigger_price) by at least **MIN_LIVE_OTM = $0.25**.
- PUT: trigger_price − strike ≥ $0.25. CALL: strike − trigger_price ≥ $0.25.
- $0.25 is calibrated so the Nov 17 winner (736P, $0.40 OTM at entry)
  passes; a $0.50 minimum would have blocked it. Do not raise it to $0.50.
- Budget mode is exempt — its fib anchor + low delta range (0.08–0.26)
  already guarantee far-OTM.

### R4 — Fallback enforces live-OTM (standard mode only)
When no strict survivor exists, the fallback considers only strikes that are
OTM vs the live price by ≥ $0.25 (nearest to the level among them). If no
live-OTM strike is quoted, return None (skip the entry) rather than buy ITM.
This is a deliberate behavior change: the fallback used to always return a
contract when any live-quoted strike existed.

### R5 — Engine plumbing
`_enter_trade` passes the composite total to `select_contract` as
`composite_total`, read defensively from `gate_snapshot["composite"]
[direction]["total"]` (the MUSE/internal gate shapes don't carry it → None →
MEDIUM). Use `gate_snapshot`, NOT the `gate` local: `gate` is only bound when
the composite gate ran, and reading it unbound raises NameError on
gate-disabled paths. The budget-OTM retry call site is untouched (budget mode
ignores the tier).

### R6 — What this PR does NOT change
- The $3.00 premium gate (PR #126). Not in this PR.
- The offset distance question (is 1.25–2.50 the right window?) — a
  December-test question, not a today question.
- The tier thresholds (R1) — fit to three days; December validates them.
  ORB range, VWAP distance and VIX are candidates for a later tier revision,
  not v1.
- Manual trades (they bypass selection entirely).
- The per-strategy `daily_loss_limit` and the account caps (PR #126).

## 4. Files

- `api/services/strategy/contract_selector.py` — `move_tier`, `_TIER_BANDS`,
  `MIN_LIVE_OTM`, `composite_total` param, tier bands + TOD-on-tier-bands,
  live-OTM strict filter (1b), live-OTM fallback, docstring updates.
- `api/services/strategy/orb_engine.py` — pass `composite_total` at the
  `_enter_trade` select_contract call site (from `gate_snapshot`).
- `api/tests/test_dynamic_contract_targets.py` — 16 new tests (see §5).
- `docs/dynamic-contract-targets-spec-2026-11-19.md` — this file.
- `docs/dynamic-contract-targets-design-2026-11-19.md` — the why + how doc.
- `mobile/app.config.js`, `mobile/package.json` — version 0.8.06.

## 5. Tests

`api/tests/test_dynamic_contract_targets.py` (16 tests):

- `test_move_tier` (8 parametrized cases): LARGE boundary (+10 / exactly
  $1.00 past), +10 / $0.99 past → MEDIUM, +9 → MEDIUM, +5/+4 → SMALL,
  +6 → MEDIUM, None → MEDIUM.
- `test_min_live_otm_calibration`: MIN_LIVE_OTM == 0.25.
- Nov 17 LARGE replay (composite +12): picks the 735P ($1.70) instead of the
  736P ($2.35) — same winner, better shape.
- Nov 17 with composite_total=None: picks the 736P (today's behavior).
- LARGE + TOD narrowing (300 min since ORB close): the window stays valid,
  the 735P is still the only survivor.
- Nov 19 replay (composite +8 → MEDIUM): the 734P and 733P are rejected by
  the live-OTM check; the fallback picks the 732P ($2.80). This PR alone
  fixes Nov 19 — the $3.00 gate in #126 reaches the same pick for a different
  reason.
- SMALL tier (composite +5): the offset window narrows to [1.25, 2.00], so
  the nearer strike (734P) wins.
- Cheap-ITM edge case (trigger $733.50, 734P $2.30): rejected by the
  live-OTM check; the fallback picks the 733P ($1.85).
- No live-OTM contract quoted: returns None (skips the entry).

Full backend suite: **515 passed** (499 pre-existing on Master + 16 new).

## 6. Acceptance checklist

- [ ] T1: Nov 17 replay — LARGE tier picks the 735P, not the 736P.
- [ ] T2: Nov 19 replay — the 734P is rejected (live-OTM), the 732P is picked.
- [ ] T3: Nov 17 with no composite — the 736P is picked (MEDIUM default).
- [ ] T4: Full backend suite passes (515).
- [ ] T5: `move_tier` boundary cases (+10/$1.00 → LARGE; +10/$0.99 → MEDIUM;
  +5 → SMALL; None → MEDIUM).
- [ ] T6: LARGE + late-day TOD narrowing — the window stays valid, the pick
  is still an OTM strike.
- [ ] T7: No live-OTM strike quoted → entry skipped (None), not an ITM buy.
- [ ] T8: Budget mode untouched (its bands, filter and fallback unchanged).
- [ ] T9: Manual trades unaffected (they bypass selection).

## 7. Interaction with PR #126 (caps + $3.00 gate)

This PR is based on Master and does NOT contain the $3.00 gate. The two PRs
compose: the gate is a hard ask filter applied in the same strict loop and
fallback, independent of the tier. When both merge, a contract must pass both
the tier bands + live-OTM check AND the $3.00 cap. On Nov 19 both PRs
independently reach the 732P (this PR via the live-OTM check, #126 via the
price cap) — that convergence is evidence the pick is right, not a conflict.
**Version sequencing:** this PR sets the version to 0.8.06; #126 sets it to
0.8.05. Whichever merges second wins the version — if this PR merges first,
#126 needs a rebase + version bump to 0.8.07 (or the version files will go
backwards). Merge order is Kareem's call.

## 8. Out of scope

- The $3.00 premium gate (PR #126).
- December sizing work (qty by dollar risk — more contracts of a cheaper
  OTM strike for the same dollar risk).
- Tier-threshold validation (December paper test) and tier v1.1 inputs
  (ORB range, VWAP distance, VIX).
- Any change to the offset distance (1.25–2.50) or the composite scoring
  itself.
