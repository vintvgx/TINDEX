import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  FlatList,
  StatusBar,
  Share,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/lib/useColorScheme';
import {
  networkDiagnostics,
  DiagEntry,
  DiagSocket,
} from '@/common/services/NetworkDiagnosticsService';

interface DiagnosticsModalProps {
  visible: boolean;
  onClose: () => void;
}

type Filter = 'all' | 'errors' | 'slow';

const fmtTime = (ts: number) =>
  new Date(ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });

const METHOD_COLORS: Record<string, string> = {
  GET: '#4ade80',
  POST: '#60a5fa',
  PUT: '#c084fc',
  PATCH: '#c084fc',
  DELETE: '#f87171',
  WS: '#22d3ee',
  OTHER: '#a1a1aa',
};

const Row = React.memo(function Row({
  entry,
  colors,
}: {
  entry: DiagEntry;
  colors: ReturnType<typeof useThemeColors>;
}) {
  const methodColor = METHOD_COLORS[entry.method] ?? METHOD_COLORS.OTHER;
  const isError = (entry.status != null && entry.status >= 400) || !!entry.error;
  const isSlow = (entry.durationMs ?? 0) > 1000;
  return (
    <View
      style={{
        paddingVertical: 6,
        paddingHorizontal: 14,
        borderBottomWidth: 1,
        borderBottomColor: colors.separator,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
        <Text style={{ color: colors.textTertiary, fontSize: 11, fontFamily: 'monospace', marginRight: 8 }}>
          {fmtTime(entry.ts)}
        </Text>
        <Text style={{ color: methodColor, fontSize: 11, fontWeight: '700', fontFamily: 'monospace', marginRight: 6 }}>
          {entry.method}
        </Text>
        <Text
          style={{ color: colors.text, fontSize: 11, fontFamily: 'monospace', flex: 1 }}
          numberOfLines={2}
        >
          {entry.url}
        </Text>
        {entry.durationMs != null && (
          <Text
            style={{
              color: isSlow ? colors.warning : colors.textSecondary,
              fontSize: 11,
              fontFamily: 'monospace',
              marginLeft: 6,
            }}
          >
            {entry.durationMs}ms
          </Text>
        )}
      </View>
      <Text style={{ color: colors.textTertiary, fontSize: 10.5, fontFamily: 'monospace', marginTop: 2 }} numberOfLines={1}>
        {isError ? (
          <Text style={{ color: colors.error }}>{entry.error ?? `HTTP ${entry.status}`}</Text>
        ) : (
          <Text>
            <Text style={{ color: colors.textSecondary }}>{entry.status ?? '—'}</Text>
            {entry.bytes != null && <Text> · {(entry.bytes / 1024).toFixed(1)}kb</Text>}
          </Text>
        )}
        <Text> · </Text>
        <Text style={{ color: '#22d3ee' }}>{entry.screen}</Text>
        {entry.source ? <Text> · {entry.source}</Text> : null}
      </Text>
    </View>
  );
});

function SocketRow({ socket, colors }: { socket: DiagSocket; colors: ReturnType<typeof useThemeColors> }) {
  const ageS = Math.round(((socket.closedAt ?? Date.now()) - socket.connectedAt) / 1000);
  return (
    <View
      style={{
        paddingVertical: 6,
        paddingHorizontal: 14,
        borderBottomWidth: 1,
        borderBottomColor: colors.separator,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
        <Text style={{ color: '#22d3ee', fontSize: 11, fontWeight: '700', fontFamily: 'monospace', marginRight: 6 }}>
          WS
        </Text>
        <Text style={{ color: colors.text, fontSize: 11, fontFamily: 'monospace', flex: 1 }} numberOfLines={2}>
          {socket.url}
        </Text>
        <Text style={{ color: socket.closedAt ? colors.textTertiary : colors.success, fontSize: 10.5, fontFamily: 'monospace', marginLeft: 6 }}>
          {socket.closedAt ? 'closed' : 'open'}
        </Text>
      </View>
      <Text style={{ color: colors.textTertiary, fontSize: 10.5, fontFamily: 'monospace', marginTop: 2 }}>
        {ageS}s · ↓{socket.received} ↑{socket.sent} · <Text style={{ color: '#22d3ee' }}>{socket.screen}</Text>
        {socket.source ? <Text> · {socket.source}</Text> : null}
      </Text>
    </View>
  );
}

export function DiagnosticsModal({ visible, onClose }: DiagnosticsModalProps) {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const [filter, setFilter] = useState<Filter>('all');
  const [paused, setPaused] = useState(false);
  const [tab, setTab] = useState<'calls' | 'sockets'>('calls');
  const [tick, setTick] = useState(0);
  const listRef = useRef<FlatList>(null);
  const autoScroll = useRef(true);

  useEffect(() => {
    if (!visible) return;
    // First open arms stack-trace attribution from here on.
    networkDiagnostics.armAttribution();
    const unsub = networkDiagnostics.subscribe(() => {
      if (!paused) setTick((n) => n + 1);
    });
    return unsub;
  }, [visible, paused]);

  const entries = useMemo(() => {
    const all = networkDiagnostics.getEntries();
    const filtered = all.filter((e) => {
      if (filter === 'errors') return (e.status != null && e.status >= 400) || !!e.error;
      if (filter === 'slow') return (e.durationMs ?? 0) > 1000;
      return true;
    });
    return [...filtered].reverse(); // newest first
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, tick]);

  // Recompute when the service notifies (tick is the trigger).
  const stats = networkDiagnostics.getStats();
  const sockets = useMemo(
    () => [...networkDiagnostics.getSockets()].reverse(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tick]
  );

  const handleExport = async () => {
    try {
      await Share.share({ message: networkDiagnostics.exportJson(), title: 'TINDEX diagnostics export' });
    } catch {
      Alert.alert('Export failed', 'Could not share the diagnostics log.');
    }
  };

  const chips: { key: Filter; label: string }[] = [
    { key: 'all', label: 'all' },
    { key: 'errors', label: 'errors' },
    { key: 'slow', label: '>1s' },
  ];

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <StatusBar barStyle="light-content" />
      <View style={{ flex: 1, backgroundColor: '#0A0B0F', paddingTop: insets.top }}>
        {/* header */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 14,
            paddingVertical: 10,
            borderBottomWidth: 1,
            borderBottomColor: '#1f1f23',
          }}
        >
          <Ionicons name="terminal-outline" size={18} color="#4ade80" />
          <Text style={{ color: '#fff', fontSize: 15, fontWeight: '600', marginLeft: 8, flex: 1 }}>
            Diagnostics
          </Text>
          <TouchableOpacity onPress={onClose} hitSlop={12}>
            <Ionicons name="close" size={22} color="#a1a1aa" />
          </TouchableOpacity>
        </View>

        {/* stat strip */}
        <View style={{ flexDirection: 'row', paddingHorizontal: 14, paddingVertical: 10, gap: 8 }}>
          {[
            { k: 'req/min', v: String(stats.reqPerMin), c: stats.reqPerMin > 40 ? '#facc15' : '#4ade80' },
            { k: 'avg ms', v: String(stats.avgLatencyMs), c: stats.avgLatencyMs > 1000 ? '#facc15' : '#fff' },
            { k: 'errors', v: String(stats.errorCount), c: stats.errorCount > 0 ? '#f87171' : '#4ade80' },
            { k: 'sockets', v: String(stats.activeSockets), c: '#22d3ee' },
          ].map((s) => (
            <View
              key={s.k}
              style={{ flex: 1, backgroundColor: '#141419', borderRadius: 8, padding: 8, borderWidth: 1, borderColor: '#1f1f23' }}
            >
              <Text style={{ color: '#71717a', fontSize: 9, textTransform: 'uppercase', fontFamily: 'monospace' }}>{s.k}</Text>
              <Text style={{ color: s.c, fontSize: 16, fontWeight: '700', fontFamily: 'monospace', marginTop: 2 }}>{s.v}</Text>
            </View>
          ))}
        </View>

        {/* tabs + filters */}
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingBottom: 8, gap: 6 }}>
          {(['calls', 'sockets'] as const).map((t) => (
            <TouchableOpacity
              key={t}
              onPress={() => setTab(t)}
              style={{
                borderRadius: 16,
                paddingHorizontal: 12,
                paddingVertical: 5,
                backgroundColor: tab === t ? '#1e2a1e' : 'transparent',
                borderWidth: 1,
                borderColor: tab === t ? '#4ade80' : '#2a2a30',
              }}
            >
              <Text style={{ color: tab === t ? '#4ade80' : '#a1a1aa', fontSize: 11, fontFamily: 'monospace' }}>
                {t}{t === 'sockets' ? ` (${stats.activeSockets})` : ''}
              </Text>
            </TouchableOpacity>
          ))}
          <View style={{ flex: 1 }} />
          {tab === 'calls' &&
            chips.map((c) => (
              <TouchableOpacity
                key={c.key}
                onPress={() => setFilter(c.key)}
                style={{
                  borderRadius: 16,
                  paddingHorizontal: 10,
                  paddingVertical: 5,
                  borderWidth: 1,
                  borderColor: filter === c.key ? '#4ade80' : '#2a2a30',
                }}
              >
                <Text style={{ color: filter === c.key ? '#4ade80' : '#a1a1aa', fontSize: 11, fontFamily: 'monospace' }}>
                  {c.label}
                </Text>
              </TouchableOpacity>
            ))}
        </View>

        {/* log */}
        <FlatList
          ref={listRef}
          style={{ flex: 1 }}
          data={tab === 'calls' ? entries : []}
          keyExtractor={(item) => String((item as DiagEntry).id)}
          renderItem={({ item }) => <Row entry={item as DiagEntry} colors={colors} />}
          ListEmptyComponent={
            tab === 'sockets' ? (
              <View>
                {sockets.map((s) => (
                  <SocketRow key={s.id} socket={s} colors={colors} />
                ))}
                {sockets.length === 0 && (
                  <Text style={{ color: '#52525b', textAlign: 'center', marginTop: 40, fontFamily: 'monospace' }}>
                    no sockets tracked yet
                  </Text>
                )}
              </View>
            ) : (
              <Text style={{ color: '#52525b', textAlign: 'center', marginTop: 40, fontFamily: 'monospace' }}>
                {paused ? 'paused' : 'no calls captured yet'}
              </Text>
            )
          }
          onScrollBeginDrag={() => (autoScroll.current = false)}
          initialNumToRender={40}
          maxToRenderPerBatch={30}
          windowSize={11}
          removeClippedSubviews
        />

        {/* footer controls */}
        <View
          style={{
            flexDirection: 'row',
            paddingHorizontal: 14,
            paddingVertical: 10,
            paddingBottom: Math.max(10, insets.bottom),
            borderTopWidth: 1,
            borderTopColor: '#1f1f23',
            gap: 8,
          }}
        >
          <TouchableOpacity
            onPress={() => setPaused((p) => !p)}
            style={{ flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 10, backgroundColor: '#141419', borderWidth: 1, borderColor: '#2a2a30' }}
          >
            <Text style={{ color: '#d4d4d8', fontSize: 12, fontFamily: 'monospace' }}>{paused ? '▶ resume' : '⏸ pause'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => networkDiagnostics.clear()}
            style={{ flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 10, backgroundColor: '#141419', borderWidth: 1, borderColor: '#2a2a30' }}
          >
            <Text style={{ color: '#d4d4d8', fontSize: 12, fontFamily: 'monospace' }}>🗑 clear</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleExport}
            style={{ flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 10, backgroundColor: '#14261a', borderWidth: 1, borderColor: '#4ade8055' }}
          >
            <Text style={{ color: '#4ade80', fontSize: 12, fontFamily: 'monospace' }}>⤴ export</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
