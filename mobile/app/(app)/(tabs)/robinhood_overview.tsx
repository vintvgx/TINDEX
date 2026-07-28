import React, { useCallback, useState } from 'react';
import {
  View, Text, ScrollView, SafeAreaView, TouchableOpacity, TextInput,
  ActivityIndicator, StyleSheet, RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useThemeColors } from '@/lib/useColorScheme';
import { useRobinhoodAccount, useRobinhoodHoldings } from '@/hooks/queries/robinhood/useRobinhoodAccount';
import { useRobinhoodLogin, useRobinhoodVerify } from '@/hooks/mutations/robinhood/useRobinhoodAuth';
import { StatPill } from '@/common/components/ui/StatPill';

const ROBINHOOD_GREEN = '#00C805';

interface Props {
  /** True when rendered as a SegmentedPager scene (Accounts tab). */
  embedded?: boolean;
}

/**
 * Robinhood account summary + holdings — read-only, no trading path exists
 * through this screen or the backend it calls (see api/services/robinhood/
 * robinhood_service.py's docstring). Sign-in is username/password + a
 * Robinhood-texted SMS code (passkeys replaced TOTP enrollment for this kind
 * of login, so there's no authenticator-app path anymore) — the code has to
 * be typed in by hand here when Robinhood asks for one.
 */
