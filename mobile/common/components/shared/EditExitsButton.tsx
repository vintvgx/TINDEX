import React, { useState } from 'react';
import { TouchableOpacity, Text, View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/lib/useColorScheme';
import { useToast } from '@/common/components/ui/Toast';
import { useUpdateStrategyExits } from '@/hooks/mutations/strategy/useUpdateStrategyExits';
import { EditExitsModal, type ExitEditMode } from '@/common/components/shared/EditExitsModal';

interface BaseProps {
  ticker: string;
  hard_stop: number;
  tp1: number;
  tp2?: number;
  entry_premium: number;
  tp1_hit?: boolean;
  tp2_hit?: boolean;
  label?: string;
  style?: object;
}

interface OrbProps extends BaseProps {
  mode: 'orb';
  strategy_id: string;
}

type Props = OrbProps;

export function EditExitsButton(props: Props) {
  const { ticker, hard_stop, tp1, tp2, entry_premium, tp1_hit, tp2_hit, label, style } = props;
  const colors = useThemeColors();
  const toast = useToast();
  const [open, setOpen] = useState(false);

  const orbMutation = useUpdateStrategyExits();

  const isPending = orbMutation.isPending;

  const handleSubmit = async (payload: {
    hard_stop?: number;
    tp1?: number;
    tp2?: number;
    tp1_pct?: number;
    tp2_pct?: number;
  }) => {
    await orbMutation.mutateAsync({ strategy_id: props.strategy_id, ...payload });
    toast.success('Stop & targets updated');
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
        <Text style={[styles.btnText, { color: colors.accent }]}>{label ?? 'Edit SL/TP'}</Text>
      </TouchableOpacity>

      <EditExitsModal
        visible={open}
        onClose={() => setOpen(false)}
        mode={props.mode as ExitEditMode}
        positionId={props.strategy_id}
        ticker={ticker}
        current={{ hard_stop, tp1, tp2, entry_premium, tp1_hit, tp2_hit }}
        onSubmit={handleSubmit}
        isLoading={isPending}
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
