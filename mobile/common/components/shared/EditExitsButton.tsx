import React, { useState } from 'react';
import { TouchableOpacity, Text, View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/lib/useColorScheme';
import { useToast } from '@/common/components/ui/Toast';
import { useUpdateStrategyExits } from '@/hooks/mutations/strategy/useUpdateStrategyExits';
import { useHiddenPositions } from '@/hooks/useHiddenPositions';
import { EditExitsModal, type ExitEditMode } from '@/common/components/shared/EditExitsModal';

interface BaseProps {
  ticker: string;
  hard_stop: number;
  tp1: number;
  tp2?: number;
  entry_premium: number;
  tp1_hit?: boolean;
  tp2_hit?: boolean;
  /** Contracts still open — drives the "Advanced" per-level qty section
   *  (only shown when there's more than 1 to split). */
  qty_remaining?: number;
  /** False for a 1-contract entry regardless of profile — hides TP2 (and
   *  its qty field) entirely since it can never fire. */
  use_tp2?: boolean;
  /** Current stop-type configuration — see ExitManager.to_dict(). */
  sl_grace_enabled?: boolean;
  sl_grace_minutes?: number | null;
  /** Current runner/cascade configuration for THIS open trade (not just the
   *  profile default) — see ExitManager.to_dict(). */
  runner_mode?: 'trail' | 'be_hold' | 'none';
  cascade_enabled?: boolean;
  /** Stable per-trade key for the client-only hide feature — see
   *  lib/positionHideKey.ts. Never sent to the backend. */
  hideKey: string;
  label?: string;
  style?: object;
  /** Called with the submitted fields right after the server confirms the
   *  update — lets the caller patch its locally-held WS snapshot immediately
   *  instead of waiting on the next "price_update" tick to reflect the edit. */
  onUpdated?: (payload: {
    hard_stop?: number; tp1?: number; tp2?: number;
    sl_grace_enabled?: boolean; sl_grace_minutes?: number | null;
    runner_mode?: 'trail' | 'be_hold' | 'none'; cascade_enabled?: boolean;
  }) => void;
}

interface OrbProps extends BaseProps {
  mode: 'orb';
  strategy_id: string;
}

type Props = OrbProps;

export function EditExitsButton(props: Props) {
  const {
    ticker, hard_stop, tp1, tp2, entry_premium, tp1_hit, tp2_hit,
    qty_remaining, use_tp2, sl_grace_enabled, sl_grace_minutes,
    runner_mode, cascade_enabled,
    hideKey, label, style, onUpdated,
  } = props;
  const colors = useThemeColors();
  const toast = useToast();
  const [open, setOpen] = useState(false);

  const orbMutation = useUpdateStrategyExits();
  const { isHidden, setHidden } = useHiddenPositions();
  const hidden = isHidden(hideKey);

  const isPending = orbMutation.isPending;

  const handleSubmit = async (payload: {
    hard_stop?: number;
    tp1?: number;
    tp2?: number;
    sl_qty?: number;
    tp1_qty?: number;
    tp2_qty?: number;
    sl_grace_minutes?: number | null;
    runner_mode?: 'trail' | 'be_hold' | 'none';
    cascade_enabled?: boolean;
  }) => {
    await orbMutation.mutateAsync({ strategy_id: props.strategy_id, ...payload });
    // Derive sl_grace_enabled alongside sl_grace_minutes so a locally-patched
    // snapshot never goes inconsistent (minutes set but enabled stale false)
    // before the next WS tick catches up.
    const patch = 'sl_grace_minutes' in payload
      ? { ...payload, sl_grace_enabled: payload.sl_grace_minutes != null }
      : payload;
    onUpdated?.(patch);
    toast.success('Stop & targets updated');
    setOpen(false);
  };

  const handleToggleHidden = async () => {
    const next = !hidden;
    await setHidden(hideKey, next);
    toast.success(next ? `${ticker} hidden` : `${ticker} unhidden`);
    setOpen(false);
  };

  return (
    <>
      <TouchableOpacity
        onPress={() => setOpen(true)}
        style={[styles.btn, { borderColor: colors.accent }, style]}
        activeOpacity={0.7}
      >
        <Ionicons name="pencil-outline" size={13} color={colors.accent} />
        <Text style={[styles.btnText, { color: colors.accent }]}>{label ?? 'Edit'}</Text>
      </TouchableOpacity>

      <EditExitsModal
        visible={open}
        onClose={() => setOpen(false)}
        mode={props.mode as ExitEditMode}
        positionId={props.strategy_id}
        ticker={ticker}
        current={{ hard_stop, tp1, tp2, entry_premium, tp1_hit, tp2_hit, qty_remaining, use_tp2, sl_grace_enabled, sl_grace_minutes, runner_mode, cascade_enabled }}
        onSubmit={handleSubmit}
        isLoading={isPending}
        hidden={hidden}
        onToggleHidden={handleToggleHidden}
      />
    </>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    alignSelf: 'flex-start',
  },
  btnText: { fontSize: 13, fontWeight: '600' },
});
