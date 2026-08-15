import React, { useCallback, useState } from 'react';
import {
  View, Text, ScrollView, SafeAreaView, TouchableOpacity, TextInput,
  ActivityIndicator, StyleSheet, RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useThemeColors } from '@/lib/useColorScheme';
import {
  useRobinhoodAccount, useRobinhoodHoldings, useRobinhoodEquityHistory, useRobinhoodOptionPositions,
} from '@/hooks/queries/robinhood/useRobinhoodAccount';
import { useRobinhoodLogin, useRobinhoodVerify } from '@/hooks/mutations/robinhood/useRobinhoodAuth';
import { useAlpacaBothAccounts } from '@/hooks/queries/strategy/useAlpacaAccounts';
import { BrokerBalanceCard } from '@/common/components/robinhood/BrokerBalanceCard';
import { HoldingsSection } from '@/common/components/robinhood/HoldingsSection';
import { OptionPositionsSection } from '@/common/components/robinhood/OptionPositionsSection';
import { BenchmarkCard } from '@/common/components/robinhood/BenchmarkCard';

const ROBINHOOD_GREEN = '#00C805';

// Module-level, not AsyncStorage — deliberately resets on cold start (a
// fresh JS bundle) but stays true across tab navigation within the same app
// launch, so the user is prompted once per launch rather than on every
// single visit to this tab. See useRobinhoodAccount()'s docstring: the
// first fetch after this flips true can trigger a real Robinhood login
// (and possibly a live SMS), so it must never happen before an explicit tap.
let robinhoodConnectedThisLaunch = false;

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
 *
 * The backend now persists robin_stocks's session (device token + access/
 * refresh token) to Supabase across process restarts (see
 * robinhood_service.py's _restore_session_from_supabase /
 * _persist_session_to_supabase and supabase/migrations/
 * 20260802_robinhood_session.sql) — that's the actual fix for "signed out
 * every time": Railway wipes the container's local disk on every restart,
 * which used to force a brand new, Robinhood-unrecognized device token (and
 * therefore a fresh SMS challenge) on every single restart. The explicit
 * "Access Account" flow below still exists for whenever a real re-auth is
 * genuinely needed (expired refresh token, revoked device, etc).
 */
