import React, { useEffect, useState } from 'react';
import { useThemeColors } from '@/lib/useColorScheme';
import { useStrategyLivePrice } from '@/hooks/queries/strategy/useStrategyLivePrice';
import type { LivePriceData } from '@/hooks/queries/strategy/useStrategyLivePrice';
import type { PositionEntry } from '@/hooks/queries/strategy/useStrategyPosition';
import { PositionInfoModal, type PositionInfoData } from '@/common/components/strategy/PositionInfoModal';
import { getTradeHorizon } from '@/lib/formatContract';
import { positionHideKey } from '@/lib/positionHideKey';
import type { ProfileKey } from '@/common/types/strategy';

/**
 * The open-position edit sheet (PositionInfoModal — stops, TPs, floor,
 * timers) for any 0.7 surface: the Home position cards and the dynamic
 * card's Open contracts page. Merges the live WS over the REST snapshot,
 * plus any just-saved edit (patchData is a no-op before the WS has pushed,
 * so without that a save looked like it didn't take).
 *
 * Pass `live`/`patchData` when the caller already streams this position;
 * otherwise the sheet opens its own stream, only while visible.
 */
export function PositionEditSheet({
  pos,
  visible,
  onClose,
  live: liveProp,
  patchData: patchProp,
}: {
  pos: PositionEntry;
  visible: boolean;
  onClose: () => void;
  live?: LivePriceData | null;
  patchData?: (patch: Partial<LivePriceData>) => void;
}) {
  const colors = useThemeColors();
  const own = useStrategyLivePrice(pos.strategy_id, liveProp === undefined && visible && pos.active);
  const live = liveProp !== undefined ? liveProp : own.data;
  const patchData = patchProp ?? own.patchData;

  const [savedPatch, setSavedPatch] = useState<Partial<LivePriceData>>({});
  const posKey = JSON.stringify(pos);
  useEffect(() => { setSavedPatch({}); }, [posKey]);
  const handleUpdated = (patch: Partial<LivePriceData>) => {
    patchData(patch);
    setSavedPatch((prev) => ({ ...prev, ...patch }));
  };

  const pick = <K extends keyof LivePriceData & keyof PositionEntry>(k: K) =>
    (live?.[k] ?? savedPatch[k] ?? pos[k]) as LivePriceData[K] | undefined;
  const contract = live?.contract ?? pos.contract;
  const data: PositionInfoData = {
    ticker: pos.ticker,
    direction: pos.direction,
    contract,
    paperMode: pos.paper_mode,
    isSwing: contract ? getTradeHorizon(contract) === 'SWING' : false,
    entry_premium: live?.entry_premium ?? pos.entry_premium ?? 0,
    mid_price: live?.mid_price ?? pos.current_price ?? 0,
    qty_remaining: live?.qty_remaining ?? pos.qty_remaining ?? 0,
    pnl: live?.pnl ?? pos.unrealized_pnl ?? 0,
    pnl_pct: live?.pnl_pct ?? pos.unrealized_pnl_pct ?? 0,
    hard_stop: pick('hard_stop') ?? 0,
    tp1: pick('tp1') ?? 0,
    tp2: pick('tp2'),
    tp1_hit: pick('tp1_hit'),
    tp2_hit: pick('tp2_hit'),
    showTp2: pick('use_tp2') !== false,
    slEnabled: pick('sl_enabled') !== false,
    tpEnabled: pick('tp_enabled') !== false,
    sl_grace_enabled: pick('sl_grace_enabled'),
    sl_grace_minutes: pick('sl_grace_minutes'),
    sl_grace_active: live?.sl_grace_active,
    sl_grace_deadline: live?.sl_grace_deadline,
    sl_recovery_deadline: live?.sl_recovery_deadline,
    sl_outer_floor: pick('sl_outer_floor'),
    sl_floor_enabled: pick('sl_floor_enabled'),
    be_grace_seconds: pick('be_grace_seconds'),
    be_grace_active: pick('be_grace_active'),
    be_grace_deadline: pick('be_grace_deadline'),
    runner_mode: pick('runner_mode'),
    runner_trail: pick('runner_trail'),
    cascade_enabled: pick('cascade_enabled'),
  };

  return (
    <PositionInfoModal
      visible={visible}
      onClose={onClose}
      colors={colors}
      profile={pos.profile as ProfileKey | undefined}
      strategyId={pos.strategy_id}
      onUpdated={handleUpdated}
      hideKey={positionHideKey(pos)}
      data={data}
    />
  );
}
