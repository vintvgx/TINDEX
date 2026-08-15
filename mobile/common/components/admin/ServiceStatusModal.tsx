import React, { useEffect, useState } from 'react';
import { Modal, View, Pressable, ScrollView, Switch, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/common/components/ui/text';
import { useThemeColors } from '@/lib/useColorScheme';
import { useServicesStatus, type OptionStreamSubscription } from '@/hooks/queries/services/useServicesStatus';
import {
  useStartServices, useStopServices,
  useUnsubscribeOptionStreamSymbol, useClearUnusedOptionSubscriptions,
} from '@/hooks/mutations/services/useServicesControl';
import { useSocialIngestStatus } from '@/hooks/queries/social/useSocialIngestStatus';
import { useStartSocialIngest, useStopSocialIngest } from '@/hooks/mutations/social/useSocialIngestControl';
import { useToast } from '@/common/components/ui/Toast';

interface ServiceStatusModalProps {
  visible: boolean;
  onClose: () => void;
}

function formatLiveSince(iso: string | null | undefined): string {
  if (!iso) return '';
  const started = new Date(iso).getTime();
  if (Number.isNaN(started)) return '';
  const seconds = Math.max(0, Math.floor((Date.now() - started) / 1000));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

interface RowProps {
  label: string;
  description?: string;
  running: boolean;
  liveSince?: string | null;
  toggle: boolean;
  busy?: boolean;
  onToggle?: (next: boolean) => void;
  extra?: string;
  /** Connected but not actually delivering data — the "zombie WS" case
   *  thread-liveness alone can't see (see option_stream.py's staleness
   *  tracking). Distinct from `running=false`: the connection is up, it's
   *  just not doing its job. Overrides the dot to amber and the status line
   *  to call it out explicitly instead of reading as healthy. */
  stale?: boolean;
}

const ServiceRow: React.FC<RowProps> = ({ label, description, running, liveSince, toggle, busy, onToggle, extra, stale }) => {
  const colors = useThemeColors();
  const [, forceTick] = useState(0);

  useEffect(() => {
    if (!running || !liveSince) return;
    const id = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [running, liveSince]);

  const dotColor = stale ? colors.warning : running ? colors.success : colors.textTertiary;

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 14,
        borderBottomWidth: 1,
        borderBottomColor: colors.separator,
      }}
    >
      <View
        style={{
          width: 10,
          height: 10,
          borderRadius: 5,
          backgroundColor: dotColor,
          marginRight: 12,
        }}
      />
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.text, fontSize: 15, fontWeight: '600' }}>{label}</Text>
        <Text style={{ color: stale ? colors.warning : colors.textSecondary, fontSize: 12, marginTop: 2 }}>
          {running
            ? stale
              ? `Connected but not receiving quotes${extra ? ` · ${extra}` : ''}`
              : liveSince
                ? `Live since ${formatLiveSince(liveSince)} ago${extra ? ` · ${extra}` : ''}`
                : `Running${extra ? ` · ${extra}` : ''}`
            : 'Stopped'}
        </Text>
        {description && !running && (
          <Text style={{ color: colors.textTertiary, fontSize: 11, marginTop: 2 }}>{description}</Text>
        )}
      </View>
      {toggle ? (
        busy ? (
          <ActivityIndicator size="small" color={colors.accent} />
        ) : (
          <Switch
            value={running}
            onValueChange={onToggle}
            trackColor={{ false: colors.surfaceTertiary, true: colors.success }}
            thumbColor="#ffffff"
          />
        )
      ) : (
        <View
          style={{
            paddingHorizontal: 8,
            paddingVertical: 3,
            borderRadius: 8,
            backgroundColor: colors.surfaceTertiary,
          }}
        >
          <Text style={{ color: colors.textTertiary, fontSize: 10, fontWeight: '600' }}>READ-ONLY</Text>
        </View>
      )}
    </View>
  );
};

function formatLastQuote(seconds: number | null): string {
  if (seconds == null) return 'no data yet';
  if (seconds < 60) return `${Math.round(seconds)}s ago`;
  const m = Math.round(seconds / 60);
  return `${m}m ago`;
}

interface SubscriptionRowProps {
  sub: OptionStreamSubscription;
  colors: any;
  onUnsubscribe: (symbol: string) => void;
  busy: boolean;
}

