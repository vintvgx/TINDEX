# Design: Dynamic contract targets — why, and how the system now picks contracts (0.8.06)

- **Date:** 2026-11-19
- **Branch:** `0.8.06-dynamic-contract-targets` (base Master)
- **Spec:** `docs/dynamic-contract-targets-spec-2026-11-19.md`
- **Author:** Bandit (for Kareem — full control granted 2026-11-19)

## 1. Why these changes were chosen

### 1.1 The problem, in one paragraph

The system never chose ITM on purpose — it had no ITM/OTM preference at all.
It targeted a delta around 0.39 and an offset around 1.875 from the breakout
level, and a 0.39-delta put *is* OTM. But ITM picks happened anyway, and the
Nov 19 trade proved it: the 734P was 1.47 OTM vs ORL $735.47, yet $1.06
in-the-money against the $732.94 live price, and it filled at $6.21 — then
went flat (−$8) while SPY fell $4, because the premium was mostly 0DTE time
value inflated by an IV spike and the crush ate the entire move. The fault
was the anchor: the offset is measured from the level, not the live price,
and on a waterfall day the live price has already run past the level. A
second, quieter fault: when greeks are missing (often on the indicative
feed), the delta term in the scorer can't distinguish anything, so the offset
term dominates and pulls the pick toward the level — which, on a fast move,
is ITM vs live.

### 1.2 The $3.00 gate is not the OTM mechanism

