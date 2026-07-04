# ALETHIA Trading Signals — Complete Reference Guide

> **How to read this document:** Every signal described here is one the ALETHIA system
> already calculates. This guide explains what each one means in plain English, why it
> matters, and how it connects to either a swing trade (30–90 day options) or a
> 0DTE trade (same-day options expiring that evening).

---

## Table of Contents

1. [Foundations — What You're Actually Trading](#1-foundations)
2. [Swing Trade Signals — Technical](#2-swing-technical-signals)
3. [Swing Trade Signals — Options Flow](#3-swing-flow-signals)
4. [How ALETHIA Scores a Swing Opportunity](#4-how-alethia-scores-swing)
5. [Smart Contract Selection — Why Not Buy the ATM](#5-smart-contract-selection)
6. [0DTE Trade Signals — Technical](#6-0dte-technical-signals)
7. [0DTE Trade Signals — Flow & Context](#7-0dte-flow-signals)
8. [0DTE Exit Signals](#8-0dte-exit-signals)
9. [Reading the Signals Together](#9-reading-signals-together)
10. [Quick Reference Card](#10-quick-reference-card)

---

## 1. Foundations

### What is a signal?

A signal is a piece of data that suggests a stock or market is likely to move in a
specific direction. No single signal is a guarantee — they are probabilities. The edge
comes from stacking multiple signals that all point the same direction at the same time.

Think of it like weather forecasting. One dark cloud doesn't mean rain. But dark clouds
+ dropping pressure + high humidity + wind shift — now you're confident enough to grab
an umbrella.

### The two types of trades ALETHIA runs

| Type | DTE | What you're betting on |
|------|-----|------------------------|
| **Swing** | 30–90 days | A multi-day or multi-week directional move |
| **0DTE** | 0 days (expires today) | A move within the current trading session |

**DTE = Days To Expiration.** An option is a contract that has an expiration date. The
closer to expiration, the faster it loses value if the stock doesn't move (this is
called "theta decay"). Swing trades buy more time — 0DTE trades are a race against
the clock.

### Calls vs Puts

- **Call option:** You profit when the stock goes UP. Like buying the right to purchase
  stock at a fixed price — if the stock rises above that price, your option is worth more.
- **Put option:** You profit when the stock goes DOWN.

### Strike price

The "target price" embedded in the contract. A **NVDA $215 Call** means you profit when
NVDA trades above $215. If NVDA is at $192 today, the $215C is "out of the money" (OTM)
— the stock hasn't reached the strike yet. The further OTM, the cheaper the option, but
the bigger the required move.

### Premium

The price you pay per share of the option. Options are sold in contracts of 100 shares.
So if a contract costs $6.64, you pay **$664 per contract** ($6.64 × 100). This is your
maximum loss — you can never lose more than what you paid.

---

## 2. Swing Technical Signals

Technical signals come from the stock's own price history. They tell you about the
*trend structure* — is the stock in a healthy uptrend, extended, or breaking down?

---

### 2.1 EMA — Exponential Moving Average

**What it is:**
An EMA is a running average of the stock's closing price, but it weights recent days
more heavily than older days. This makes it react faster to new price action than a
simple average.

**The three key EMAs:**
- **EMA 20** — average of the last ~20 trading days (~4 calendar weeks). Tracks short-term momentum.
- **EMA 50** — average of the last ~50 trading days (~2.5 months). Tracks medium-term trend.
- **EMA 200** — average of the last ~200 trading days (~10 months). Tracks the long-term trend.

**Important:** These are DAILY chart EMAs. The exact same "EMA 20" on a 5-minute chart
means something completely different — it covers only the last 100 minutes of price data.
ALETHIA swing signals always use the daily chart.

**Why it matters:**
Think of EMAs as "floors" for a stock in an uptrend. A healthy stock bouncing off its
20 EMA is like a basketball bouncing off the floor — the floor is doing its job.

**The EMA Stack (most important pattern):**

```
Price > EMA20 > EMA50 > EMA200   →   BULLISH STACK (all green)
Price < EMA20                    →   Broken — avoid longs
EMA20 < EMA50                    →   Trend broken — avoid longs
```

When all three EMAs are aligned in ascending order and price is above all of them, the
stock is in a confirmed uptrend across all timeframes simultaneously. This is the most
reliable technical condition for swing trades.

**NVDA example from today:**
```
Price:  $192.53
EMA 20: $187.40  ← price is above it ✓
EMA 50: $175.80  ← EMA20 is above it ✓
EMA200: $148.60  ← EMA50 is above it ✓
```
All aligned. The stock has been trending up across 4 weeks, 2.5 months, AND 10 months.
That's structural strength.

**Distance from EMA20:**
How far is the current price above/below the 20 EMA, as a percentage?
- **< 3%** — Hugging the EMA. Healthy pullback territory. Best swing entry zone.
- **3–8%** — Extended but still tradeable.
- **> 8%** — Overextended. Stock is stretched above its average. Risk of snap-back.
  ALETHIA classifies this as **"Extended"** zone and reduces conviction.

---

### 2.2 RSI — Relative Strength Index

**What it is:**
RSI measures how fast and how much a stock has moved recently, on a scale of 0–100.
It's a "momentum speedometer."

**The scale:**
```
RSI > 80   →  Extremely overbought. May be due for a pause or pullback.
RSI 65–80  →  Overbought. Strong trend but stretched.
RSI 40–65  →  The "sweet spot" — healthy momentum, not extreme.
RSI 30–40  →  Oversold territory. Potential for bounce (but can keep falling).
RSI < 30   →  Extremely oversold.
```

**Why ALETHIA targets RSI 40–65 for swing entries:**
You don't want to buy something that's already sprinted. RSI in the 40–65 range means
the stock has momentum but room left to run before hitting overbought exhaustion.

**Think of it like this:** A marathon runner at mile 10 (RSI ~55) still has energy in
the tank. A runner at mile 24 (RSI ~78) might finish, but they're about to hit a wall.

**The signal:**
- RSI 40–65 → adds confidence to a long swing. Full +20 points in ALETHIA's score.
- RSI 65–75 → reduced signal (+10 points). Still ok but less ideal.
- RSI < 30 or > 80 → warning signal. Score drops.

**PLTR today:**
RSI was 66.8 — just outside the ideal range, which slightly reduced the setup score.
That's why PLTR ranked #5 instead of higher despite excellent flow data.

---

### 2.3 MACD — Moving Average Convergence Divergence

**What it is:**
MACD measures the *relationship* between two different EMAs (the 12-day and 26-day EMA)
to tell you whether momentum is building or fading. It's one of the most widely used
momentum indicators in professional trading.

**Breaking it down:**
```
MACD Line   = EMA12 - EMA26
Signal Line = 9-day EMA of the MACD Line
Histogram   = MACD Line - Signal Line (the bars you see in TradingView)
```

**The signal ALETHIA uses:**
- **MACD line above Signal line** → momentum is accelerating to the upside. Bullish.
- **MACD line below Signal line** → momentum is decelerating. Less conviction for longs.

**Think of it like a car:**
- MACD is like measuring whether the car is speeding up or slowing down.
- The Signal line is a smoothed version of that measurement.
- When MACD crosses ABOVE Signal: the engine is accelerating → green light.
- When MACD crosses BELOW Signal: the engine is losing power → caution.

**Why it matters for swing trades:**
A stock above its EMA stack with MACD turning up is the ideal combination — the
structure is bullish AND the momentum is building. When MACD is below the Signal line,
even if the stock is above its EMAs, the move may be running out of steam.

**MSFT today** had MACD below signal — ranked #8 (Watch tier) despite clean EMA stack.
That single indicator flagged reduced conviction.

---

### 2.4 ATR — Average True Range

**What it is:**
ATR measures how much a stock moves on an average day, in dollar terms. It's a
volatility ruler.

**How it's calculated:**
The "true range" of each day is the biggest of:
1. Today's high minus today's low
2. Yesterday's close to today's high (gap up)
3. Yesterday's close to today's low (gap down)

ATR 14 = average of the last 14 days of true range.

**Why it matters:**
ATR tells you what a "normal" move looks like for that stock. This is critical for:

1. **Setting realistic expectations:** NVDA with ATR $6.35 moves ~$6 on an average day.
   A $215 call that's $22 away from the current price ($192) needs roughly 3.5 ATR moves.

2. **Sizing stop losses:** Professional traders often set stops at 1–2 ATR below entry.
   If you buy when NVDA is at $192 and ATR is $6.35, a 1.5-ATR stop would be at $182.

3. **Comparing volatility across stocks:** TSLA (ATR ~$12) moves twice as far per day
   as AAPL (ATR ~$4). That's why TSLA options cost more — more daily range = higher
   probability of reaching the strike.

**Quick mental model:**
> "ATR is what the stock considers a normal-sized day."

If the ATR says $6, and news makes the stock move $18 — that's a 3-ATR day (unusual).
Those are the days option positions multiply.

---

### 2.5 Trend Structure

**What it is:**
Beyond just the EMAs being aligned, ALETHIA checks whether the last 10 daily closes are
actually *moving higher* — higher highs, higher lows over time.

**Three trend states:**
```
UP        — EMA stack aligned AND last 10 closes trending higher. Full +25 pts.
SIDEWAYS  — EMAs aligned but price chopping (not trending). Partial +8 pts.
DOWN      — EMAs NOT aligned and price falling. 0 pts — no trade.
```

**Why it's separate from EMA alignment:**
A stock can have its EMAs aligned (historical structure is bullish) but be chopping
sideways for weeks, not going anywhere. The trend check catches this. You want both:
EMAs stacked AND price actually moving higher day-over-day.

---

## 3. Swing Flow Signals

Options flow signals come from what institutional traders — hedge funds, market makers,
large banks — are actually *doing* with their money in the options market right now.
This data comes from Unusual Whales (UW), which monitors every options trade in real time.

The core premise: **institutions have research teams, models, and information advantages.
When they place a $1M+ options bet, it's not random.**

---

### 3.1 Dollar Flow

**What it is:**
The total dollar amount of an options trade or series of trades on a specific contract.

```
Small retail trade:   $500 – $5,000
Notable flow:         $50,000 – $200,000
Large institutional:  $200,000 – $1,000,000
Unusual / whale:      $1,000,000+
```

**Why it matters:**
A $1.24M NVDA call sweep means someone put over a million dollars on NVDA going up.
That's not a retail gambler — that's a fund making a directional bet. When you see
multiple million-dollar flows on the same stock in the same direction, it's a strong
signal that smart money has a thesis.

**ALETHIA threshold:** Dollar flow > $500,000 adds full conviction to the flow score.
The scoring system gives this the highest single weight of any flow factor (+25 points).

---

### 3.2 Volume / Open Interest Ratio (Vol/OI)

**What it is:**
- **Volume:** How many option contracts were traded today
- **Open Interest (OI):** How many contracts currently exist (are "open") on that strike
- **Ratio:** Volume ÷ OI

**What it tells you:**
```
Vol/OI < 0.1  →  Normal daily volume relative to existing positions. Noise.
Vol/OI 0.1–0.5 →  Moderately elevated. Worth watching.
Vol/OI > 0.5  →  Significantly elevated. New money piling in.
Vol/OI > 1.0  →  More contracts traded today than exist. Explosive new interest.
```

**Why it matters:**
High volume alone doesn't mean much — if there are already 100,000 open contracts,
trading 5,000 more is routine. But if there are only 10,000 open contracts and someone
trades 8,000 today — that Vol/OI of 0.8 means someone is aggressively building a NEW
position, not just passing around existing contracts.

**Real example from today's scan:**
NVDA Vol/OI = 0.68 (8,200 volume / 12,000 OI). 68% of the total outstanding contracts
changed hands in one day. That's institutional-level new positioning.

---

### 3.3 Sweep vs Floor Block

These are the two most powerful types of unusual options trades.

**Sweep:**
A sweep is when a large order is broken up and executed across multiple exchanges
simultaneously, as fast as possible. The buyer is so eager to get filled they don't care
about routing — they just want the position NOW.

```
Why it matters: Urgency = conviction. Sweeps often precede moves.
The buyer is saying: "I need this position before something happens."
```

**Floor Block:**
A floor block is a single massive transaction negotiated directly between two parties
(a buyer and seller) in the exchange's "pit" or via private negotiation. These are
typically $500K–$5M+ trades done by institutions hedging or taking large directional bets.

```
Why it matters: Floor blocks represent carefully considered, large-scale bets.
These aren't panic trades — they're deliberate institutional positioning.
```

**Think of it like this:**
- A sweep is like someone sprinting to grab the last item off a shelf before someone
  else does — urgency, aggression.
- A floor block is like a private real estate deal negotiated directly between buyer and
  seller — deliberate, large scale, well-informed.

Both are bullish signals when they're on CALL contracts. ALETHIA adds +20 points for either.

---

### 3.4 Aggressor Side — Ask vs Bid

Every options trade happens between a buyer and a seller. The "aggressor" is whoever
initiated the trade.

```
Traded at ASK (buy side)  →  The buyer was aggressive. Paid full price. Bullish.
Traded at BID (sell side)  →  The seller was aggressive. Bullish for puts, bearish for calls.
Traded at MID             →  Negotiated price. Neutral signal.
```

**Why the ask side matters:**
If you see a $1M NVDA call sweep traded at the ASK, the buyer was so eager they paid
the full asking price without negotiating down. They didn't wait for the market to come
to them. That urgency is a bullish signal.

If the same trade happened at the BID, it means the options SELLER was pushing to sell
quickly — which could indicate a hedge, not a directional bet, and carries less signal.

ALETHIA adds +20 points when the aggressor is the buyer (ask side).

---

### 3.5 Implied Volatility (IV)

**What it is:**
IV is the market's current expectation of how much a stock will move over the next
year, expressed as a percentage. It's derived backward from the current option price —
hence "implied."

```
IV 20%  →  Market expects ~20% annual moves. Low vol, stable stock.
IV 50%  →  Market expects ~50% annual moves. Moderate vol.
IV 80%+ →  Market expects big swings. High vol stock (TSLA, PLTR, crypto stocks).
```

**The "IV crush" problem:**
After a major event (earnings, Fed meeting, big news), IV collapses because the
uncertainty is resolved. If you buy an option before earnings with IV at 80% and IV
drops to 40% after, your option loses value even if the stock moved the right direction.
This is called "IV crush."

**For swing trades (30–90 DTE):**
You want moderate IV — enough volatility for the stock to reach your strike, but not
so high that you're overpaying for options. Very high IV options cost more and need a
bigger move to profit.

**The 80th percentile penalty:**
ALETHIA tracks the IV of all candidates and penalizes (-15 points) any contract where
IV is in the top 20% of the group. This filters out situations where you'd be buying
expensive options right before an expected IV collapse.

**TSLA example:**
IV at 73% is high (TSLA is always volatile), but for TSLA that's normal. If it were
at 150%, that would indicate something unusual is expected (like earnings next week)
and you'd be overpaying.

---

### 3.6 UW Unusual Score

**What it is:**
Unusual Whales assigns each options trade a proprietary score from 0–100 based on how
"unusual" the activity is relative to that stock's historical options patterns.

```
Score 50–65  →  Moderately unusual. Worth noting.
Score 65–80  →  Notably unusual. Pay attention.
Score 80–90  →  Highly unusual. Strong signal.
Score 90+    →  Extremely unusual. Rare and significant.
```

**What makes it unusual:**
- Volume far above historical average for that strike/expiry
- Large single trades relative to OI
- Multiple sweeps on the same contract in a short window
- Activity in strikes far from ATM (someone making a big directional bet)

**NVDA today: UW score 92.**
That means NVDA's options activity today was in the top 8% of unusual activity NVDA has
ever had. When you combine a 92 UW score with a $1.24M sweep on the ask side, the signal
is as clear as it gets.

---

## 4. How ALETHIA Scores a Swing Opportunity

ALETHIA combines all the signals above into a single **Composite Score (0–100)**:

```
Composite = (Setup Score × 0.45) + (Flow Score × 0.55)
```

**Setup Score (Technical — 45% weight):**
```
EMA stack fully aligned           +30 pts
Trend = UP                        +25 pts
RSI between 40–65                 +20 pts
MACD above signal                 +15 pts
Price within 3% of EMA20          +10 pts
─────────────────────────────────────────
Maximum Setup Score               100 pts
```

**Flow Score (Options Flow — 55% weight):**
```
Vol/OI > 0.5                      +20 pts
Dollar flow > $500K               +25 pts
Traded at ask (buyer aggressor)   +20 pts
Sweep OR Floor block              +20 pts
UW score → scaled to 0–15        +15 pts
IV in top 80th percentile        -15 pts (penalty)
─────────────────────────────────────────
Maximum Flow Score                100 pts
```

**Why flow is weighted more (55% vs 45%):**
Technical analysis tells you the stock *could* move. Flow data tells you institutions
*are betting* it will move. Money talks.

**Tier Classification:**
```
Composite ≥ 90  →  🥇 PRIME   — Highest conviction. All systems green.
Composite ≥ 75  →  💎 STRONG  — Good opportunity. Most signals aligned.
Composite ≥ 60  →  👁 WATCH   — Emerging setup. Proceed with caution.
Below 60        →  Not surfaced. Not enough confluence.
```

**Minimum gate:** Even if flow is perfect, a setup score below 40 (meaning the technical
structure is broken) will not be surfaced. Flow without technical confirmation is noise.

---

## 5. Smart Contract Selection — Why Not Buy the ATM

### The problem with buying what institutions buy

When you see a NVDA $200 Call swept for $1.24M, your first instinct might be to buy the
same contract. The problem: institutions paying $11.47/share ($1,147/contract) are
playing a different game than retail. They can absorb losses. They're often hedging other
positions. And they can afford to buy near-the-money options because $1M is a rounding
error for them.

**For retail, the smarter play is going further OTM.**

### What "OTM" means and why it helps

OTM = "Out of The Money." The strike is beyond where the stock currently trades.

```
NVDA at $192  →  $200C is slightly OTM (4% away)
NVDA at $192  →  $215C is further OTM (11.7% away)  ← ALETHIA's smart pick
```

The further OTM you go:
- The **cheaper** the premium (less dollars at risk)
- The **lower** the delta (less likely to reach that price by expiry)
- But if the stock DOES move there, the **percentage gain is much larger**

### Delta — the probability proxy

**Delta** ranges from 0 to 1 for calls (0 to -1 for puts). It tells you two things:

1. **How much the option moves for every $1 the stock moves**
   - Delta 0.50 → option moves $0.50 for every $1 stock move
   - Delta 0.25 → option moves $0.25 for every $1 stock move

2. **Approximate probability the option expires in the money**
   - Delta 0.50 → ~50% chance the stock is above the strike at expiry
   - Delta 0.25 → ~25% chance

**ALETHIA's minimum delta: 0.14**
Going below delta 0.14 is a "lottery ticket" — the probability of profit is too low
for a disciplined swing trade. The system walks back toward the anchor strike if the
smart pick falls below this threshold.

**NVDA smart pick example:**
```
UW anchor:   $200C  → delta 0.47, $1,147/contract
Smart pick:  $215C  → delta 0.32, $664/contract  (42% cheaper)
```
Delta 0.32 means there's roughly a 32% chance NVDA is above $215 by August 21. That's
not certain — but combined with the Prime-tier signal, the risk/reward is superior to
paying $1,147 for the near-the-money option.

### The 1-Sigma Move — the upside scenario

Black-Scholes (the mathematical model behind option pricing) implies a range the stock
is "expected" to reach based on its current IV and time remaining. This is the
1-standard-deviation move:

```
Expected Move = Current Price × IV × √(DTE / 365)
```

For NVDA ($192.53, 48% IV, 53 DTE):
```
Expected Move = $192.53 × 0.48 × √(53/365) = $192.53 × 0.48 × 0.381 = ~$35
1-sigma target = $192.53 + $35 = ~$228
```

At $228, the $215C is $13 in the money. The option that costs $6.64 today would be
worth roughly $19 at that price — a **+178% return**.

This is why going further OTM with a Prime-tier signal makes sense: you're betting
that the institutional thesis (the sweep, the floor block) has done the research, and
the stock actually makes the move the IV implies it can make.

---

## 6. 0DTE Technical Signals

0DTE options expire the same day you buy them. This changes everything about how you
read signals — you're no longer thinking in weeks, you're thinking in hours.

The primary ALETHIA 0DTE strategy is **ORB: Opening Range Breakout.**

---

### 6.1 The Opening Range Breakout (ORB)

**What is the Opening Range?**
The first 15 minutes of the trading day (9:30–9:45 AM ET) establish the "Opening Range"
— the high and low of that 15-minute window.

```
ORH = Opening Range HIGH  (highest price from 9:30–9:45 AM)
ORL = Opening Range LOW   (lowest price from 9:30–9:45 AM)
```

**Why the first 15 minutes matter:**
The first 15 minutes represent the market "digesting" overnight news, pre-market moves,
and institutional positioning from the previous close. There's usually elevated volume
and volatility as traders establish their directional intent for the day.

After 9:45 AM, when everyone has had a chance to react to the open, the price often
commits to a direction. When it breaks ABOVE the ORH or BELOW the ORL, that's the ORB
signal.

**The signal:**
```
Price breaks ABOVE ORH  →  BUY CALL (bullish breakout)
Price breaks BELOW ORL  →  BUY PUT  (bearish breakout)
```

**Why it works:**
Large participants (institutions, market makers) set stop orders and triggering levels
around the opening range. When price breaks out of that range, it often triggers a
cascade of orders that accelerates the move. You're essentially positioning to ride
that wave.

---

### 6.2 Bar Close Confirmation (ALETHIA's TREND_RIDER filter)

**The problem with raw breakouts:**
A "wick" breakout (where the candle's high touches above ORH but the candle CLOSES back
below) is a fakeout — the price tested the level but got rejected. If you entered on the
wick, you'd be immediately underwater.

**ALETHIA's solution:**
TREND_RIDER uses **bar_close_confirm = True.** This means the system waits for a full
1-minute candle to CLOSE above ORH (or below ORL) before entering. The candle must
fully close outside the range, not just touch it.

```
WITHOUT confirmation: Enter the moment price ticks above ORH  (catches fakeouts)
WITH confirmation:    Enter only after a 1-min bar CLOSES above ORH  (filters fakeouts)
```

**The tradeoff:** You give up the very first tick — you'll never catch the absolute
bottom of the entry. But you avoid a significant number of false breakouts that would
immediately stop you out.

---

### 6.3 Gap Analysis

**What is a gap?**
When the market opens at a significantly different price than where it closed the
previous day, that's a gap. 

```
Gap Up   →  Opened HIGHER than yesterday's close
Gap Down →  Opened LOWER than yesterday's close
```

**Why gaps matter for 0DTE:**

*Gap-and-Go:* Stock gaps up AND continues higher after the ORB. One of the strongest
0DTE patterns. The opening gap showed institutional interest overnight, and the
continuing breakout confirms it.

*Gap-and-Fade (Reversal):* Stock gaps up but immediately reverses and falls. This is
the pattern the REVERSAL profile targets — when a gap-up fails to hold, it often
snaps back hard, and a put can profit from the fade.

**ALETHIA tracks:**
- Gap percentage (how big is the gap)
- Whether the ORB confirmed the gap direction or reversed it
- This informs which profiles are most likely to fire on a given day

---

### 6.4 VIX — The Market's Fear Gauge

**What it is:**
The VIX (CBOE Volatility Index) measures the implied volatility of S&P 500 options over
the next 30 days. It's the market's real-time reading of expected choppiness.

```
VIX < 15    →  Low fear. Market calm. Trends tend to be cleaner.
VIX 15–25   →  Normal range. Typical market conditions.
VIX 25–35   →  Elevated fear. Larger swings. More whipsaws.
VIX > 35    →  High fear. Very choppy. ORB patterns less reliable.
```

**For 0DTE trades:**
Higher VIX means option premiums are MORE expensive (you're paying for all that
expected volatility). It also means the ranges are wider — you can make more, but you
can also lose faster.

ALETHIA records VIX at entry for every trade. Over time, this helps identify which VIX
regimes work best for each profile.

**Practical rule of thumb:**
- VIX < 20 → ORB setups tend to be cleaner, follow-through more reliable
- VIX 20–30 → ORB works but use smaller size / tighter stops
- VIX > 30 → Be selective; the REVERSAL profile may outperform TREND_RIDER

---

### 6.5 Intraday EMAs for 0DTE (5-minute chart)

While swing trades use daily EMAs, for 0DTE entries, shorter timeframe EMAs provide
real-time momentum confirmation.

**Key intraday EMAs:**
- **9 EMA (5-min):** The fastest moving average for intraday. Price above 9 EMA =
  intraday uptrend. Price below = intraday downtrend.
- **20 EMA (5-min):** The "institutional" intraday average. More significant support/resistance.

```
Price > 9 EMA > 20 EMA  →  Intraday bull momentum confirmed
Price < 9 EMA < 20 EMA  →  Intraday bear momentum confirmed
```

**How this connects to ORB:**
If SPY breaks above ORH AND its 5-minute price is above both the 9 and 20 EMA, the
breakout has triple confirmation: ORB signal + short-term trend + medium-term trend.
This is the cleanest setup.

If the ORB fires but the 5-min EMAs are stacked the wrong way (price above ORH but
below the 9 EMA), it's a weaker setup — the intraday trend doesn't support it yet.

---

## 7. 0DTE Flow & Context Signals

### 7.1 Pre-Market Volume & Options Activity

Large pre-market options activity (before 9:30 AM) can signal where institutions are
positioning for the day. If you see sweeps on SPY calls in pre-market, big players are
expecting an up day. This sets the directional bias before the ORB even forms.

**What to watch:**
- Pre-market dollar flow on the index ETFs (SPY, QQQ, IWM)
- Direction of the sweeps (calls vs puts)
- IV levels relative to recent history

### 7.2 Same-Day UW Flow Confirmation

When a live ORB setup is forming (price approaching ORH), UW flow can provide real-time
confirmation. If ALETHIA sees:
1. SPY approaching its ORH
2. Live UW sweep on SPY calls at the same moment

...that's a confluence signal that the breakout may have institutional backing.

The **Flow tab in ORBDetailModal** shows this live — you can see whether the current
options flow is supporting or contradicting the setup.

---

## 8. 0DTE Exit Signals

Knowing when to GET OUT is as important as knowing when to get in. ALETHIA's exit
logic is explicit — no guessing, no hoping.

---

### 8.1 TP1 — Take Profit Level 1

The first profit target. Different profiles use different levels:
- TREND_RIDER: +15% from entry premium
- RETESTER: +20% from entry premium
- BULL_DOG: +20% from entry premium

**What happens at TP1:**
ALETHIA closes **50% of the position** at TP1. You lock in profit on half. The
remaining "runner" stays open chasing the next target.

**After TP1 fires**, the stop loss moves to the entry price (breakeven). You've now
locked in a guaranteed profit on 50% and can't lose on the trade overall.

```
Before TP1: Risk = full position (max loss 100% of premium)
After  TP1: Risk = zero (stop at entry, already locked profit on half)
```

### 8.2 TP2 — Take Profit Level 2

The second, higher target. Some profiles have one, some have two. TP2 closes another
portion of the position at a higher premium.

### 8.3 Hard Stop

The maximum loss allowed before the system closes the position entirely. If the trade
goes against you and the premium drops to the hard stop level, ALETHIA exits
everything — no holding, no hoping.

```
BULL_DOG max loss:    30%  (closes if premium drops 30% below entry)
THUNDER_CAT max loss: 25%
WOLF max loss:        25%
```

**Why hard stops are non-negotiable for 0DTE:**
Without a stop, a 0DTE option can go to zero in minutes. 30% loss is painful. Zero is
catastrophic. The hard stop is what separates disciplined trading from gambling.

### 8.4 Breakeven Stop

After TP1 fires, the stop on the runner moves to the entry price. If the stock reverses
and comes back to your entry level, you exit the runner at breakeven.

```
Result: TP1 profit (locked) + zero gain/loss on runner = net positive trade
```

This is the "be_hold" (breakeven hold) behavior you see in TREND_RIDER and REVERSAL.

### 8.5 Cascade Exit

The CASCADE exit is unique to BULL_DOG, THUNDER_CAT, and WOLF. Instead of trailing
a stop price, these profiles count consecutive 1-minute candles in the OPPOSITE
direction of the trade.

```
BULL_DOG cascade: 5 consecutive 1-min red bars (for a call) → exit runner
```

**Why cascade instead of a price stop?**
A price stop fires based on a specific premium level. But sometimes a stock will
drop to your stop, trigger it, then immediately reverse — you've been "stopped out"
of a winning trade by normal volatility.

The cascade exit waits for confirmation that the *direction* has actually changed.
5 consecutive red bars means the market is consistently moving against you, not just
experiencing a momentary wick.

### 8.6 EOD Close (End of Day)

All 0DTE positions are closed at 3:30 PM ET at the latest. This is a hard rule —
non-negotiable.

**Why:** After 3:30 PM, 0DTE options have very little extrinsic value left. The
time decay (theta) in the final 30 minutes is aggressive. Even if you're up on a
position, holding into the final minutes risks a sudden reversal eating your gains.

EOD_CLOSE = orderly, planned exit at ~3:30 PM
EOD_HARD_CLOSE = position was still open at the hard deadline and force-closed

---

## 9. Reading the Signals Together

### The "stack check" — before any swing entry

Before entering a swing trade, mentally verify the stack:

```
✓ Technical Stack
  [ ] EMA 20/50/200 aligned (price > EMA20 > EMA50 > EMA200)
  [ ] Trend = UP (recent closes moving higher)
  [ ] RSI between 40–65
  [ ] MACD line above signal line
  [ ] Price within 3–8% of EMA20 (not overextended)

✓ Flow Stack  
  [ ] Dollar flow > $500K
  [ ] Sweep OR Floor block
  [ ] Traded at the ask (buyer aggressor)
  [ ] Vol/OI > 0.50
  [ ] UW score > 75

✓ Overall
  [ ] ALETHIA Composite Score ≥ 75 (Strong or Prime tier)
  [ ] No earnings in the next 14 days (IV crush risk)
```

### The "0DTE morning checklist"

```
[ ] Check VIX. Is it above 30? Reduce size or skip.
[ ] Check UW pre-market flow. What direction are the sweeps?
[ ] Is there a scheduled Fed announcement, CPI, or major news today?
    If yes, the ORB may be unusually volatile — be ready for quick moves.
[ ] After 9:45 AM: Where did the ORH/ORL form? Note those exact levels.
[ ] At breakout: Does a 1-min bar CLOSE above ORH?
    → Yes: TREND_RIDER entry fires (or you manually confirm the setup)
    → No (only a wick): Wait. Do not chase.
[ ] Confirm with 5-min EMAs: Is price above the 9 EMA after the breakout?
```

### When signals conflict

Sometimes technical signals are bullish but flow signals are neutral (or vice versa).
The general hierarchy:

1. **Massive unusual flow (UW 90+, sweep, $1M+) overrides weak technicals.** Institutions
   know things you don't. When they're piling in, the technical picture often catches up.

2. **Broken technical structure (price below EMA20, EMA stack flipped) overrides
   decent flow.** If the stock's structure is broken, even good flow rarely saves it
   without time. Wait for the stock to recover its EMAs first.

3. **Never trade against both.** If technicals are bearish AND flow is bearish, that
   is a high-conviction short setup (or just stay flat). Don't find reasons to enter
   against the tide.

---

## 10. Quick Reference Card

### Swing Signal Cheatsheet

| Signal | Bullish | Bearish | What It Means |
|--------|---------|---------|---------------|
| EMA Stack | Price > EMA20 > EMA50 > EMA200 | Price < EMA20 | Trend structure |
| RSI | 40–65 | < 30 or > 80 | Momentum health |
| MACD | Line > Signal | Line < Signal | Momentum direction |
| ATR | — | — | Volatility/range (no bull/bear, just size) |
| Dist from EMA20 | < 3% (best), 3-8% (ok) | > 8% | Overextension risk |
| Dollar Flow | > $500K | < $100K | Smart money size |
| Vol/OI | > 0.50 | < 0.10 | New positioning |
| Aggressor | Ask (buyer) | Bid (seller) | Who's in control |
| Trade Type | Sweep or Floor | Retail/small | Institutional vs retail |
| IV | At or below 80th pct | Top 20% (penalized) | Option pricing fairness |
| UW Score | > 80 | < 60 | Statistical unusualness |

### EMA Zone at a Glance

| Zone | Condition | Action |
|------|-----------|--------|
| 🟢 Bullish | Price above aligned EMAs, RSI 35–70, MACD up | Look for entries |
| 🟡 Extended | Price > 8% above EMA20 | Wait for pullback to EMA |
| ⚪ Neutral | Above EMA20 but MACD not confirming | No trade yet |
| 🔴 Bearish | Price below EMA20 or EMA stack broken | Avoid longs |

### 0DTE Signal Cheatsheet

| Signal | What It Means | What to Do |
|--------|---------------|------------|
| ORB Breakout (bar close above ORH) | Bullish breakout confirmed | Buy call |
| ORB Breakdown (bar close below ORL) | Bearish breakdown confirmed | Buy put |
| VIX < 15 | Calm market, clean trends | Full conviction |
| VIX 20–30 | Choppy, wider ranges | Reduce size |
| VIX > 30 | High fear, whipsaws | Skip or go smaller |
| Pre-market call sweeps | Institutions buying upside | Bias to call on ORB |
| 5-min price > 9 EMA > 20 EMA | Intraday uptrend intact | Call entry stronger |
| TP1 hit | Lock 50%, stop → entry | Let runner work |
| 5 consecutive red bars | Cascade exit trigger | Exit runner |
| 3:30 PM ET | Hard EOD deadline | Close everything |

### Delta Quick Reference

| Delta | What It Means | Best For |
|-------|---------------|----------|
| 0.70–1.00 | Deep ITM. Moves like stock. Very expensive. | Not swing trades |
| 0.45–0.65 | Near ATM. What institutions buy. | Anchor (UW target) |
| 0.25–0.45 | Moderate OTM. Sweet spot for retail swing. | **Smart pick zone** |
| 0.14–0.25 | Far OTM. Cheap, high leverage, lower probability. | Aggressive plays only |
| < 0.14 | Very far OTM. Lottery ticket. | Avoid |

---

*This document reflects the signals and calculations currently running in ALETHIA.
All scores, weights, and thresholds are configurable in the swing_config table.*
