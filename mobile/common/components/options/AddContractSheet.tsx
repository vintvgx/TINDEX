import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, Modal,
  StyleSheet, ActivityIndicator, ScrollView, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/lib/useColorScheme';
import { useTrackContract } from '@/hooks/mutations/track/useTrackContract';
import { useAuth } from '@/common/utils/context/auth/AuthContext';

// Build OCC option symbol: e.g. NVDA250501C00215000
const buildOCCSymbol = (ticker: string, expiry: string, type: 'CALL' | 'PUT', strike: number) => {
  const [yr, mo, dy] = expiry.split('-');
  return `${ticker}${yr.slice(2)}${mo}${dy}${type[0]}${String(Math.round(strike * 1000)).padStart(8, '0')}`;
};

// Auto-format YYYYMMDD digits → YYYY-MM-DD
const fmtExpiry = (raw: string) => {
  const d = raw.replace(/\D/g, '').slice(0, 8);
  if (d.length <= 4) return d;
  if (d.length <= 6) return `${d.slice(0, 4)}-${d.slice(4)}`;
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`;
};

interface Props {
  visible: boolean;
  onClose: () => void;
  initialTicker?: string;
}

export const AddContractSheet: React.FC<Props> = ({ visible, onClose, initialTicker = '' }) => {
  const colors = useThemeColors();
  const { authState: { user } } = useAuth();
  const { mutate, isPending } = useTrackContract();

  const [ticker, setTicker] = useState(initialTicker);
  const [type, setType] = useState<'CALL' | 'PUT'>('CALL');
  const [expiry, setExpiry] = useState('');
  const [strike, setStrike] = useState('');
  const [error, setError] = useState('');

  const reset = () => {
    setTicker(initialTicker);
    setType('CALL');
    setExpiry('');
    setStrike('');
    setError('');
  };

  const handleClose = () => { reset(); onClose(); };

  const t = ticker.trim().toUpperCase();
  const strikeNum = parseFloat(strike);
  const isExpiryValid = /^\d{4}-\d{2}-\d{2}$/.test(expiry);
  const isStrikeValid = !isNaN(strikeNum) && strikeNum > 0;
  const canPreview = t.length >= 1 && isExpiryValid && isStrikeValid;
  const symbol = canPreview ? buildOCCSymbol(t, expiry, type, strikeNum) : '';
  const expiryLabel = isExpiryValid
    ? new Date(`${expiry}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '';

  const handleAdd = () => {
    setError('');
    if (!t) return setError('Enter a valid ticker');
    if (!isExpiryValid) return setError('Enter expiry as YYYY-MM-DD (e.g. 2025-05-01)');
    if (!isStrikeValid) return setError('Enter a valid strike price');
    if (!user?.id) return setError('Not authenticated');
    mutate(
      {
        userId: user.id,
        ticker: t,
        contractSymbol: symbol,
        optionType: type,
        strike: strikeNum,
        expirationDate: expiry,
        trackingSnapshot: {},
        trackedFromSource: 'manual',
      },
      { onSuccess: handleClose, onError: (e: Error) => setError(e.message) },
    );
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          {/* Header */}
          <View style={[s.header, { borderBottomColor: colors.separator }]}>
            <Text style={[s.title, { color: colors.text }]}>Track Contract</Text>
            <TouchableOpacity onPress={handleClose} hitSlop={8}>
              <Ionicons name="close" size={24} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
            <Text style={[s.hint, { color: colors.textTertiary, backgroundColor: colors.surface, borderColor: colors.border }]}>
              Enter a ticker, select type, and fill in the expiration and strike to start monitoring a contract.
            </Text>

            {/* Ticker */}
            <Text style={[s.label, { color: colors.textSecondary }]}>Ticker</Text>
            <TextInput
              style={[s.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
              placeholder="e.g. NVDA, AAPL, SPY"
              placeholderTextColor={colors.textTertiary}
              value={ticker}
              onChangeText={v => setTicker(v.toUpperCase())}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={5}
            />

            {/* CALL / PUT */}
            <Text style={[s.label, { color: colors.textSecondary }]}>Option Type</Text>
            <View style={[s.toggle, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              {(['CALL', 'PUT'] as const).map(opt => {
                const active = type === opt;
                const ac = opt === 'CALL' ? colors.success : colors.error;
                return (
                  <TouchableOpacity
                    key={opt}
                    onPress={() => setType(opt)}
                    activeOpacity={0.8}
                    style={[s.toggleBtn, active && { backgroundColor: ac + '22' }]}
                  >
                    <Ionicons
                      name={opt === 'CALL' ? 'trending-up' : 'trending-down'}
                      size={15}
                      color={active ? ac : colors.textTertiary}
                      style={{ marginRight: 5 }}
                    />
                    <Text style={[s.toggleText, { color: active ? ac : colors.textSecondary, fontWeight: active ? '700' : '500' }]}>
                      {opt}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Expiration */}
            <Text style={[s.label, { color: colors.textSecondary }]}>Expiration Date</Text>
            <TextInput
              style={[s.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
              placeholder="YYYY-MM-DD  (e.g. 2025-05-01)"
              placeholderTextColor={colors.textTertiary}
              value={expiry}
              onChangeText={v => setExpiry(fmtExpiry(v))}
              keyboardType="numeric"
              maxLength={10}
            />

            {/* Strike */}
            <Text style={[s.label, { color: colors.textSecondary }]}>Strike Price</Text>
            <TextInput
              style={[s.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text }]}
              placeholder="e.g. 215 or 215.50"
              placeholderTextColor={colors.textTertiary}
              value={strike}
              onChangeText={setStrike}
              keyboardType="decimal-pad"
            />

            {error ? (
              <View style={[s.errorBox, { backgroundColor: colors.error + '18', borderColor: colors.error + '40' }]}>
                <Ionicons name="alert-circle-outline" size={14} color={colors.error} />
                <Text style={[s.errorText, { color: colors.error }]}>{error}</Text>
              </View>
            ) : null}

            {/* Preview */}
            {canPreview && (
              <View style={[s.preview, { backgroundColor: colors.surface, borderColor: colors.accent + '40' }]}>
                <Text style={[s.previewMeta, { color: colors.textTertiary }]}>Contract Preview</Text>
                <Text style={[s.previewMain, { color: colors.text }]}>
                  {t}  ${strikeNum % 1 === 0 ? strikeNum.toFixed(0) : strikeNum.toFixed(2)}  {type}  ·  {expiryLabel}
                </Text>
                <Text style={[s.previewSym, { color: colors.textTertiary }]} numberOfLines={1}>
                  {symbol}
                </Text>
              </View>
            )}

            <TouchableOpacity
              onPress={handleAdd}
              disabled={isPending || !canPreview}
              activeOpacity={0.8}
              style={[s.addBtn, { backgroundColor: colors.accent, opacity: isPending || !canPreview ? 0.45 : 1 }]}
            >
              {isPending
                ? <ActivityIndicator color="#fff" />
                : (
                  <>
                    <Ionicons name="add-circle" size={20} color="#fff" />
                    <Text style={s.addBtnText}>Add to Watchlist</Text>
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
  toggle: {
    flexDirection: 'row', borderRadius: 12, borderWidth: 1, overflow: 'hidden',
  },
  toggleBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 13 },
  toggleText: { fontSize: 14 },
  errorBox: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, padding: 12, borderRadius: 10, borderWidth: 1 },
  errorText: { fontSize: 13, flex: 1 },
  preview: {
    marginTop: 24, padding: 16, borderRadius: 14, borderWidth: 1, gap: 5,
  },
  previewMeta: { fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  previewMain: { fontSize: 17, fontWeight: '700' },
  previewSym: { fontSize: 11, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  addBtn: {
    marginTop: 24, paddingVertical: 15, borderRadius: 14,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  addBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