The $3.00 max-premium gate (PR #126) is a dollar-risk control: it caps what
a single contract can cost, so a full stop is a bounded dollar loss. For
0DTE SPY it *happens* to force OTM (anything over $3.00 is ITM or very-near-
ATM with spiked IV), but that's incidental. A cheap ITM contract — a strike
in-the-money against the live price but under $3.00 because the move was
small — would still pass the gate. So the gate and the OTM preference are
two different controls, and they live in two different PRs on purpose. The
gate answers "how much can one contract cost"; this PR answers "how far out-
of-the-money should the strike be."

### 1.3 OTM vs ITM is a function of expected move size

This is the core design claim, and it's the reason the fix is a *tier*, not
a fixed rule. A big expected move wants OTM: the contract is cheaper, the
percentage return is bigger, and the move covers the distance to the strike.
A small expected move wants near-ATM: the move won't carry a far-OTM
contract, so you need the delta. A fixed "always pick OTM" rule would be
wrong on small-move days, and a fixed "always pick near-ATM" rule is what's
failing on big-move days. So the system needs an expected-move read, and the
OTM preference has to scale with it.

The evidence for the claim is Nov 17. The 736P filled at $2.35 (SPY
$736.40) and made +$858 (+91%). A $1-further-OTM 735P would have been around
$1.70 at entry (estimate) and around $8.50 at the SPY $727 low (estimate) —
about +400% instead of +302% — with a smaller dollar stop ($204 vs $282 on
a full −30% stop). Same winner, better shape. The dollar gain per contract
is smaller at fixed qty ($0.51 vs $0.71 at TP1), which is why the December
sizing work matters: more contracts of a cheaper OTM strike for the same
dollar risk is what turns the better percentage into more dollars.

The honest caveat, carried from the analysis: OTM doesn't raise the win
rate. Nov 18's first 728P was $1.67 OTM at entry and still lost 51% on the
bounce. OTM fixes dollar risk and percentage returns, not chop. The chop fix
is the account caps (PR #126).

### 1.4 Why dynamic targets, not a separate OTM mode

Two options were on the table. A separate big-move OTM mode (like budget
mode — its own delta band and offset window, switched on by confluence) has
clearer separation, but it's a second code path to maintain, and the tier
already gets the same picks through the strict path. Dynamic targets won
because the change is small and local: the scorer already computes its
targets as the midpoints of the effective delta/offset bands, so shifting
the bands shifts the scorer automatically — no scorer change, no new mode,
no new code path. It also reuses a pattern the code already has: the
time-of-day scaling already shifts the bands by a condition (time), and
budget mode already switches bands by a condition (budget). The tier is a
third condition on the same mechanism. The live-OTM check underneath it is
the guarantee that whatever the targets say, the pick is actually OTM at
the fill.

### 1.5 Why these tier thresholds

The tier is read off two inputs that are already known at selection: the
gate composite (how many technicals agree) and the trigger extension (how
far the trigger closed past the level). Neither predicts move size alone —
that's the key finding from the three November days:

| Day | Composite | Trigger past level | SPY move | Outcome |
|---|---|---|---|---|
| Nov 17 | +12 | $1.09 | −$9.40 | Big move, +$858 |
| Nov 18 | +11 | $0.59 | Reversal | Chop, −$493 |
| Nov 19 | +8 | $2.53 | −$4.03 | Medium move, −$8 |

The composite alone doesn't separate them (+11 chopped, +8 moved). The
extension alone doesn't either ($1.09 moved $9.40, $2.53 moved $4.03).
So the tier requires both: LARGE is composite ≥ +10 *and* extension ≥
$1.00. That catches Nov 17 and only Nov 17. Nov 18 has the composite but
not the extension — strong agreement with no follow-through, which is the
chop signature, and it correctly stays out of LARGE. SMALL is composite ≤
+5 (the MODERATE, confirm-first entries — the move is likely small). These
thresholds are fit to three days and are a hypothesis: the December paper
test validates them. ORB range, VWAP distance and VIX are candidates for a
later tier revision, not v1 — they weren't needed to separate the three
days, and adding unvalidated inputs would be guessing.

### 1.6 Why $0.25 for the live-OTM minimum

The first suggestion was $0.50. Building the visualizer for this work
showed it's wrong: the Nov 17 winner was only $0.40 OTM at entry, so $0.50
would have blocked a +$858 trade. $0.25 lets real winners through and still
catches the cheap-ITM trap (a strike $0.50 ITM vs live). The minimum is a
calibration, not a principle — if December shows winners regularly landing
inside $0.25 of the live price, it should be revisited, not defended.

## 2. How the system now picks contracts

### 2.1 The selection pipeline, step by step

All of this is `select_contract` in `api/services/strategy/contract_selector.py`,
called from `_enter_trade` in `api/services/strategy/orb_engine.py`. Every
selection is 0DTE, same-day expiry.

**Step 0 — The tier is decided first.** Before any strike is looked at, the
selector computes the expected-move tier from the gate composite (passed in
by the engine as `composite_total`) and the trigger extension
(|trigger_price − breakout_level|):
- **LARGE:** composite ≥ +10 AND extension ≥ $1.00.
- **SMALL:** composite ≤ +5.
- **MEDIUM:** everything else, including no composite info (MUSE entries,
  manual entries, any caller that doesn't pass it).

**Step 1 — The bands are set from the tier (standard mode).** The tier's
bands become the effective delta/offset bands:
- LARGE: delta (0.22, 0.34), offset (2.00, 3.50) — target delta ~0.28,
  target offset ~2.75.
- MEDIUM: the profile bands, unchanged (TREND_RIDER: delta 0.30–0.48,
  offset 1.25–2.50).
- SMALL: delta (0.38, 0.52), offset (1.25, 2.00) — target delta ~0.45,
  target offset ~1.625.
Budget mode keeps its own fib-anchored bands; the tier doesn't apply there.

**Step 2 — Time-of-day narrowing applies to the tier bands.** As the session
runs down, the offset window narrows and the delta floor rises (an OTM strike
needs time to work). The narrowing is proportional, so the window width
shrinks by at most 60% and never collapses — LARGE keeps ≥ $0.60 of width at
the close.

**Step 3 — The chain is filtered (hard filters, fail → discard).** For each
live-quoted strike in the 0DTE chain:
1. Offset inside the tier-adjusted window (signed: negative = ITM vs the
   level, rejected).
1b. **Live-price OTM:** the strike must be OTM vs the live price
   (trigger_price) by ≥ $0.25. This is the guarantee.
2. Delta inside the tier-adjusted band — enforced only when greeks are
   present (the indicative feed often omits them).
3. Bid/ask spread ≤ 25% (the liquidity proxy — open interest isn't in the
   chain snapshot).

**Step 4 — The scorer picks the survivor closest to the tier's targets.**
Score = |delta − target_delta| × 1.0 + |offset − target_offset| × 0.5 +
spread × 0.3 + a 0.05 VWAP-misalignment penalty. Lowest wins. Because the
targets are the midpoints of the tier bands, a LARGE tier pulls the pick
further OTM and a SMALL tier pulls it nearer-ATM, with no scorer change.

**Step 5 — The fallback, if no strict survivor exists.** The fallback
considers only strikes that are OTM vs the live price by ≥ $0.25, and picks
the one nearest the level. If no live-OTM strike is quoted, it returns None
and the entry is skipped — rather than buy ITM. (This is a deliberate
behavior change: the fallback used to always return a contract when any
live-quoted strike existed.)

### 2.2 What changed vs before, in one table

| Piece | Before (0.8.04) | Now (0.8.06) |
|---|---|---|
| Target delta / offset | Fixed: 0.39 / 1.875 (profile midpoints) | Shift with the tier: LARGE 0.28 / 2.75, MEDIUM 0.39 / 1.875, SMALL 0.45 / 1.625 |
| Offset window | Fixed [1.25, 2.50] | LARGE [2.00, 3.50], MEDIUM [1.25, 2.50], SMALL [1.25, 2.00] |
| Delta band | Fixed [0.30, 0.48] | LARGE (0.22, 0.34), MEDIUM [0.30, 0.48], SMALL (0.38, 0.52) |
| OTM guarantee | OTM vs the *level* only (offset ≥ 1.25) | OTM vs the level AND OTM vs the *live price* by ≥ $0.25 |
| Fallback | Nearest-the-money contract, always returns one | Nearest live-OTM contract; returns None if none is quoted |
| TOD narrowing | Applied to the profile bands | Applied to the tier bands |
| Engine | No composite passed to the selector | Passes `composite_total` from `gate_snapshot` |

### 2.3 Worked examples

**Nov 17 (LARGE, composite +12, trigger $736.40, ORL $737.49).** Tier:
LARGE (composite ≥ +10, extension $1.09 ≥ $1.00). Bands: delta (0.22, 0.34),
offset (2.00, 3.50). The 736P (offset 1.49) is now outside the window — it
was the old pick. The 735P (offset 2.49, ~$1.70) wins the scorer. Same
winner, better shape: cheaper, bigger % return, smaller dollar stop.

**Nov 19 (MEDIUM, composite +8, trigger $732.94, ORL $735.47).** Tier:
MEDIUM (composite < +10). Bands unchanged. The 734P (offset 1.47, in
window) is rejected by the live-OTM check — it's $1.06 ITM vs the live
price. The 733P is rejected too ($0.06 ITM vs live). The 732P is outside
the offset window (3.47 > 2.50), so strict is empty and the fallback picks
the 732P at $2.80 — OTM vs live by $0.94. This PR alone fixes Nov 19; the
$3.00 gate in PR #126 reaches the same pick for a different reason.

**Cheap-ITM edge case (SMALL, composite +5, trigger $733.50, ORL
$735.47).** The 734P costs $2.30 — cheap enough to pass any price cap — but
it's $0.50 ITM vs live, so the live-OTM check rejects it and the fallback
picks the 733P ($1.85), OTM by $0.50. This is the one gap the $3.00 gate
doesn't cover, and the reason the live-OTM check exists.

**A day with no live-OTM contract.** If every quoted strike is ITM vs the
live price (an extreme waterfall with no far-OTM quotes), the selector
returns None and the entry is skipped. The entry signal was confirmed; the
contract wasn't fitting. Skipping is correct — buying ITM because the signal
was strong is exactly the Nov 19 mistake.

### 2.4 What this does NOT do

- It does not cap the premium (that's PR #126's $3.00 gate).
- It does not change the win rate. The OTM lean improves the shape of wins
  and the dollar risk; chop days are still chop days (the account caps in
  PR #126 are the chop fix).
- It does not size positions. At fixed qty, an OTM contract makes fewer
  dollars per contract on a win — the December sizing work (more contracts
  of a cheaper OTM strike for the same dollar risk) is what turns the better
  percentage into more dollars.
- It does not touch budget mode, manual trades, MUSE entries (MEDIUM by
  default — no composite), or the composite scoring itself.