export default function RobinhoodScreen({ embedded = false }: Props) {
  const colors = useThemeColors();
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const [code, setCode] = useState('');

  const { data: account, isLoading: acctLoading, refetch: refetchAccount } = useRobinhoodAccount();
  const { data: holdingsData, isLoading: holdingsLoading, refetch: refetchHoldings } = useRobinhoodHoldings();
  const loginMutation = useRobinhoodLogin();
  const verifyMutation = useRobinhoodVerify();

  const isLoading = (acctLoading || holdingsLoading) && !account;

  const handlePullRefresh = useCallback(async () => {
    setManualRefreshing(true);
    await Promise.all([refetchAccount(), refetchHoldings()]);
    setManualRefreshing(false);
  }, [refetchAccount, refetchHoldings]);

  const handleVerify = useCallback(async () => {
    if (!code.trim()) return;
    const res = await verifyMutation.mutateAsync(code.trim());
    if (res.status === 'ok') setCode('');
  }, [code, verifyMutation]);

  const holdings = holdingsData?.holdings ?? [];
  const authIssue = !account?.available && account?.status && account.status !== 'ok';

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      {!embedded && (
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="arrow-back" size={22} color={colors.text} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: colors.text }]}>Robinhood</Text>
          <View style={{ width: 22 }} />
        </View>
      )}

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={manualRefreshing} onRefresh={handlePullRefresh} tintColor={ROBINHOOD_GREEN} />
        }
      >
        {isLoading ? (
          <ActivityIndicator color={ROBINHOOD_GREEN} style={{ marginTop: 60 }} />
        ) : authIssue ? (
          <AuthStatusCard
            status={account!.status!}
            message={account!.message}
            colors={colors}
            code={code}
            onChangeCode={setCode}
            onVerify={handleVerify}
            verifying={verifyMutation.isPending}
            verifyError={verifyMutation.data?.status === 'error' ? verifyMutation.data.message : undefined}
            onRetry={() => loginMutation.mutate()}
            retrying={loginMutation.isPending}
          />
        ) : (
          <>
            <AccountCard account={account} colors={colors} />

            {holdings.length > 0 && (
              <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.cardLabel, { color: colors.text, marginBottom: 2 }]}>Holdings</Text>
                <Text style={[styles.cardSubtitle, { color: colors.tabBarInactive, marginBottom: 10 }]}>
                  {holdings.length} position{holdings.length === 1 ? '' : 's'}
                </Text>
                {holdings.map((h, i) => {
                  const plColor = h.unrealized_pl >= 0 ? colors.success : colors.error;
                  return (
                    <View
                      key={h.ticker}
                      style={[
                        styles.holdingRow,
                        i < holdings.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.separator },
                      ]}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.holdingTicker, { color: colors.text }]}>{h.ticker}</Text>
                        <Text style={[styles.holdingDesc, { color: colors.tabBarInactive }]} numberOfLines={1}>
                          {h.quantity} sh @ ${h.average_cost.toFixed(2)} avg · ${h.price.toFixed(2)}
                        </Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={[styles.holdingValue, { color: colors.text }]}>
                          ${h.market_value.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </Text>
                        <Text style={[styles.holdingPnl, { color: plColor }]}>
                          {h.unrealized_pl >= 0 ? '+' : ''}${h.unrealized_pl.toFixed(2)} ({h.unrealized_pl_pct >= 0 ? '+' : ''}{h.unrealized_pl_pct.toFixed(2)}%)
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}

            {holdings.length === 0 && account?.available && (
              <Text style={[styles.disclaimer, { color: colors.tabBarInactive }]}>No open holdings.</Text>
            )}

            <Text style={[styles.disclaimer, { color: colors.tabBarInactive }]}>
              View only — this account is never traded through the app.
            </Text>
          </>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const AccountCard = ({ account, colors }: { account?: { equity?: number; cash?: number; buying_power?: number; market_value?: number; pnl_today?: number; pnl_today_pct?: number } | null; colors: any }) => {
  const pnl = account?.pnl_today ?? 0;
  const pnlPct = account?.pnl_today_pct ?? 0;
  const pnlColor = pnl >= 0 ? colors.success : colors.error;

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.cardHeader}>
        <View>
          <View style={styles.labelRow}>
            <View style={[styles.dot, { backgroundColor: ROBINHOOD_GREEN }]} />
            <Text style={[styles.cardLabel, { color: colors.text }]}>Robinhood</Text>
          </View>
          <Text style={[styles.cardSubtitle, { color: colors.tabBarInactive }]}>Individual brokerage — view only</Text>
        </View>
      </View>

      <Text style={[styles.equity, { color: colors.text }]}>
        ${(account?.equity ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
      </Text>

      <View style={styles.pnlRow}>
        <View style={[styles.pnlPill, { backgroundColor: pnlColor + '18' }]}>
          <Ionicons name={pnl >= 0 ? 'trending-up' : 'trending-down'} size={14} color={pnlColor} />
          <Text style={[styles.pnlValue, { color: pnlColor }]}>
            {pnl >= 0 ? '+' : ''}${Math.abs(pnl).toFixed(2)}
          </Text>
          <Text style={[styles.pnlPct, { color: pnlColor }]}>
            ({pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%)
          </Text>
        </View>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={[styles.statsScroll, { borderTopColor: colors.border }]}
        contentContainerStyle={styles.statsScrollContent}
      >
        <StatPill label="Cash" value={`$${(account?.cash ?? 0).toLocaleString('en-US', { minimumFractionDigits: 0 })}`} accentColor={ROBINHOOD_GREEN} colors={colors} />
        <StatPill label="Buying Power" value={`$${(account?.buying_power ?? 0).toLocaleString('en-US', { minimumFractionDigits: 0 })}`} accentColor={ROBINHOOD_GREEN} colors={colors} />
        <StatPill label="Market Value" value={`$${(account?.market_value ?? 0).toLocaleString('en-US', { minimumFractionDigits: 0 })}`} accentColor={ROBINHOOD_GREEN} colors={colors} />
      </ScrollView>
    </View>
  );
};

/**
 * Distinct copy per backend auth status (see robinhood_service.py's
 * RobinhoodAuthError) — "not connected" (no creds set) reads very
 * differently from "type in the code we just texted you", so these are
 * never collapsed into one generic error message.
 */
const AUTH_STATUS_COPY: Record<string, { icon: keyof typeof Ionicons.glyphMap; title: string; fallback: string }> = {
  unauthenticated: {
    icon: 'key-outline',
    title: 'Robinhood not connected',
    fallback: 'Add ROBINHOOD_USERNAME / ROBINHOOD_PASSWORD to the backend config.',
  },
  mfa_required: {
    icon: 'chatbox-ellipses-outline',
    title: 'Enter verification code',
    fallback: 'Robinhood texted you a code — enter it below to finish signing in.',
  },
  error: {
    icon: 'warning-outline',
    title: 'Robinhood sign-in failed',
    fallback: 'Check the configured credentials, then try again.',
  },
};

const AuthStatusCard = ({
  status, message, colors, code, onChangeCode, onVerify, verifying, verifyError, onRetry, retrying,
}: {
  status: string; message?: string; colors: any;
  code: string; onChangeCode: (v: string) => void; onVerify: () => void; verifying: boolean; verifyError?: string;
  onRetry: () => void; retrying: boolean;
}) => {
  const copy = AUTH_STATUS_COPY[status] ?? AUTH_STATUS_COPY.error;
  const isMfa = status === 'mfa_required';

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, alignItems: 'center', paddingVertical: 28, gap: 10 }]}>
      <Ionicons name={copy.icon} size={32} color={colors.warning} />
      <Text style={[styles.cardLabel, { color: colors.text }]}>{copy.title}</Text>
      <Text style={[styles.cardSubtitle, { color: colors.tabBarInactive, textAlign: 'center' }]}>
        {message || copy.fallback}
      </Text>

      {isMfa ? (
        <>
          <TextInput
            value={code}
            onChangeText={onChangeCode}
            placeholder="123456"
            placeholderTextColor={colors.tabBarInactive}
            keyboardType="number-pad"
            maxLength={8}
            style={[styles.codeInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
          />
          {!!verifyError && (
            <Text style={{ color: colors.error, fontSize: 12 }}>{verifyError}</Text>
          )}
          <TouchableOpacity
            onPress={onVerify}
            disabled={verifying || !code.trim()}
            activeOpacity={0.75}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, backgroundColor: ROBINHOOD_GREEN, opacity: verifying || !code.trim() ? 0.5 : 1 }}
          >
            {verifying
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>Verify</Text>}
          </TouchableOpacity>
          <TouchableOpacity onPress={onRetry} disabled={retrying} activeOpacity={0.7} style={{ marginTop: 2 }}>
            <Text style={{ color: colors.tabBarInactive, fontSize: 12, fontWeight: '600' }}>
              {retrying ? 'Resending…' : "Didn't get a code? Resend"}
            </Text>
          </TouchableOpacity>
        </>
      ) : (
        <TouchableOpacity
          onPress={onRetry}
          disabled={retrying}
          activeOpacity={0.75}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: ROBINHOOD_GREEN + '18' }}
        >
          <Ionicons name="refresh" size={14} color={ROBINHOOD_GREEN} />
          <Text style={{ color: ROBINHOOD_GREEN, fontSize: 13, fontWeight: '700' }}>{retrying ? 'Retrying…' : 'Retry'}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  content:   { paddingHorizontal: 16, paddingTop: 16, gap: 12 },
  header:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  title:     { fontSize: 20, fontWeight: '700' },

  card:         { borderRadius: 16, padding: 16, gap: 10, borderWidth: 1 },
  cardHeader:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  labelRow:     { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 3 },
  dot:          { width: 9, height: 9, borderRadius: 5 },
  cardLabel:    { fontSize: 17, fontWeight: '700' },
  cardSubtitle: { fontSize: 12 },

  equity:  { fontSize: 30, fontWeight: '700' },
  pnlRow:  { flexDirection: 'row' },
  pnlPill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10 },
  pnlValue:{ fontSize: 15, fontWeight: '700' },
  pnlPct:  { fontSize: 13, fontWeight: '600' },

  statsScroll: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: 2, height: 84 },
  statsScrollContent: { paddingTop: 12, paddingRight: 4 },

  holdingRow:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10 },
  holdingTicker: { fontSize: 13, fontWeight: '600', marginBottom: 2 },
  holdingDesc:   { fontSize: 11 },
  holdingValue:  { fontSize: 14, fontWeight: '700', marginBottom: 2 },
  holdingPnl:    { fontSize: 10, fontWeight: '600' },

  codeInput: {
    borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10,
    fontSize: 18, fontWeight: '700', letterSpacing: 4, textAlign: 'center', minWidth: 160, marginTop: 4,
  },

  disclaimer: { fontSize: 11, lineHeight: 17, marginTop: 4 },
});
