import type { OptionsContract } from '@/common/types/blogPosts/ticker';

/**
 * Contract rows for the Pick Detail Sheet — a client-side port of the brief's
 * contract pick (api/services/brief/entry_rules.py: evaluate_contract /
 * rank_contracts) so the SYSTEM PICK matches what the brief would choose.
 * Keep the constants in sync with that file.
 */

/** Standing premium floor — sub-floor contracts are binned before display. */
export const PREMIUM_FLOOR = 0.35;

const DELTA_MIN = 0.2;
const DELTA_MAX = 0.6;
const SPREAD_MID_MAX = 0.3;
// (max premium per share, TP1 fraction) — entry_rules.SIZE_TIERS
const SIZE_TIERS: [number, number][] = [
  [1.0, 0.3],
  [1.5, 0.5],
  [2.5, 1.0],
];

export interface PickContractRow {
  contract: OptionsContract;
  mid: number;
  systemPick: boolean;
}

const midOf = (c: OptionsContract) => (c.bid + c.ask) / 2;

/** entry_rules.evaluate_contract — lower cost is better, null = fails the rules. */
function contractCost(c: OptionsContract, long: boolean, trigger: number, target: number): number | null {
  const move = Math.abs(target - trigger);
  if (move <= 0) return null;
  const { ask, bid } = c;
  const tier = ask > 0 ? SIZE_TIERS.find(([cap]) => ask <= cap) : undefined;
  if (!tier) return null;
  if (bid < 0 || bid > ask) return null;
  const mid = (ask + bid) / 2;
  const spread = mid > 0 ? (ask - bid) / mid : 1;
  if (spread > SPREAD_MID_MAX) return null;

  const deltaTarget = Math.max(DELTA_MIN, Math.min(DELTA_MAX, (tier[1] * ask) / move));
  let deltaCost: number;
  if (c.delta) {
    const d = Math.abs(c.delta);
    if (d < DELTA_MIN || d > DELTA_MAX) return null;
    deltaCost = Math.abs(d - deltaTarget) / 0.4;
  } else {
    const [lo, hi] = long ? [trigger, target] : [target, trigger];
    if (c.strike < lo || c.strike > hi) return null;
    deltaCost = 0.5;
  }
  return Math.abs(c.strike - target) / move + deltaCost;
}

/**
 * Up to three rows from one side of one expiration: the system pick first,
 * then its next strike further OTM, then the next strike ITM. Without a
 * qualifying pick, the three floor-passing strikes nearest the target.
 */
export function pickContractRows(
  side: OptionsContract[],
  long: boolean,
  trigger: number | null,
  target: number | null,
): PickContractRow[] {
  const priced = side
    .filter((c) => c.bid > 0 && c.ask > 0 && midOf(c) >= PREMIUM_FLOOR)
    .sort((a, b) => a.strike - b.strike);
  if (!priced.length) return [];

  let pick: OptionsContract | null = null;
  if (trigger != null && target != null) {
    let best = Infinity;
    for (const c of priced) {
      const cost = contractCost(c, long, trigger, target);
      if (cost != null && cost < best) {
        best = cost;
        pick = c;
      }
    }
  }

  const row = (c: OptionsContract, systemPick = false): PickContractRow => ({ contract: c, mid: midOf(c), systemPick });

  if (pick) {
    const i = priced.indexOf(pick);
    // CALL: higher strike is further OTM; PUT: lower strike is.
    const otm = priced[long ? i + 1 : i - 1];
    const itm = priced[long ? i - 1 : i + 1];
    return [row(pick, true), ...(otm ? [row(otm)] : []), ...(itm ? [row(itm)] : [])];
  }

  const anchor = target ?? trigger;
  if (anchor == null) return priced.slice(0, 3).map((c) => row(c));
  return [...priced]
    .sort((a, b) => Math.abs(a.strike - anchor) - Math.abs(b.strike - anchor))
    .slice(0, 3)
    .map((c) => row(c));
}