const SubscriptionRow: React.FC<SubscriptionRowProps> = ({ sub, colors, onUnsubscribe, busy }) => {
  const handlePress = () => {
    if (sub.in_use) {
      Alert.alert(
        'Backing an Open Position',
        `${sub.symbol} is currently backing an open position. Unsubscribing stops its stop-loss/take-profit monitoring until something re-subscribes it — nothing does automatically.\n\nUnsubscribe anyway?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Unsubscribe', style: 'destructive', onPress: () => onUnsubscribe(sub.symbol) },
        ],
      );
      return;
    }
    onUnsubscribe(sub.symbol);
  };

  return (
    <View
      style={{
        flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10,
        borderBottomWidth: 1, borderBottomColor: colors.separator, gap: 8,
      }}
    >
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <Text style={{ color: colors.text, fontSize: 12, fontWeight: '600' }} numberOfLines={1}>
            {sub.symbol}
          </Text>
          {sub.in_use ? (
            <View style={{ paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, backgroundColor: colors.accent + '22' }}>
              <Text style={{ color: colors.accent, fontSize: 9, fontWeight: '700' }}>OPEN POSITION</Text>
            </View>
          ) : (
            <View style={{ paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, backgroundColor: colors.surfaceTertiary }}>
              <Text style={{ color: colors.textTertiary, fontSize: 9, fontWeight: '700' }}>UNUSED</Text>
            </View>
          )}
          {sub.expired && (
            <View style={{ paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, backgroundColor: colors.errorBg }}>
              <Text style={{ color: colors.error, fontSize: 9, fontWeight: '700' }}>EXPIRED</Text>
            </View>
          )}
        </View>
        <Text style={{ color: colors.textTertiary, fontSize: 11, marginTop: 2 }}>
          {formatLastQuote(sub.last_quote_age_seconds)}
          {sub.quote_count > 0 ? ` · ${sub.quote_count} tick${sub.quote_count === 1 ? '' : 's'}` : ''}
        </Text>
      </View>
      <Pressable
        onPress={handlePress}
        disabled={busy}
        hitSlop={8}
        style={{
          width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center',
          backgroundColor: colors.errorBg, opacity: busy ? 0.5 : 1,
        }}
      >
        <Ionicons name="close" size={16} color={colors.error} />
      </Pressable>
    </View>
  );
};

export const ServiceStatusModal: React.FC<ServiceStatusModalProps> = ({ visible, onClose }) => {
  const colors = useThemeColors();
  const toast = useToast();
  const [subsExpanded, setSubsExpanded] = useState(false);

  const { data: services } = useServicesStatus({ alwaysPoll: visible });
  const startServices = useStartServices();
  const stopServices = useStopServices();

  const { data: ingest } = useSocialIngestStatus({ alwaysPoll: visible });
  const startIngest = useStartSocialIngest();
  const stopIngest = useStopSocialIngest();
  const ingestAccountErrors = (ingest?.accounts ?? []).filter((a) => a.last_poll_error);

  const unsubscribeSymbol = useUnsubscribeOptionStreamSymbol();
  const clearUnused = useClearUnusedOptionSubscriptions();

  const handleUnsubscribe = (symbol: string) => {
    unsubscribeSymbol.mutate(symbol, {
      onSuccess: () => toast.success(`Unsubscribed ${symbol}`),
      onError: (err) => toast.error(err.message || `Failed to unsubscribe ${symbol}`),
    });
  };

  const handleClearUnused = () => {
    const count = services?.option_quote_stream.unused_count ?? 0;
    if (count === 0) return;
    Alert.alert(
      'Clear Unused Subscriptions',
      `Unsubscribe ${count} symbol${count === 1 ? '' : 's'} not backing any open position?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: () => clearUnused.mutate(undefined, {
            onSuccess: (r) => toast.success(`Cleared ${r.cleared_count} unused subscription${r.cleared_count === 1 ? '' : 's'}`),
            onError: (err) => toast.error(err.message || 'Failed to clear unused subscriptions'),
          }),
        },
      ],
    );
  };

  const toggleService = (name: 'orb' | 'contracts', next: boolean) => {
    const mutation = next ? startServices : stopServices;
    mutation.mutate(
      { services: [name] },
      {
        onSuccess: (res) => {
          const result = res.results[name];
          if (result?.success === false) {
            toast.error(result.message || `Failed to ${next ? 'start' : 'stop'} ${name}`);
          } else {
            toast.success(result?.message || `${name} ${next ? 'started' : 'stopped'}`);
          }
        },
        onError: (err) => toast.error(err instanceof Error ? err.message : `Failed to ${next ? 'start' : 'stop'} ${name}`),
      },
    );
  };

  const toggleIngest = (next: boolean) => {
    const mutation = next ? startIngest : stopIngest;
    mutation.mutate(undefined, {
      onSuccess: (res) => toast.success(res.message || `Social ingest ${next ? 'started' : 'stopped'}`),
      onError: (err) => toast.error(err instanceof Error ? err.message : 'Social ingest control failed'),
    });
  };

  const orbBusy = startServices.isPending || stopServices.isPending;
  const ingestBusy = startIngest.isPending || stopIngest.isPending;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top', 'bottom']}>
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingHorizontal: 20,
            paddingVertical: 16,
            borderBottomWidth: 1,
            borderBottomColor: colors.separator,
          }}
        >
          <Text style={{ color: colors.text, fontSize: 20, fontWeight: '800' }}>Service Status</Text>
          <Pressable
            onPress={onClose}
            style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: colors.iconButton, alignItems: 'center', justifyContent: 'center' }}
          >
            <Ionicons name="close" size={18} color={colors.textSecondary} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
          <Text
            style={{
              color: colors.textTertiary,
              fontSize: 12,
              fontWeight: '600',
              textTransform: 'uppercase',
              letterSpacing: 0.8,
              paddingHorizontal: 20,
              paddingTop: 20,
              paddingBottom: 8,
            }}
          >
            Trading Services
          </Text>
          <View style={{ marginHorizontal: 16, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, overflow: 'hidden' }}>
            <ServiceRow
              label="ORB Strategy Engine"
              description="9:30–16:00 ET"
              running={services?.orb.running ?? false}
              liveSince={services?.orb.live_since}
              toggle={services?.orb.toggle ?? true}
              busy={orbBusy}
              onToggle={(next) => toggleService('orb', next)}
              extra={services?.orb.active_tickers?.length ? `${services.orb.active_tickers.length} tickers` : undefined}
            />
            <ServiceRow
              label="Options Contract Monitor"
              description="Tracks watched contracts"
              running={services?.contracts.running ?? false}
              liveSince={services?.contracts.live_since}
              toggle={services?.contracts.toggle ?? true}
              busy={orbBusy}
              onToggle={(next) => toggleService('contracts', next)}
            />
            <ServiceRow
              label="Social Signal Ingest"
              description="X/Twitter contract signal parsing"
              running={ingest?.running ?? false}
              liveSince={ingest?.live_since}
              toggle={ingest?.toggle ?? true}
              busy={ingestBusy}
              onToggle={toggleIngest}
              extra={ingest?.last_poll_summary ?? undefined}
            />
          </View>

          {ingestAccountErrors.length > 0 && (
            <View
              style={{
                marginHorizontal: 16,
                marginTop: 10,
                padding: 12,
                borderRadius: 12,
                backgroundColor: colors.errorBg,
                borderWidth: 1,
                borderColor: colors.error,
              }}
            >
              {ingestAccountErrors.map((a) => (
                <Text key={a.id} style={{ color: colors.error, fontSize: 12, marginBottom: 2 }}>
                  @{a.handle}: {a.last_poll_error}
                </Text>
              ))}
            </View>
          )}

          <Text
            style={{
              color: colors.textTertiary,
              fontSize: 12,
              fontWeight: '600',
              textTransform: 'uppercase',
              letterSpacing: 0.8,
              paddingHorizontal: 20,
              paddingTop: 24,
              paddingBottom: 8,
            }}
          >
            Live Data Streams
          </Text>
          <View style={{ marginHorizontal: 16, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, overflow: 'hidden' }}>
            <ServiceRow
              label="Option Quote Stream"
              description="Powers open-position stop-loss/TP monitoring"
              running={services?.option_quote_stream.running ?? false}
              toggle={false}
              stale={services?.option_quote_stream.stale ?? false}
              extra={
                services?.option_quote_stream.subscribed_count
                  ? `${services.option_quote_stream.subscribed_count} symbol${services.option_quote_stream.subscribed_count === 1 ? '' : 's'}` +
                    (services.option_quote_stream.last_quote_age_seconds != null
                      ? ` · last quote ${Math.round(services.option_quote_stream.last_quote_age_seconds)}s ago`
                      : '')
                  : 'idle — no open positions or active entries'
              }
            />

            {/* Expired-but-still-subscribed contracts — proof a close/exit
                path didn't unsubscribe. Subscriptions are additive on
                Alpaca's side with no automatic expiry, so this is the signal
                that the connection is slowly leaking toward the account's
                channel cap. Always visible (not collapsed) when nonzero,
                since it's the actionable part. */}
            {!!services?.option_quote_stream.expired_count && (
              <View
                style={{
                  paddingHorizontal: 16,
                  paddingVertical: 12,
                  backgroundColor: colors.errorBg,
                  borderBottomWidth: 1,
                  borderBottomColor: colors.separator,
                }}
              >
                <Text style={{ color: colors.error, fontSize: 12, fontWeight: '700', marginBottom: 4 }}>
                  {services.option_quote_stream.expired_count} expired contract
                  {services.option_quote_stream.expired_count === 1 ? '' : 's'} still subscribed
                </Text>
                <Text style={{ color: colors.error, fontSize: 11, lineHeight: 15 }}>
                  {services.option_quote_stream.expired_symbols?.join(', ')}
                </Text>
              </View>
            )}

            {/* Full subscription list — collapsed by default. Each row can be
                unsubscribed individually; "Clear Unused" bulk-removes every
                symbol not currently backing an open position, which is the
                remediation for a connection that's slowly leaked dead
                symbols across weeks of uptime without a restart. */}
            {!!services?.option_quote_stream.subscribed_count && (
              <View>
                <Pressable
                  onPress={() => setSubsExpanded((v) => !v)}
                  style={{
                    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                    paddingHorizontal: 16, paddingVertical: 10,
                    backgroundColor: colors.surfaceTertiary,
                    borderBottomWidth: subsExpanded ? 1 : 0,
                    borderBottomColor: colors.separator,
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Ionicons name={subsExpanded ? 'chevron-up' : 'chevron-down'} size={14} color={colors.textTertiary} />
                    <Text style={{ color: colors.textSecondary, fontSize: 12, fontWeight: '600' }}>
                      {subsExpanded ? 'Hide' : 'View'} subscribed symbols
                    </Text>
                  </View>
                  {!!services.option_quote_stream.unused_count && (
                    <Pressable
                      onPress={handleClearUnused}
                      disabled={clearUnused.isPending}
                      style={{
                        paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8,
                        backgroundColor: colors.errorBg, opacity: clearUnused.isPending ? 0.5 : 1,
                      }}
                    >
                      {clearUnused.isPending ? (
                        <ActivityIndicator size="small" color={colors.error} />
                      ) : (
                        <Text style={{ color: colors.error, fontSize: 11, fontWeight: '700' }}>
                          Clear Unused ({services.option_quote_stream.unused_count})
                        </Text>
                      )}
                    </Pressable>
                  )}
                </Pressable>
                {subsExpanded && (services.option_quote_stream.subscriptions ?? []).map((sub) => (
                  <SubscriptionRow
                    key={sub.symbol}
                    sub={sub}
                    colors={colors}
                    onUnsubscribe={handleUnsubscribe}
                    busy={unsubscribeSymbol.isPending && unsubscribeSymbol.variables === sub.symbol}
                  />
                ))}
              </View>
            )}

            <ServiceRow
              label="Price Stream"
              description="Live ticker prices across the app"
              running={services?.price_stream.running ?? false}
              toggle={false}
              extra={services?.price_stream.clients != null ? `${services.price_stream.clients} clients` : undefined}
            />
            <ServiceRow
              label="Social Signal Price Stream"
              description="Live prices for tracked signal contracts"
              running={services?.social_signals_price_stream.running ?? false}
              toggle={false}
              extra={
                services?.social_signals_price_stream.clients != null
                  ? `${services.social_signals_price_stream.clients} clients`
                  : undefined
              }
            />
          </View>

          <Text style={{ color: colors.textTertiary, fontSize: 11, paddingHorizontal: 24, paddingTop: 16, lineHeight: 16 }}>
            Live data streams have no stop toggle — open positions rely on them continuously,
            so they aren't exposed as something that can be switched off by mistake.
          </Text>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
};
