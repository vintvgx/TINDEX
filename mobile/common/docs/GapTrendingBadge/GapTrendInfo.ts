import { GapBadgeGlossaryTermKey } from "@/common/components/orb/GapTrendBadges";

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