import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, Modal,
  StyleSheet, ActivityIndicator, ScrollView, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/lib/useColorScheme';
import { useCreateKeyLevel } from '@/hooks/mutations/priceLevels/useCreateKeyLevel';
import { useAuth } from '@/common/utils/context/auth/AuthContext';
import { useToast } from '@/common/components/ui/Toast';
import type { LevelDirection, LevelSource, NamedContract } from '@/common/types/priceLevels';

// Auto-format YYYYMMDD digits → YYYY-MM-DD (same as AddContractSheet)
const fmtExpiry = (raw: string) => {
  const d = raw.replace(/\D/g, '').slice(0, 8);
  if (d.length <= 4) return d;
  if (d.length <= 6) return `${d.slice(0, 4)}-${d.slice(4)}`;
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`;
};

const isValidExpiryDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};

interface DraftContract {
  key: string;
  option_type: 'CALL' | 'PUT';
  strike: string;
  expiry: string;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  initialTicker?: string;
}

export const AddKeyLevelSheet: React.FC<Props> = ({ visible, onClose, initialTicker = '' }) => {
  const colors = useThemeColors();
  const { authState: { user } } = useAuth();
  const { mutate, isPending } = useCreateKeyLevel();
  const toast = useToast();

  const [ticker, setTicker] = useState(initialTicker);
  const [direction, setDirection] = useState<LevelDirection>('bullish');
  const [levelLow, setLevelLow] = useState('');
  const [levelHigh, setLevelHigh] = useState('');
  const [source, setSource] = useState<LevelSource>('self');
  const [notes, setNotes] = useState('');
  const [namedContracts, setNamedContracts] = useState<DraftContract[]>([]);
  const [error, setError] = useState('');

  const reset = () => {
    setTicker(initialTicker);
    setDirection('bullish');
    setLevelLow('');
    setLevelHigh('');
    setSource('self');
    setNotes('');
    setNamedContracts([]);
    setError('');
  };

  const handleClose = () => { reset(); onClose(); };

  const t = ticker.trim().toUpperCase();
  const lowNum = parseFloat(levelLow);
  const highNum = levelHigh.trim() ? parseFloat(levelHigh) : lowNum;
  const isLowValid = !isNaN(lowNum) && lowNum > 0;
  const isHighValid = !isNaN(highNum) && highNum > 0;
  const canSubmit = t.length >= 1 && isLowValid && isHighValid;

  const addNamedContractRow = () => {
    setNamedContracts(prev => [
      ...prev,
      { key: `${Date.now()}`, option_type: direction === 'bullish' ? 'CALL' : 'PUT', strike: '', expiry: '' },
    ]);
  };

  const updateNamedContract = (key: string, patch: Partial<DraftContract>) => {
    setNamedContracts(prev => prev.map(c => (c.key === key ? { ...c, ...patch } : c)));
  };

  const removeNamedContract = (key: string) => {
    setNamedContracts(prev => prev.filter(c => c.key !== key));
  };

  const handleAdd = () => {
    setError('');
    if (!t) return setError('Enter a valid ticker');
    if (!isLowValid) return setError('Enter a valid price level');
    if (!isHighValid) return setError('Zone high must be a valid price');
    if (!user?.id) return setError('Not authenticated');

    // Only include named-contract rows the user actually finished filling in.
    const finishedContracts: NamedContract[] = namedContracts
      .filter(c => c.strike.trim() && isValidExpiryDate(c.expiry))
      .map(c => ({ option_type: c.option_type, strike: parseFloat(c.strike), expiration_date: c.expiry }));

    mutate(
      {
        userId: user.id,
        ticker: t,
        direction,
        levelLow: Math.min(lowNum, highNum),
        levelHigh: Math.max(lowNum, highNum),
        source,
        notes: notes.trim() || undefined,
        namedContracts: finishedContracts,
      },
      {
        onSuccess: () => { toast.success(`Watching ${t} for a ${direction} confirm`); handleClose(); },
        onError: (e: Error) => { setError(e.message); toast.error(e.message); },
      },
    );
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          {/* Header */}
          <View style={[s.header, { borderBottomColor: colors.separator }]}>
            <Text style={[s.title, { color: colors.text }]}>Add Key Level</Text>
            <TouchableOpacity onPress={handleClose} hitSlop={8}>
              <Ionicons name="close" size={24} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
            <Text style={[s.hint, { color: colors.textTertiary, backgroundColor: colors.surface, borderColor: colors.border }]}>
              Watch a price level you found (or a Discord flow admin confirmed). Once a
              1-minute bar closes through it, you'll get a push with scored contract
              suggestions — no auto-trading happens.
            </Text>

            {/* Ticker */}
            <Text style={[s.label, { color: colors.textSecondary }]}>Ticker</Text>
            <TextInput
              style={[s.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
              placeholder="e.g. META, TSLA"
              placeholderTextColor={colors.textTertiary}
              value={ticker}
              onChangeText={v => setTicker(v.toUpperCase())}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={5}
            />

            {/* Direction */}
            <Text style={[s.label, { color: colors.textSecondary }]}>Direction</Text>
            <View style={[s.toggle, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              {(['bullish', 'bearish'] as const).map(opt => {
                const active = direction === opt;
                const ac = opt === 'bullish' ? colors.success : colors.error;
                return (
                  <TouchableOpacity
                    key={opt}
                    onPress={() => setDirection(opt)}
                    activeOpacity={0.8}
                    style={[s.toggleBtn, active && { backgroundColor: ac + '22' }]}
                  >
                    <Ionicons
                      name={opt === 'bullish' ? 'trending-up' : 'trending-down'}
                      size={15}
                      color={active ? ac : colors.textTertiary}
                      style={{ marginRight: 5 }}
                    />
                    <Text style={[s.toggleText, { color: active ? ac : colors.textSecondary, fontWeight: active ? '700' : '500' }]}>
                      {opt === 'bullish' ? 'Bullish' : 'Bearish'}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Level */}
            <Text style={[s.label, { color: colors.textSecondary }]}>
              Price Level {direction === 'bullish' ? '(confirms on a close above)' : '(confirms on a close below)'}
            </Text>
            <TextInput
              style={[s.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
              placeholder="e.g. 373.80"
              placeholderTextColor={colors.textTertiary}
              value={levelLow}
              onChangeText={setLevelLow}
              keyboardType="decimal-pad"
            />

            <Text style={[s.label, { color: colors.textSecondary }]}>Zone High (optional)</Text>
            <TextInput
              style={[s.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
              placeholder="e.g. 557.50 — leave blank for a single price"
              placeholderTextColor={colors.textTertiary}
              value={levelHigh}
              onChangeText={setLevelHigh}
              keyboardType="decimal-pad"
            />

            {/* Source */}
            <Text style={[s.label, { color: colors.textSecondary }]}>Source</Text>
            <View style={[s.toggle, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              {([
                { id: 'self' as const, label: 'Self-found' },
                { id: 'discord_admin' as const, label: 'Discord Admin' },
              ]).map(opt => {
                const active = source === opt.id;
                return (
                  <TouchableOpacity
                    key={opt.id}
                    onPress={() => setSource(opt.id)}
                    activeOpacity={0.8}
                    style={[s.toggleBtn, active && { backgroundColor: colors.accent + '22' }]}
                  >
                    <Text style={[s.toggleText, { color: active ? colors.accent : colors.textSecondary, fontWeight: active ? '700' : '500' }]}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Notes */}
            <Text style={[s.label, { color: colors.textSecondary }]}>Notes (optional)</Text>
            <TextInput
              style={[s.input, s.notesInput, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
              placeholder="Paste the flow call / your reasoning here"
              placeholderTextColor={colors.textTertiary}
              value={notes}
              onChangeText={setNotes}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
            />

            {/* Named contracts */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 20 }}>
              <Text style={[s.label, { color: colors.textSecondary, marginTop: 0, marginBottom: 0 }]}>
                Target Contracts (optional)
              </Text>
              <TouchableOpacity onPress={addNamedContractRow} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Ionicons name="add-circle-outline" size={16} color={colors.accent} />
                <Text style={{ color: colors.accent, fontSize: 13, fontWeight: '600' }}>Add</Text>
              </TouchableOpacity>
            </View>
            <Text style={{ color: colors.textTertiary, fontSize: 12, marginTop: 4, marginBottom: 8 }}>
              Any contracts named in the flow report — pinned to the top of suggestions when the level confirms.
            </Text>

            {namedContracts.map(c => (
              <View key={c.key} style={[s.contractRow, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                <View style={[s.miniToggle, { borderColor: colors.border }]}>
                  {(['CALL', 'PUT'] as const).map(opt => {
                    const active = c.option_type === opt;
                    const ac = opt === 'CALL' ? colors.success : colors.error;
                    return (
                      <TouchableOpacity
                        key={opt}
                        onPress={() => updateNamedContract(c.key, { option_type: opt })}
                        style={[s.miniToggleBtn, active && { backgroundColor: ac + '22' }]}
                      >
                        <Text style={{ fontSize: 12, fontWeight: '700', color: active ? ac : colors.textTertiary }}>{opt[0]}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <TextInput
                  style={[s.contractInput, { color: colors.text, borderColor: colors.border }]}
                  placeholder="Strike"
                  placeholderTextColor={colors.textTertiary}
                  value={c.strike}
                  onChangeText={v => updateNamedContract(c.key, { strike: v })}
                  keyboardType="decimal-pad"
                />
                <TextInput
                  style={[s.contractInput, { flex: 1.4, color: colors.text, borderColor: colors.border }]}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={colors.textTertiary}
                  value={c.expiry}
                  onChangeText={v => updateNamedContract(c.key, { expiry: fmtExpiry(v) })}
                  keyboardType="numeric"
                  maxLength={10}
                />
                <TouchableOpacity onPress={() => removeNamedContract(c.key)} hitSlop={8}>
                  <Ionicons name="close-circle" size={18} color={colors.error} />
                </TouchableOpacity>
              </View>
            ))}

            {error ? (
              <View style={[s.errorBox, { backgroundColor: colors.error + '18', borderColor: colors.error + '40' }]}>
                <Ionicons name="alert-circle-outline" size={14} color={colors.error} />
                <Text style={[s.errorText, { color: colors.error }]}>{error}</Text>
              </View>
            ) : null}

            <TouchableOpacity
              onPress={handleAdd}
              disabled={isPending || !canSubmit}
              activeOpacity={0.8}
              style={[s.addBtn, { backgroundColor: colors.accent, opacity: isPending || !canSubmit ? 0.45 : 1 }]}
            >
              {isPending
                ? <ActivityIndicator color={colors.accentForeground} />
                : (
                  <>
                    <Ionicons name="eye" size={20} color={colors.accentForeground} />
                    <Text style={[s.addBtnText, { color: colors.accentForeground }]}>Start Watching</Text>
                  </>
                )}
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
};

const s = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 18, fontWeight: '700' },
  body: { padding: 20, paddingBottom: 60 },
  hint: {
    fontSize: 13, lineHeight: 19, padding: 14, borderRadius: 12, borderWidth: 1,
    marginBottom: 4,
  },
  label: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 20, marginBottom: 8 },
  input: {
    paddingHorizontal: 16, paddingVertical: 14, borderRadius: 12,
    borderWidth: 1, fontSize: 15,
  },
  notesInput: { minHeight: 90, paddingTop: 12 },
  toggle: {
    flexDirection: 'row', borderRadius: 12, borderWidth: 1, overflow: 'hidden',
  },
  toggleBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 13 },
  toggleText: { fontSize: 14 },
  contractRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: 8, borderRadius: 10, borderWidth: 1, marginBottom: 8,
  },
  miniToggle: { flexDirection: 'row', borderRadius: 8, borderWidth: 1, overflow: 'hidden' },
  miniToggleBtn: { paddingHorizontal: 10, paddingVertical: 8 },
  contractInput: { flex: 1, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 13 },
  errorBox: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, padding: 12, borderRadius: 10, borderWidth: 1 },
  errorText: { fontSize: 13, flex: 1 },
  addBtn: {
    marginTop: 24, paddingVertical: 15, borderRadius: 14,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  addBtnText: { fontSize: 16, fontWeight: '700' },
});