export default function RobinhoodScreen({ embedded = false }: Props) {
  const colors = useThemeColors();
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const [code, setCode] = useState('');
  const [connectRequested, setConnectRequested] = useState(robinhoodConnectedThisLaunch);

  const { data: account, isLoading: acctLoading, refetch: refetchAccount } = useRobinhoodAccount(connectRequested);
  const { data: holdingsData, isLoading: holdingsLoading, refetch: refetchHoldings } = useRobinhoodHoldings(connectRequested);
  const connected = !!account?.available;
  const { data: equityHistory } = useRobinhoodEquityHistory('day', connected);
  const { data: optionPositionsData } = useRobinhoodOptionPositions(connected);
  const { data: alpaca } = useAlpacaBothAccounts();
  const loginMutation = useRobinhoodLogin();
  const verifyMutation = useRobinhoodVerify();

  const handleConnect = useCallback(() => {
    robinhoodConnectedThisLaunch = true;
    setConnectRequested(true);
  }, []);

  const isLoading = connectRequested && (acctLoading || holdingsLoading) && !account;

  const handlePullRefresh = useCallback(async () => {
    // refetch() ignores a query's `enabled: false` and fires regardless —
    // guard explicitly so pulling to refresh before tapping "Connect" can't
    // sneak past the gate above and trigger a real Robinhood login.
    if (!connectRequested) return;
    setManualRefreshing(true);
    await Promise.all([refetchAccount(), refetchHoldings()]);
    setManualRefreshing(false);
  }, [connectRequested, refetchAccount, refetchHoldings]);

  const handleVerify = useCallback(async () => {
    if (!code.trim()) return;
    const res = await verifyMutation.mutateAsync(code.trim());
    if (res.status === 'ok') setCode('');
  }, [code, verifyMutation]);

  const holdings = holdingsData?.holdings ?? [];
  const optionPositions = optionPositionsData?.positions ?? [];
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
        {!connectRequested ? (
          <ConnectPromptCard onConnect={handleConnect} colors={colors} />
        ) : isLoading ? (
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
            onAccessAccount={() => loginMutation.mutate()}
            accessing={loginMutation.isPending}
          />
        ) : (
          <>
            <BrokerBalanceCard
              robinhood={account}
              robinhoodEquityHistory={equityHistory}
              alpaca={alpaca}
              colors={colors}
            />

            <BenchmarkCard colors={colors} />

            <HoldingsSection holdings={holdings} colors={colors} />

            {holdings.length === 0 && account?.available && (
              <Text style={[styles.disclaimer, { color: colors.tabBarInactive }]}>No open holdings.</Text>
            )}

            <OptionPositionsSection positions={optionPositions} colors={colors} />

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

/**
 * Shown before the account/holdings queries are allowed to fire at all —
 * see robinhoodConnectedThisLaunch above. Fetching this data is what makes
 * the backend attempt a real Robinhood login the first time there's no
 * active session, so this tap is the actual gate, not just a loading state.
 */
const ConnectPromptCard = ({ onConnect, colors }: { onConnect: () => void; colors: any }) => (
  <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, alignItems: 'center', paddingVertical: 28, gap: 10 }]}>
    <Ionicons name="log-in-outline" size={32} color={colors.tabBarInactive} />
    <Text style={[styles.cardLabel, { color: colors.text }]}>Connect to Robinhood</Text>
    <Text style={[styles.cardSubtitle, { color: colors.tabBarInactive, textAlign: 'center' }]}>
      Tap below to check your account status and load your portfolio.
    </Text>
    <TouchableOpacity
      onPress={onConnect}
      activeOpacity={0.8}
      style={[styles.accessButton, { backgroundColor: ROBINHOOD_GREEN }]}
    >
      <Ionicons name="log-in-outline" size={18} color="#fff" />
      <Text style={styles.accessButtonText}>Connect</Text>
    </TouchableOpacity>
  </View>
);

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
    fallback: 'Tap below to sign in to your Robinhood account.',
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
  status, message, colors, code, onChangeCode, onVerify, verifying, verifyError, onAccessAccount, accessing,
}: {
  status: string; message?: string; colors: any;
  code: string; onChangeCode: (v: string) => void; onVerify: () => void; verifying: boolean; verifyError?: string;
  onAccessAccount: () => void; accessing: boolean;
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
          <TouchableOpacity onPress={onAccessAccount} disabled={accessing} activeOpacity={0.7} style={{ marginTop: 2 }}>
            <Text style={{ color: colors.tabBarInactive, fontSize: 12, fontWeight: '600' }}>
              {accessing ? 'Resending…' : "Didn't get a code? Resend"}
            </Text>
          </TouchableOpacity>
        </>
      ) : (
        // The "Access Account" CTA the app shows any time the account isn't
        // signed in (no active session, or a previous attempt errored) — a
        // deliberate, explicit tap rather than the screen silently retrying
        // on its own, since a tap can trigger a real Robinhood SMS send.
        <TouchableOpacity
          onPress={onAccessAccount}
          disabled={accessing}
          activeOpacity={0.8}
          style={[styles.accessButton, { backgroundColor: ROBINHOOD_GREEN, opacity: accessing ? 0.75 : 1 }]}
        >
          {accessing ? (
            <>
              <ActivityIndicator color="#fff" size="small" />
              <Text style={styles.accessButtonText}>Connecting…</Text>
            </>
          ) : (
            <>
              <Ionicons name="log-in-outline" size={18} color="#fff" />
              <Text style={styles.accessButtonText}>Access Account</Text>
            </>
          )}
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
  cardLabel:    { fontSize: 17, fontWeight: '700' },
  cardSubtitle: { fontSize: 12 },

  accessButton: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8,
    paddingHorizontal: 24, paddingVertical: 13, borderRadius: 12, minWidth: 200, justifyContent: 'center',
  },
  accessButtonText: { color: '#fff', fontSize: 15, fontWeight: '700' },

  codeInput: {
    borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10,
    fontSize: 18, fontWeight: '700', letterSpacing: 4, textAlign: 'center', minWidth: 160, marginTop: 4,
  },

  disclaimer: { fontSize: 11, lineHeight: 17, marginTop: 4 },
});
