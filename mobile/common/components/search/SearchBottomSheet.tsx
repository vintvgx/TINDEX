import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  Image,
  Modal,
  Animated,
  Dimensions,
  ActivityIndicator,
  Pressable,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as SecureStore from 'expo-secure-store';
import { usePathname } from 'expo-router';
import { useTickerSearch } from '@/hooks/queries/ticker/useTickerSearch';
import type { SearchHistoryItem } from '@/common/types/blogPosts/ticker';
import { useThemeColors } from '@/lib/useColorScheme';
import useBaseNavigation from '@/hooks/navigation/useBaseNavigation';
import { useOptionsTicker } from '@/lib/optionsTickerContext';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const HISTORY_KEY = 'ticker_search_history';
const MAX_HISTORY = 10;

interface SearchBottomSheetProps {
  visible: boolean;
  onClose: () => void;
}

export const SearchBottomSheet: React.FC<SearchBottomSheetProps> = ({ visible, onClose }) => {
  const colors = useThemeColors();
  const { toTicker } = useBaseNavigation();
  const pathname = usePathname();
  const { setOptionsTicker } = useOptionsTicker();
  const [searchText, setSearchText] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [history, setHistory] = useState<SearchHistoryItem[]>([]);
  const slideAnim = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (visible) {
      loadHistory();
      Animated.spring(slideAnim, {
        toValue: 0,
        damping: 28,
        stiffness: 220,
        useNativeDriver: true,
      }).start(() => setTimeout(() => inputRef.current?.focus(), 50));
    } else {
      Animated.timing(slideAnim, {
        toValue: SCREEN_HEIGHT,
        duration: 220,
        useNativeDriver: true,
      }).start();
      setSearchText('');
      setDebouncedSearch('');
    }
  }, [visible]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchText.trim().toUpperCase()), 300);
    return () => clearTimeout(t);
  }, [searchText]);

  const shouldSearch = debouncedSearch.length >= 1 && debouncedSearch.length <= 5;
  const { data: searchResult, isLoading } = useTickerSearch(shouldSearch ? debouncedSearch : '');

  const loadHistory = async () => {
    try {
      const raw = await SecureStore.getItemAsync(HISTORY_KEY);
      if (raw) setHistory(JSON.parse(raw));
    } catch {}
  };

  const handleSelect = useCallback(
    async (item: SearchHistoryItem) => {
      const updated = [item, ...history.filter(h => h.ticker !== item.ticker)].slice(0, MAX_HISTORY);
      try {
        await SecureStore.setItemAsync(HISTORY_KEY, JSON.stringify(updated));
        setHistory(updated);
      } catch {}
      onClose();
      // On the Contracts page, look up the searched stock's option chain in
      // place instead of navigating away to the generic ticker detail
      // screen — options.tsx already reads its active ticker from this same
      // shared context (useOptionsTicker), it just never got set from here.
      if (pathname?.includes('/options')) {
        setOptionsTicker(item.ticker.toUpperCase());
      } else {
        toTicker(item.ticker);
      }
    },
    [history, onClose, toTicker, pathname, setOptionsTicker],
  );

  const displayItems: SearchHistoryItem[] = [];
  if (searchResult?.success && searchResult.data) {
    displayItems.push({
      ticker: searchResult.data.ticker,
      company_name: searchResult.data.company_name,
      current_price: searchResult.data.current_price,
      price_change_percent: searchResult.data.price_change_percent,
      logo_url: searchResult.data.logo_url ?? '',
      industry: searchResult.data.industry ?? '',
      timestamp: Date.now(),
    });
  } else if (!debouncedSearch) {
    displayItems.push(...history);
  }

  const renderItem = ({ item }: { item: SearchHistoryItem }) => {
    const pos = item.price_change_percent >= 0;
    const changeColor = pos ? colors.success : colors.error;
    return (
      <TouchableOpacity
        onPress={() => handleSelect(item)}
        activeOpacity={0.72}
        style={[styles.resultRow, { backgroundColor: colors.surface, borderColor: colors.border }]}
      >
        <View style={[styles.logoBox, { backgroundColor: colors.surfaceSecondary }]}>
          {item.logo_url ? (
            <Image source={{ uri: item.logo_url }} style={styles.logo} resizeMode="contain" />
          ) : (
            <Text style={[styles.logoText, { color: colors.textSecondary }]}>{item.ticker[0]}</Text>
          )}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.tickerLabel, { color: colors.textSecondary }]}>{item.ticker}</Text>
          <Text style={[styles.companyName, { color: colors.text }]} numberOfLines={1}>
            {item.company_name}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={[styles.price, { color: colors.text }]}>
            ${(item.current_price ?? 0).toFixed(2)}
          </Text>
          <Text style={[styles.change, { color: changeColor }]}>
            {pos ? '+' : ''}{item.price_change_percent.toFixed(2)}%
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <Modal transparent animationType="none" visible={visible} onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <Animated.View
        style={[
          styles.sheet,
          { backgroundColor: colors.background, transform: [{ translateY: slideAnim }] },
        ]}
      >
        <SafeAreaView style={{ flex: 1 }} edges={['left', 'right', 'bottom']}>
          <View style={styles.handle} />

          {/* Search input */}
          <View style={styles.inputWrap}>
            <View style={[styles.inputRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Ionicons name="search" size={17} color={colors.textSecondary} style={{ marginRight: 8 }} />
              <TextInput
                ref={inputRef}
                style={[styles.input, { color: colors.text }]}
                placeholder="Search stocks..."
                placeholderTextColor={colors.textSecondary}
                value={searchText}
                onChangeText={setSearchText}
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={5}
                returnKeyType="search"
              />
              {searchText.length > 0 && (
                <TouchableOpacity onPress={() => setSearchText('')} hitSlop={8}>
                  <Ionicons name="close-circle" size={17} color={colors.textSecondary} />
                </TouchableOpacity>
              )}
            </View>
          </View>

          {!debouncedSearch && history.length > 0 && (
            <Text style={[styles.sectionLabel, { color: colors.textTertiary }]}>Recent Searches</Text>
          )}

          {isLoading ? (
            <View style={styles.centered}>
              <ActivityIndicator size="large" color={colors.accent} />
            </View>
          ) : (
            <FlatList
              data={displayItems}
              renderItem={renderItem}
              keyExtractor={item => `${item.ticker}-${item.timestamp}`}
              contentContainerStyle={styles.list}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={
                <View style={styles.centered}>
                  <Ionicons name="search-outline" size={44} color={colors.textTertiary} />
                  <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                    {debouncedSearch ? 'No results found' : 'Search for stocks'}
                  </Text>
                </View>
              }
            />
          )}
        </SafeAreaView>
      </Animated.View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: SCREEN_HEIGHT * 0.88,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#3A3A3C',
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 8,
  },
  inputWrap: { paddingHorizontal: 16, marginBottom: 14 },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
  },
  input: { flex: 1, fontSize: 16 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginHorizontal: 16,
    marginBottom: 10,
  },
  list: { paddingHorizontal: 16, paddingBottom: 40 },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    padding: 13,
    marginBottom: 9,
    borderWidth: 1,
  },
  logoBox: {
    width: 44,
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    overflow: 'hidden',
  },
  logo: { width: '100%', height: '100%' },
  logoText: { fontSize: 16, fontWeight: '700' },
  tickerLabel: { fontSize: 11, fontWeight: '600', marginBottom: 2 },
  companyName: { fontSize: 14, fontWeight: '600' },
  price: { fontSize: 15, fontWeight: '700', marginBottom: 3 },
  change: { fontSize: 12, fontWeight: '600' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 },
  emptyText: { fontSize: 15, marginTop: 12 },
});
