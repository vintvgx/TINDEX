import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  ScrollView,
  FlatList,
  StatusBar,
  TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { logService, LogEntry } from '@/common/services/LogService';

interface LogViewerModalProps {
  visible: boolean;
  onClose: () => void;
}

/**
 * Formats timestamp to readable format
 */
const formatTimestamp = (date: Date): string => {
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
};

/**
 * Gets color for log level
 */
const getLogLevelColor = (level: LogEntry['level']): string => {
  switch (level) {
    case 'error':
      return '#EF4444';
    case 'warn':
      return '#F59E0B';
    case 'info':
      return '#3B82F6';
    case 'debug':
      return '#8B5CF6';
    default:
      return '#6B7280';
  }
};

/**
 * Gets background color for log level
 */
const getLogLevelBg = (level: LogEntry['level']): string => {
  switch (level) {
    case 'error':
      return 'bg-red-500/20';
    case 'warn':
      return 'bg-yellow-500/20';
    case 'info':
      return 'bg-blue-500/20';
    case 'debug':
      return 'bg-purple-500/20';
    default:
      return 'bg-gray-800/50';
  }
};

/**
 * Memoized so FlatList can skip re-rendering rows whose underlying log entry
 * hasn't changed — with a growing, frequently-polled log list, an inline
 * (non-memoized) renderItem would re-render every visible row on every poll
 * tick regardless of whether that row's data actually changed.
 */
