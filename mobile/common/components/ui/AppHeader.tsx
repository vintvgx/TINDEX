/**
 * AppHeader — global top bar shown on every tab screen, beneath the TickerTape.
 *
 * Astor-style layout: logo/wordmark on the left (the menu is now its own
 * bottom tab instead of a hamburger-opened drawer) · a quick immediate-trade
 * entry on the right, reachable from anywhere in the app instead of the
 * dashboard screen alone. Notifications moved to their own screen under
 * Menu (with an unread-count badge there) to make room for it.
 */
import React, { useMemo, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  Modal, KeyboardAvoidingView, Platform, StatusBar,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/lib/useColorScheme';
import { useUserORBFollows } from '@/hooks/mutations/ticker/tickerORB';
import { ImmediateTradePanel } from '@/common/components/strategy/ImmediateTradePanel';
import { SearchBottomSheet } from '@/common/components/search/SearchBottomSheet';

const FALLBACK_TICKERS = ['SPY', 'QQQ', 'IWM'];

// ORB-covered ETFs always sort first (alphabetically among themselves), then
// everything else alphabetically — so the tickers the strategy actually
// monitors don't get buried in an alphabetical list of followed symbols.
function etfsFirstComparator(a: string, b: string): number {
  const aEtf = FALLBACK_TICKERS.includes(a);
  const bEtf = FALLBACK_TICKERS.includes(b);
  if (aEtf !== bEtf) return aEtf ? -1 : 1;
  return a.localeCompare(b);
}

export function AppHeader() {
  const colors = useThemeColors();
  const { data: followedTickers } = useUserORBFollows();
  const [tradePanelVisible, setTradePanelVisible] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const tickerOptions = useMemo(() => {
    const followed = (followedTickers ?? []).map((f: any) => f.ticker as string).filter(Boolean);
    const unique = Array.from(new Set(followed.length ? followed : FALLBACK_TICKERS));
    return unique.sort(etfsFirstComparator);
  }, [followedTickers]);

  return (
    <View
      style={[
        styles.header,
        { backgroundColor: colors.headerBg, borderBottomColor: colors.headerBorder },
      ]}
    >
      {/* Left-aligned wordmark */}
      <View style={styles.logo} pointerEvents="none">
        <Ionicons name="sparkles" size={16} color={colors.brand} style={{ marginRight: 6 }} />
        <Text style={[styles.logoText, { color: colors.text }]}>tindex</Text>
      </View>

      <View style={styles.rightActions}>
        {/* Quick ticker search */}
        <TouchableOpacity
          onPress={() => setSearchOpen(true)}
          style={[styles.searchBtn, { backgroundColor: colors.iconButton, borderColor: colors.iconButtonBorder }]}
          accessibilityRole="button"
          accessibilityLabel="Search stocks"
        >
          <Ionicons name="search" size={16} color={colors.text} />
        </TouchableOpacity>

        {/* Quick immediate trade */}
        <TouchableOpacity
          onPress={() => setTradePanelVisible(true)}
          style={[styles.quickTradeBtn, { backgroundColor: colors.accent }]}
          accessibilityRole="button"
          accessibilityLabel="Immediate trade"
        >
          <Ionicons name="flash" size={14} color={colors.accentForeground} />
          <Text style={[styles.quickTradeBtnText, { color: colors.accentForeground }]}>
            Trade
          </Text>
        </TouchableOpacity>
      </View>

      <SearchBottomSheet visible={searchOpen} onClose={() => setSearchOpen(false)} />

      {/* Immediate trade panel — full pageSheet modal, reachable from any screen */}
      <Modal
        visible={tradePanelVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setTradePanelVisible(false)}
      >
        <StatusBar barStyle="light-content" />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={[styles.panelModal, { backgroundColor: colors.background }]}
        >
          <View style={[styles.panelHeader, { borderBottomColor: colors.border }]}>
            <TouchableOpacity
              onPress={() => setTradePanelVisible(false)}
              hitSlop={12}
              style={{ width: 64 }}
            >
              <Text style={[styles.panelClose, { color: colors.accent }]}>Close</Text>
            </TouchableOpacity>
            <Text style={[styles.panelTitle, { color: colors.text }]}>Immediate Trade</Text>
            <View style={{ width: 64 }} />
          </View>

          <ImmediateTradePanel
            colors={colors}
            tickerOptions={tickerOptions}
            visible={tradePanelVisible}
            onClose={() => setTradePanelVisible(false)}
          />
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  searchBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  quickTradeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
  },
  quickTradeBtnText: { fontSize: 13, fontWeight: '700' },
  panelModal: { flex: 1 },
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  panelClose: { fontSize: 15, fontWeight: '600' },
  panelTitle: { fontSize: 17, fontWeight: '700', textAlign: 'center' },
  logo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  logoText: {
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
});
