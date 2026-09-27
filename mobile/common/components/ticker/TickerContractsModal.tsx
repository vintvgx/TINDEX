import type React from 'react';
import { useState } from 'react';
import { Modal, View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useThemeColors } from '@/lib/useColorScheme';
import { OptionsChainPicker } from '@/common/components/strategy/OptionsChainPicker';

interface Props {
  ticker: string;
  visible: boolean;
  onClose: () => void;
  /** Pass stockData?.has_options when known — undefined (still loading) is
   *  treated as "assume yes" so the chain isn't hidden behind a flash of the
   *  empty state on every open. */
  hasOptions?: boolean;
}

/**
 * Full-screen "{ticker} Contracts" chain browser — the same
 * paper/live-toggle-plus-OptionsChainPicker pairing already used in
 * TickerDetailSheet's Contracts tab and ImmediateTradePanel, just presented
 * as its own Modal (centered title, no back-navigation-into-a-sheet) for
 * callers that aren't already inside a ticker detail sheet, e.g. the Charts
 * tab's "Contracts" button.
 */
export function TickerContractsModal({ ticker, visible, onClose, hasOptions }: Props) {
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet">
      {/* Nested SafeAreaProvider — a bare RN Modal is a separate native view
          hierarchy that the outer SafeAreaProvider can't measure, so insets
          would otherwise silently come back as 0 (see MarketDigestModal). */}
      <SafeAreaProvider>
        <ContractsModalContent ticker={ticker} onClose={onClose} hasOptions={hasOptions} />
      </SafeAreaProvider>
    </Modal>
  );
}

function ContractsModalContent({ ticker, onClose, hasOptions }: Omit<Props, 'visible'>) {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const [paperMode, setPaperMode] = useState(true);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top }}>
      <View style={{
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.separator,
      }}>
        <View style={{ width: 30 }} />
        <Text style={{ color: colors.text, fontSize: 17, fontWeight: '700' }}>{ticker} Contracts</Text>
        <TouchableOpacity onPress={onClose} hitSlop={10} style={{ width: 30, alignItems: 'flex-end' }}>
          <Ionicons name="close" size={22} color={colors.text} />
        </TouchableOpacity>
      </View>

      {hasOptions === false ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
          <Ionicons name="analytics-outline" size={40} color={colors.textTertiary} />
          <Text style={{ marginTop: 14, fontSize: 15, fontWeight: '600', color: colors.text, textAlign: 'center' }}>
            No Options Available
          </Text>
          <Text style={{ marginTop: 6, fontSize: 13, color: colors.textSecondary, textAlign: 'center', lineHeight: 18 }}>
            {ticker} does not have options trading available.
          </Text>
        </View>
      ) : (
        <>
          <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
            <View style={{ flexDirection: 'row', borderRadius: 10, borderWidth: 1, padding: 3, backgroundColor: colors.card, borderColor: colors.border }}>
              {([['Paper', true], ['Live', false]] as const).map(([label, isPaper]) => {
                const active = paperMode === isPaper;
                const tint = isPaper ? '#FF9F0A' : '#30D158';
                return (
                  <TouchableOpacity
                    key={label}
                    onPress={() => setPaperMode(isPaper)}
                    style={[
                      { flex: 1, alignItems: 'center', paddingVertical: 7 },
                      active && { backgroundColor: tint + '22', borderRadius: 8 },
                    ]}
                  >
                    <Text style={{ fontSize: 13, color: active ? tint : colors.tabBarInactive, fontWeight: active ? '700' : '500' }}>
                      {label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
          <OptionsChainPicker
            ticker={ticker}
            colors={colors}
            visible
            paperMode={paperMode}
            onChangePaperMode={setPaperMode}
            onSubmitted={onClose}
          />
        </>
      )}
    </View>
  );
}
