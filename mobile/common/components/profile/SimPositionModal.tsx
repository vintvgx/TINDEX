import React, { useState } from 'react';
import { View, Text, Modal, Pressable, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/lib/useColorScheme';
import { useToast } from '@/common/components/ui/Toast';
import {
  SIM_TICKERS, clearSimPositions, createSimPosition, removeSimPosition, useSimLog, useSimPositionEntries,
  type SimVolatility,
} from '@/lib/devSim/simPositions';

/**
 * Profile → Developer → Simulated Position. Generates a fake open position
 * with a random-walk price so the real position cards, exit editor and the
 * limit sell ladder can be previewed with no open trades. Fully local — no
 * backend calls; cleared on app restart. See lib/devSim/simPositions.ts.
 */
export function SimPositionModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const colors = useThemeColors();
  const toast = useToast();
  const sims = useSimPositionEntries();
  const log = useSimLog();

  const [contracts, setContracts] = useState(3);
  const [ticker, setTicker] = useState<string | null>(null);
  const [direction, setDirection] = useState<'CALL' | 'PUT' | null>(null);
  const [paper, setPaper] = useState(true);
  const [vol, setVol] = useState<SimVolatility>('normal');

  const generate = () => {
    createSimPosition({
      contracts, ticker: ticker ?? undefined, direction: direction ?? undefined, paper, volatility: vol,
    });
    toast.success(`Simulated ${contracts}-contract position opened — see Home / Positions`);
  };

  const Seg = <T,>({ options, value, onChange }: {
    options: { label: string; value: T }[]; value: T; onChange: (v: T) => void;
  }) => (
    <View style={[styles.seg, { borderColor: colors.border }]}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <TouchableOpacity
            key={o.label}
            onPress={() => onChange(o.value)}
            style={[styles.segItem, on && { backgroundColor: colors.accent + '22' }]}
          >
            <Text style={[styles.segText, { color: on ? colors.accent : colors.textSecondary }]}>{o.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.title, { color: colors.text }]}>Simulated Position</Text>
              <Text style={[styles.sub, { color: colors.textSecondary }]}>
                Local only — no backend calls. Cleared on app restart.
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={22} color={colors.textTertiary} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={[styles.label, { color: colors.textTertiary }]}>CONTRACTS</Text>
            <View style={styles.stepRow}>
              <TouchableOpacity
                onPress={() => setContracts((c) => Math.max(1, c - 1))}
                style={[styles.stepBtn, { borderColor: colors.border }]}
              >
                <Ionicons name="remove" size={20} color={colors.text} />
              </TouchableOpacity>
              <Text style={[styles.mono, styles.stepValue, { color: colors.text }]}>{contracts}</Text>
              <TouchableOpacity
                onPress={() => setContracts((c) => Math.min(20, c + 1))}
                style={[styles.stepBtn, { borderColor: colors.border }]}
              >
                <Ionicons name="add" size={20} color={colors.text} />
              </TouchableOpacity>
            </View>

            <Text style={[styles.label, { color: colors.textTertiary }]}>TICKER</Text>
            <View style={styles.chips}>
              {[null, ...SIM_TICKERS].map((t) => {
                const on = t === ticker;
                return (
                  <TouchableOpacity
                    key={t ?? 'random'}
                    onPress={() => setTicker(t)}
                    style={[styles.chip, { borderColor: on ? colors.accent : colors.border, backgroundColor: on ? colors.accent + '1A' : 'transparent' }]}
                  >
                    <Text style={[styles.chipText, { color: on ? colors.accent : colors.textSecondary }]}>{t ?? 'Random'}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={[styles.label, { color: colors.textTertiary }]}>DIRECTION</Text>
            <Seg
              options={[{ label: 'Random', value: null }, { label: 'CALL', value: 'CALL' as const }, { label: 'PUT', value: 'PUT' as const }]}
              value={direction}
              onChange={setDirection}
            />

            <Text style={[styles.label, { color: colors.textTertiary }]}>ACCOUNT (display only)</Text>
            <Seg options={[{ label: 'Paper', value: true }, { label: 'Live', value: false }]} value={paper} onChange={setPaper} />

            <Text style={[styles.label, { color: colors.textTertiary }]}>PRICE MOVEMENT</Text>
            <Seg
              options={[
                { label: 'Calm', value: 'calm' as const },
                { label: 'Normal', value: 'normal' as const },
                { label: 'Wild', value: 'wild' as const },
              ]}
              value={vol}
              onChange={setVol}
            />

            <TouchableOpacity onPress={generate} activeOpacity={0.85} style={[styles.cta, { backgroundColor: colors.accent }]}>
              <Ionicons name="flask-outline" size={17} color={colors.accentForeground ?? '#fff'} />
              <Text style={[styles.ctaText, { color: colors.accentForeground ?? '#fff' }]}>Generate position</Text>
            </TouchableOpacity>

            {sims.length > 0 && (
              <>
                <View style={styles.listHead}>
                  <Text style={[styles.label, { color: colors.textTertiary, marginTop: 0 }]}>RUNNING ({sims.length})</Text>
                  <TouchableOpacity onPress={clearSimPositions} hitSlop={8}>
                    <Text style={{ color: colors.error, fontSize: 12, fontWeight: '700' }}>Clear all</Text>
                  </TouchableOpacity>
                </View>
                {sims.map((p) => {
                  const pnl = p.unrealized_pnl ?? 0;
                  return (
                    <View key={p.strategy_id} style={[styles.simRow, { borderColor: colors.border }]}>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.mono, { color: colors.text, fontWeight: '800', fontSize: 13 }]}>
                          {p.ticker} {p.direction} · {p.qty_remaining}/{p.qty_total}
                          {p.qty_working ? ` · ${p.qty_working} working` : ''}
                        </Text>
                        <Text style={[styles.mono, { color: colors.textSecondary, fontSize: 11, marginTop: 2 }]}>
                          ${p.entry_premium?.toFixed(2)} → ${p.current_price?.toFixed(2)} ·{' '}
                          <Text style={{ color: pnl >= 0 ? colors.success : colors.error }}>
                            {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}
                          </Text>
                          {'  '}SL ${p.hard_stop?.toFixed(2)} · TP ${p.tp1?.toFixed(2)}
                        </Text>
                      </View>
                      <TouchableOpacity onPress={() => removeSimPosition(p.strategy_id)} hitSlop={10}>
                        <Ionicons name="trash-outline" size={17} color={colors.textTertiary} />
                      </TouchableOpacity>
                    </View>
                  );
                })}
              </>
            )}

            {log.length > 0 && (
              <>
                <Text style={[styles.label, { color: colors.textTertiary }]}>ACTIVITY</Text>
                {log.slice(0, 12).map((e, i) => (
                  <Text key={`${e.t}-${i}`} style={[styles.mono, styles.logLine, { color: colors.textSecondary }]}>
                    {new Date(e.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}  {e.text}
                  </Text>
                ))}
              </>
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  mono: { fontFamily: 'Menlo' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { maxHeight: '90%', borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, padding: 18, paddingBottom: 34 },
  header: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 6 },
  title: { fontSize: 18, fontWeight: '700' },
  sub: { fontSize: 12, marginTop: 2 },
  label: { fontSize: 11, fontWeight: '700', letterSpacing: 0.6, marginBottom: 8, marginTop: 16 },
  stepRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 22 },
  stepBtn: { width: 44, height: 44, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  stepValue: { fontSize: 28, fontWeight: '800', minWidth: 48, textAlign: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1 },
  chipText: { fontSize: 12, fontWeight: '700' },
  seg: { flexDirection: 'row', borderWidth: 1, borderRadius: 10, overflow: 'hidden' },
  segItem: { flex: 1, alignItems: 'center', paddingVertical: 9 },
  segText: { fontSize: 13, fontWeight: '700' },
  cta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 12, marginTop: 20 },
  ctaText: { fontSize: 15, fontWeight: '800' },
  listHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 20, marginBottom: 8 },
  simRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 10, padding: 10, marginBottom: 6 },
  logLine: { fontSize: 10.5, lineHeight: 16 },
});
