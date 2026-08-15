import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, Modal, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/lib/useColorScheme';
import { useUpdateAlertThresholds } from '@/hooks/mutations/track/useUpdateAlertThresholds';
import type { TrackedOptionContract } from '@/common/types/options';

const DEFAULT_TIERS = [25, 50, 100];

interface Props {
  visible: boolean;
  onClose: () => void;
  contract: TrackedOptionContract;
}

/**
 * Entered-position alert thresholds — magnitude only per tier, applied
 * symmetrically to gain and loss (matches the existing 3-gain/3-loss
 * default). Only meaningful for status === 'entered' contracts; tracking
 * (watch-only) contracts keep the fixed 25/50/100 defaults untouched.
 */
export const AlertThresholdsModal: React.FC<Props> = ({ visible, onClose, contract }) => {
  const colors = useThemeColors();
  const updateThresholds = useUpdateAlertThresholds();

  const initial = [
    contract.alert_gain_25 ?? DEFAULT_TIERS[0],
    contract.alert_gain_50 ?? DEFAULT_TIERS[1],
    contract.alert_gain_100 ?? DEFAULT_TIERS[2],
  ];
  const [values, setValues] = useState<string[]>(initial.map(v => String(v)));

  useEffect(() => {
    if (visible) {
      setValues([
        String(contract.alert_gain_25 ?? DEFAULT_TIERS[0]),
        String(contract.alert_gain_50 ?? DEFAULT_TIERS[1]),
        String(contract.alert_gain_100 ?? DEFAULT_TIERS[2]),
      ]);
    }
  }, [visible, contract.id]);

  const handleSave = async () => {
    const parsed = values.map((v, i) => {
      const n = parseFloat(v);
      return Number.isFinite(n) && n > 0 ? n : DEFAULT_TIERS[i];
    });
    try {
      await updateThresholds.mutateAsync({
        contractId: contract.id,
        gain25: parsed[0], loss25: -parsed[0],
        gain50: parsed[1], loss50: -parsed[1],
        gain100: parsed[2], loss100: -parsed[2],
      });
      onClose();
    } catch {
      // Error surfaced via updateThresholds.error / console — modal stays open to retry.
    }
  };

  const handleReset = () => setValues(DEFAULT_TIERS.map(String));

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#00000088', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <View style={{ width: '100%', maxWidth: 360, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, padding: 18 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <Text style={{ color: colors.text, fontSize: 16, fontWeight: '700' }}>Position Alerts</Text>
            <TouchableOpacity onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
          <Text style={{ color: colors.textSecondary, fontSize: 12, marginBottom: 16 }}>
            Notify when {contract.contract_symbol} moves this far from your entry price, up or down.
          </Text>

          {values.map((v, i) => (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <Text style={{ color: colors.text, fontSize: 14, fontWeight: '600' }}>Tier {i + 1}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={{ color: colors.textSecondary, fontSize: 14 }}>±</Text>
                <TextInput
                  value={v}
                  onChangeText={(t) => setValues(vs => vs.map((x, j) => (j === i ? t : x)))}
                  keyboardType="numeric"
                  style={{
                    width: 64, textAlign: 'center', color: colors.text, fontSize: 14, fontWeight: '600',
                    borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingVertical: 6,
                    backgroundColor: colors.background,
                  }}
                />
                <Text style={{ color: colors.textSecondary, fontSize: 14 }}>%</Text>
              </View>
            </View>
          ))}

          <TouchableOpacity onPress={handleReset} hitSlop={8} style={{ marginBottom: 16 }}>
            <Text style={{ color: colors.accent, fontSize: 12, fontWeight: '600' }}>Reset to default (25 / 50 / 100)</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={handleSave}
            disabled={updateThresholds.isPending}
            style={{
              backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 12,
              alignItems: 'center', opacity: updateThresholds.isPending ? 0.6 : 1,
            }}
          >
            {updateThresholds.isPending
              ? <ActivityIndicator color="#fff" />
              : <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>Save</Text>}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};
