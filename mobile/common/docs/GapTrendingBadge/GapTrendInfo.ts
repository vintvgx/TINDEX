import type { GapBadgeGlossaryTermKey } from "@/common/components/orb/GapTrendBadges";

/** Info modal content: glossary and why positive/negative matters by prior trend */
export const GAP_TREND_INFO = {
  title: "Understanding Gap & Prior Day Trend",
  glossary: [
    {
      key: "gap" as GapBadgeGlossaryTermKey,
      term: "Gap (Up / Down / Flat)",
      definition:
        "The difference between yesterday's closing price and today's opening price.\n\n" +
        "• Up = stock opened higher than prior close\n" +
        "• Down = opened lower\n" +
        "• Flat = opened near the prior close (small move)",
    },
    {
      key: "priorTrend" as GapBadgeGlossaryTermKey,
      term: "Prior Day Trend (Bullish / Bearish / Flat)",
      definition:
        "Whether the previous trading day closed above or below its open.\n\n" +
        "• Bullish = closed higher than open\n" +
        "• Bearish = closed lower than open\n" +
        "• Flat = little change between open and close",
    },
    {
      key: "continuation" as GapBadgeGlossaryTermKey,
      term: "Continuation ✓",
      definition:
        "The gap direction aligns with the prior day's trend (e.g. bullish day + gap up, or bearish day + gap down).\n\n" +
        "Suggests momentum is continuing into the open.",
    },
    {
      key: "againstGap" as GapBadgeGlossaryTermKey,
      term: "Against Gap ⚠",
      definition:
        "The gap or breakout goes opposite to the prior trend (e.g. bullish day but gap down).\n\n" +
        "Can signal reversal, profit-taking, or failed follow-through—worth extra caution. Not favorable in the direction of the prior trend.",
    },
  ],
  whyItMatters: [
    {
      prior: "After a bullish day",
      positive:
        "A gap up (positive) is favorable—it continues bullish momentum.\n\nTraders often see this as confirmation.",
      negative:
        "A gap down (negative) goes against the trend and can indicate profit-taking or a reversal.\n\nTreat with more caution.",
    },
    {
      prior: "After a bearish day",
      positive:
        "A gap up (positive) can signal a bounce or short squeeze; it goes against the prior trend.",
      negative:
        "A gap down (negative) is favorable—it continues bearish momentum.\n\nSuggests selling pressure persists.",
    },
    {
      prior: "After a flat day",
      positive:
        "Either direction is more neutral; continuation is less meaningful without a clear prior trend.",
      negative: null,
    },
  ],
};

/** Info modal content when showing breakout alignment (Aligns Gap / Against Gap) */
export const GAP_ALIGNMENT_INFO = {
  title: "Understanding Gap & Breakout Alignment",
  glossary: [
    {
      key: "gap" as GapBadgeGlossaryTermKey,
      term: "Gap (Up / Down / Flat)",
      definition:
        "The difference between yesterday's closing price and today's opening price.\n\n" +
        "• Up = stock opened higher than prior close\n" +
        "• Down = opened lower\n" +
        "• Flat = opened near the prior close (small move)",
    },
    {
      key: "priorTrend" as GapBadgeGlossaryTermKey,
      term: "Prior Day Trend (Bullish / Bearish / Flat)",
      definition:
        "Whether the previous trading day closed above or below its open.\n\n" +
        "• Bullish = closed higher than open\n" +
        "• Bearish = closed lower than open\n" +
        "• Flat = little change between open and close",
    },
    {
      key: "continuation" as GapBadgeGlossaryTermKey,
      term: "Aligns Gap ✓",
      definition:
        "The breakout direction aligns with the gap (e.g. gap up and price breaks above the ORB range, or gap down and breaks below).\n\n" +
        "Suggests momentum in the gap direction is confirming the breakout.",
    },
    {
      key: "againstGap" as GapBadgeGlossaryTermKey,
      term: "Against Gap ⚠",
      definition:
        "The breakout goes opposite to the gap (e.g. gap up but price breaks below the range, or gap down but breaks above).\n\n" +
        "Can signal reversal or failed follow-through—worth extra caution.",
    },
  ],
  whyItMatters: [
    {
      prior: "When the gap is up",
      positive:
        "A breakout above the range (aligns with gap) is favorable—bullish momentum is confirming.",
      negative:
        "A breakout below the range (against the gap) goes the other way and may indicate failed follow-through or reversal.",
    },
    {
      prior: "When the gap is down",
      positive:
        "A breakout below the range (aligns with gap) is favorable—bearish momentum is confirming.",
      negative:
        "A breakout above the range (against the gap) can signal a bounce or short squeeze.",
    },
    {
      prior: "When the gap is flat",
      positive:
        "Either direction is more neutral; alignment is less meaningful without a clear gap direction.",
      negative: null,
    },
  ],
};