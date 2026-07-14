import React, { useEffect, useState } from 'react';
import { Modal, View, Pressable, ScrollView, Switch, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '@/common/components/ui/text';
import { useThemeColors } from '@/lib/useColorScheme';
import { useServicesStatus } from '@/hooks/queries/services/useServicesStatus';
import { useStartServices, useStopServices } from '@/hooks/mutations/services/useServicesControl';
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
}

const ServiceRow: React.FC<RowProps> = ({ label, description, running, liveSince, toggle, busy, onToggle, extra }) => {
  const colors = useThemeColors();
  const [, forceTick] = useState(0);

  useEffect(() => {
    if (!running || !liveSince) return;
    const id = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [running, liveSince]);

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
          backgroundColor: running ? colors.success : colors.textTertiary,
          marginRight: 12,
        }}
      />
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.text, fontSize: 15, fontWeight: '600' }}>{label}</Text>
        <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 2 }}>
          {running
            ? liveSince
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

export const ServiceStatusModal: React.FC<ServiceStatusModalProps> = ({ visible, onClose }) => {
  const colors = useThemeColors();
  const toast = useToast();

  const { data: services } = useServicesStatus({ alwaysPoll: visible });
  const startServices = useStartServices();
  const stopServices = useStopServices();

  const { data: ingest } = useSocialIngestStatus({ alwaysPoll: visible });
  const startIngest = useStartSocialIngest();
  const stopIngest = useStopSocialIngest();

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
            />
          </View>

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
            />
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