const LogRow = React.memo(function LogRow({ log }: { log: LogEntry }) {
  return (
    <View
      className={`mb-2 p-3 rounded-lg border-l-4 ${getLogLevelBg(log.level)}`}
      style={{ borderLeftColor: getLogLevelColor(log.level) }}
    >
      <View className="flex-row items-center justify-between mb-1">
        <View className="flex-row items-center" style={{ gap: 8 }}>
          <Text className="text-xs font-bold uppercase" style={{ color: getLogLevelColor(log.level) }}>
            {log.level}
          </Text>
          <Text className="text-gray-500 text-xs">{formatTimestamp(log.timestamp)}</Text>
        </View>
      </View>
      <Text className="text-white text-sm font-mono" selectable>
        {log.message}
      </Text>
      {log.data && log.data.length > 0 && (
        <View className="mt-2 bg-gray-900/50 rounded p-2">
          <Text className="text-gray-400 text-xs mb-1">Additional Data:</Text>
          {log.data.map((item, index) => (
            <Text key={index} className="text-gray-300 text-xs font-mono" selectable>
              {typeof item === 'object' ? JSON.stringify(item, null, 2) : String(item)}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
});

export const LogViewerModal: React.FC<LogViewerModalProps> = ({
  visible,
  onClose,
}) => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [filter, setFilter] = useState<'all' | LogEntry['level']>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const listRef = useRef<FlatList<LogEntry>>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const previousLogCountRef = useRef(0);
  const hasScrolledOnOpen = useRef(false);
  const insets = useSafeAreaInsets();

  // Refresh logs periodically and on mount
  useEffect(() => {
    if (!visible) return;

    // Proof-of-life: guarantees at least one entry every time the modal is
    // opened, so "No logs yet" is only ever shown when the console-capture
    // pipeline (LogService's console.* overrides) genuinely isn't receiving
    // anything — not because the modal itself failed to read logService.
    console.info('[LogViewerModal] opened at', new Date().toISOString());

    const updateLogs = async () => {
      // Ensure logs are loaded from file
      await logService.waitForInitialization();

      const allLogs = logService.getLogs();
      setLogs((prevLogs) => {
        // Track if new logs were added
        if (allLogs.length > prevLogs.length) {
          previousLogCountRef.current = prevLogs.length;
        }
        return allLogs;
      });
    };

    // Initial load
    updateLogs();

    // Auto-refresh every 1s when modal is visible. Was 500ms — halving the
    // poll rate roughly halves how often the (now much larger, since the
    // merge-not-overwrite fix in LogService actually retains history) log
    // list gets re-rendered.
    const interval = setInterval(updateLogs, 1000);

    return () => clearInterval(interval);
  }, [visible]);

  // Scroll to bottom when modal becomes visible (initial open only)
  useEffect(() => {
    if (!visible) {
      hasScrolledOnOpen.current = false;
      return;
    }
    if (visible && logs.length > 0 && !hasScrolledOnOpen.current && listRef.current) {
      hasScrolledOnOpen.current = true;
      setTimeout(() => {
        listRef.current?.scrollToEnd({ animated: false });
      }, 100);
    }
  }, [visible, logs.length]);

  // Auto-scroll to bottom when new logs arrive, but only if user is at bottom
  useEffect(() => {
    if (autoScroll && isAtBottom && logs.length > 0 && listRef.current) {
      const previousCount = previousLogCountRef.current;
      // Only auto-scroll if new logs were added (compare current count to previous)
      if (logs.length > previousCount) {
        setTimeout(() => {
          listRef.current?.scrollToEnd({ animated: true });
        }, 100);
        // Update the ref after scrolling
        previousLogCountRef.current = logs.length;
      }
    }
  }, [logs.length, autoScroll, isAtBottom]);

  // Handle scroll events to detect if user is at bottom
  const handleScroll = (event: any) => {
    const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent;
    const paddingToBottom = 20; // Threshold for "at bottom"
    const isNearBottom =
      layoutMeasurement.height + contentOffset.y >=
      contentSize.height - paddingToBottom;
    setIsAtBottom(isNearBottom);
  };

  // Filter logs based on selected filter and search query. Memoized — with
  // up to maxLogs (3,000) entries and a 1s poll tick, re-filtering on every
  // render (as this used to) was a real cost on top of the render itself.
  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      if (filter !== 'all' && log.level !== filter) {
        return false;
      }
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        return (
          log.message.toLowerCase().includes(query) ||
          log.level.toLowerCase().includes(query)
        );
      }
      return true;
    });
  }, [logs, filter, searchQuery]);

  // Per-level counts for the filter chips — one pass instead of the 6
  // separate logs.filter(...).length calls (one per level button) this used
  // to do inline in the render body, every render.
  const levelCounts = useMemo(() => {
    const counts: Partial<Record<LogEntry['level'], number>> = {};
    for (const log of logs) {
      counts[log.level] = (counts[log.level] ?? 0) + 1;
    }
    return counts;
  }, [logs]);

  const handleClearLogs = async () => {
    await logService.clearLogs();
    setLogs([]);
  };

  const errorCount = logService.getErrorCount();
  const warningCount = logService.getWarningCount();
  const totalCount = logService.getLogCount();

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={{ flex: 1, backgroundColor: '#000', paddingTop: insets.top, paddingBottom: insets.bottom }}>
        <StatusBar barStyle="light-content" />

        {/*
          Deliberately NOT relying on <SafeAreaView> here — a Modal with
          presentationStyle="fullScreen" is presented in its own native view
          hierarchy on iOS, and the automatic SafeAreaView (even the
          react-native-safe-area-context one) has been confirmed to still
          render its top edge under the status bar/notch in this Modal
          specifically. Reading insets directly via useSafeAreaInsets() and
          applying them as explicit padding sidesteps whatever's making the
          automatic component unreliable here.
        */}

        {/* Header */}
        <View className="px-6 py-4 border-b border-gray-800 flex-row items-center justify-between">
          <View className="flex-1">
            <Text className="text-white text-2xl font-bold">App Logs</Text>
            <Text className="text-gray-400 text-xs mt-1">
              {totalCount} total • {errorCount} errors • {warningCount} warnings
            </Text>
          </View>
          <TouchableOpacity
            onPress={onClose}
            className="w-10 h-10 items-center justify-center"
          >
            <Ionicons name="close" size={24} color="#fff" />
          </TouchableOpacity>
        </View>

        {/* Controls */}
        <View className="px-4 py-3 border-b border-gray-800 bg-gray-900">
          {/* Search Bar */}
          <View className="flex-row items-center mb-3 bg-gray-800 rounded-lg px-3 py-2">
            <Ionicons name="search" size={20} color="#6B7280" />
            <TextInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search logs..."
              placeholderTextColor="#6B7280"
              className="flex-1 text-white ml-2"
              style={{ fontSize: 14 }}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery('')}>
                <Ionicons name="close-circle" size={20} color="#6B7280" />
              </TouchableOpacity>
            )}
          </View>

          {/* Filter Buttons */}
          <View className="flex-row items-center justify-between">
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              className="flex-1"
            >
              <View className="flex-row" style={{ gap: 8 }}>
                {(['all', 'error', 'warn', 'info', 'log', 'debug'] as const).map(
                  (level) => (
                    <TouchableOpacity
                      key={level}
                      onPress={() => setFilter(level)}
                      className={`px-3 py-1.5 rounded-lg ${
                        filter === level
                          ? getLogLevelBg(level === 'all' ? 'log' : level)
                          : 'bg-gray-800'
                      }`}
                      style={{
                        borderWidth: 1,
                        borderColor:
                          filter === level
                            ? getLogLevelColor(level === 'all' ? 'log' : level)
                            : 'transparent',
                      }}
                    >
                      <Text
                        className="text-xs font-semibold capitalize"
                        style={{
                          color:
                            filter === level
                              ? getLogLevelColor(level === 'all' ? 'log' : level)
                              : '#9CA3AF',
                        }}
                      >
                        {level === 'all' ? 'All' : level}
                        {level !== 'all' && ` (${levelCounts[level] ?? 0})`}
                      </Text>
                    </TouchableOpacity>
                  )
                )}
              </View>
            </ScrollView>

            {/* Action Buttons */}
            <View className="flex-row ml-2" style={{ gap: 8 }}>
              <TouchableOpacity
                onPress={() => setAutoScroll(!autoScroll)}
                className={`w-10 h-10 items-center justify-center rounded-lg ${
                  autoScroll ? 'bg-blue-500/20' : 'bg-gray-800'
                }`}
              >
                <Ionicons
                  name={autoScroll ? 'lock-closed' : 'lock-open'}
                  size={18}
                  color={autoScroll ? '#3B82F6' : '#9CA3AF'}
                />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleClearLogs}
                className="w-10 h-10 items-center justify-center rounded-lg bg-red-500/20"
              >
                <Ionicons name="trash-outline" size={18} color="#EF4444" />
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/*
          Logs List — a virtualized FlatList, not a ScrollView. A ScrollView
          mounts every child eagerly with no windowing; with up to maxLogs
          (3,000) entries, each rendering a JSON.stringify'd "Additional Data"
          block, that was enough non-virtualized native view creation on a
          1s-ish poll tick to freeze the UI thread — this is what was
          reported as "app logs is making my app freeze." FlatList only
          renders what's near-visible.
        */}
        <FlatList
          ref={listRef}
          data={filteredLogs}
          keyExtractor={(log) => log.id}
          renderItem={({ item }) => <LogRow log={item} />}
          className="flex-1"
          contentContainerStyle={{ padding: 16, flexGrow: 1 }}
          onScroll={handleScroll}
          scrollEventThrottle={400}
          initialNumToRender={30}
          maxToRenderPerBatch={20}
          windowSize={7}
          removeClippedSubviews
          ListEmptyComponent={
            <View className="flex-1 justify-center items-center py-20">
              <Ionicons name="document-text-outline" size={48} color="#6B7280" />
              <Text className="text-gray-400 text-center mt-4">
                {searchQuery || filter !== 'all'
                  ? 'No logs match your filters'
                  : 'No logs yet'}
              </Text>
            </View>
          }
        />
      </View>
    </Modal>
  );
};

