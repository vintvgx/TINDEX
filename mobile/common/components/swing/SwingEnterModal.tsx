import React, { useState } from 'react';
import {
  Modal, View, Text, TextInput, TouchableOpacity,
  ScrollView, SafeAreaView, Switch,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/lib/useColorScheme';
import type { SwingScore, SwingProfileName } from '@/common/types/swing';
import {
  SWING_PROFILE_LABELS, SWING_PROFILE_DESCRIPTIONS,
} from '@/common/types/swing';

interface Props {
  item: SwingScore | null;
  visible: boolean;
  onClose: () => void;
  onSubmit: (payload: {
    contract_symbol: string;
    ticker: string;
    qty: number;
    entry_price: number;
    mode: 'paper' | 'live';
    strategy_profile: SwingProfileName;
    side: 'call' | 'put';
  }) => void;
  isLoading?: boolean;
}

const PROFILES: SwingProfileName[] = [
  'CONSERVATIVE_SWING',
  'RUNNER',
  'DEFINED_RISK',
  'SCALP_SWING',
];

export function SwingEnterModal({ item, visible, onClose, onSubmit, isLoading }: Props) {
  const colors = useThemeColors();
  const [profile, setProfile] = useState<SwingProfileName>('CONSERVATIVE_SWING');
  const [qty, setQty] = useState('1');
  const [entryPrice, setEntryPrice] = useState('');
  const [isLive, setIsLive] = useState(false);

  if (!item) return null;

  const sideColor = item.side === 'call' ? '#10B981' : '#EF4444';

  const handleSubmit = () => {
    const parsedQty = parseInt(qty, 10);
    const parsedEntry = parseFloat(entryPrice || String(item.premium));
    if (!parsedQty || parsedQty < 1) return;
    onSubmit({
      contract_symbol: item.contract_symbol,
      ticker: item.ticker,
      qty: parsedQty,
      entry_price: parsedEntry,
      mode: isLive ? 'live' : 'paper',
      strategy_profile: profile,
      side: item.side,
    });
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderColor: colors.border }}>
          <TouchableOpacity onPress={onClose} style={{ marginRight: 12 }}>
            <Ionicons name="close" size={24} color={colors.text} />
          </TouchableOpacity>
          <Text style={{ color: colors.text, fontSize: 17, fontWeight: '700', flex: 1 }}>
            Enter Swing Trade
          </Text>
        </View>

        <ScrollView contentContainerStyle={{ padding: 16 }}>
          {/* Contract summary */}
          <View style={{ backgroundColor: colors.surface, borderRadius: 12, padding: 14, marginBottom: 20, borderWidth: 1, borderColor: colors.border }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
              <Text style={{ color: colors.text, fontSize: 18, fontWeight: '800', marginRight: 8 }}>{item.ticker}</Text>
              <View style={{ backgroundColor: sideColor + '22', borderRadius: 5, paddingHorizontal: 7, paddingVertical: 2 }}>
                <Text style={{ color: sideColor, fontSize: 12, fontWeight: '700' }}>{item.side.toUpperCase()}</Text>
              </View>
            </View>
            <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
              ${item.strike} · {item.expiry} · {item.dte}d DTE · Score {item.composite_score.toFixed(0)}
            </Text>
          </View>

          {/* Mode toggle */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, backgroundColor: colors.surface, borderRadius: 12, padding: 14 }}>
            <View>
              <Text style={{ color: colors.text, fontSize: 14, fontWeight: '600' }}>
                {isLive ? 'Live Trade' : 'Paper Trade'}
              </Text>
              <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 2 }}>
                {isLive ? 'Places real Alpaca order' : 'Simulated — no real order'}
              </Text>
            </View>
            <Switch
              value={isLive}
              onValueChange={setIsLive}
              trackColor={{ false: colors.border, true: '#10B98166' }}
              thumbColor={isLive ? '#10B981' : colors.textTertiary}
            />
          </View>

          {/* Profile picker */}
          <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '600', letterSpacing: 0.8, marginBottom: 10 }}>
            RISK PROFILE
          </Text>
          <View style={{ gap: 8, marginBottom: 20 }}>
            {PROFILES.map((p) => (
              <TouchableOpacity
                key={p}
                onPress={() => setProfile(p)}
                style={{
                  backgroundColor: colors.surface,
                  borderRadius: 12,
                  padding: 14,
                  borderWidth: 2,
                  borderColor: profile === p ? sideColor : colors.border,
                  flexDirection: 'row',
                  alignItems: 'center',
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontSize: 14, fontWeight: '700' }}>
                    {SWING_PROFILE_LABELS[p]}
                  </Text>
                  <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 2 }}>
                    {SWING_PROFILE_DESCRIPTIONS[p]}
                  </Text>
                </View>
                {profile === p && <Ionicons name="checkmark-circle" size={22} color={sideColor} />}
              </TouchableOpacity>
            ))}
          </View>

          {/* Qty + price */}
          <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '600', letterSpacing: 0.8, marginBottom: 10 }}>
            ORDER DETAILS
          </Text>
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 24 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.textSecondary, fontSize: 12, marginBottom: 6 }}>Contracts</Text>
              <TextInput
                value={qty}
                onChangeText={setQty}
                keyboardType="number-pad"
                style={{
                  backgroundColor: colors.surface,
                  borderRadius: 10,
                  padding: 12,
                  color: colors.text,
                  fontSize: 16,
                  fontWeight: '600',
                  borderWidth: 1,
                  borderColor: colors.border,
                }}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.textSecondary, fontSize: 12, marginBottom: 6 }}>
                Entry Price (optional)
              </Text>
              <TextInput
                value={entryPrice}
                onChangeText={setEntryPrice}
                keyboardType="decimal-pad"
                placeholder={item.premium?.toFixed(2)}
                placeholderTextColor={colors.textTertiary}
                style={{
                  backgroundColor: colors.surface,
                  borderRadius: 10,
                  padding: 12,
                  color: colors.text,
                  fontSize: 16,
                  borderWidth: 1,
                  borderColor: colors.border,
                }}
              />
            </View>
          </View>

          <TouchableOpacity
            onPress={handleSubmit}
            disabled={isLoading}
            style={{
              backgroundColor: isLoading ? colors.border : sideColor,
              borderRadius: 12,
              padding: 16,
              alignItems: 'center',
            }}
          >
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>
              {isLoading ? 'Entering...' : `${isLive ? 'Place' : 'Paper'} ${item.side.toUpperCase()} Trade`}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}
