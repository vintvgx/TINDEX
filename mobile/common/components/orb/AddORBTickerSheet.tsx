import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Modal,
  Animated,
  Dimensions,
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTickerSearch } from '@/hooks/queries/ticker/useTickerSearch';
import { useIsFollowingORB, useToggleORBFollow } from '@/hooks/mutations/ticker/tickerORB';
import { useThemeColors } from '@/lib/useColorScheme';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

interface AddORBTickerSheetProps {
  visible: boolean;
  onClose: () => void;
}

/**
 * Sub-component that holds the ORB-follow hooks for a resolved ticker.
 * Hooks must live at the component level, not inside render callbacks.
 */
const ORBTickerResult: React.FC<{ ticker: string; companyName: string; price: number; logoUrl: string }> = ({
  ticker,
  companyName,
  price,
  logoUrl,
}) => {
  const colors = useThemeColors();
  const { data: followData, isLoading: followLoading } = useIsFollowingORB(ticker);
  const toggleFollow = useToggleORBFollow(ticker);
  const isFollowing = followData?.orb_enabled ?? false;

  const handlePress = () => {
    toggleFollow.mutate(!isFollowing);
  };

  const busy = followLoading || toggleFollow.isPending;

  return (
    <View style={[styles.resultRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {/* Logo */}
      <View style={[styles.logoBox, { backgroundColor: colors.surfaceSecondary }]}>
        {logoUrl ? (
          <Image source={{ uri: logoUrl }} style={styles.logo} resizeMode="contain" />
        ) : (
          <Text style={[styles.logoText, { color: colors.textSecondary }]}>{ticker[0]}</Text>
        )}
      </View>

      {/* Ticker / name */}
      <View style={{ flex: 1 }}>
        <Text style={[styles.tickerLabel, { color: colors.textSecondary }]}>{ticker}</Text>
        <Text style={[styles.companyName, { color: colors.text }]} numberOfLines={1}>
          {companyName}
        </Text>
      </View>

      {/* Price */}
      <Text style={[styles.price, { color: colors.text, marginRight: 12 }]}>
        ${price.toFixed(2)}
      </Text>

      {/* Add / Remove button */}
      <TouchableOpacity
        onPress={handlePress}
        disabled={busy}
        style={[
          styles.followBtn,
          {
            backgroundColor: isFollowing ? colors.error + '22' : colors.success + '22',
            borderColor: isFollowing ? colors.error : colors.success,
          },
        ]}
      >
        {busy ? (
          <ActivityIndicator size="small" color={isFollowing ? colors.error : colors.success} />
        ) : (
          <Ionicons
            name={isFollowing ? 'remove-circle-outline' : 'add-circle-outline'}
            size={20}
            color={isFollowing ? colors.error : colors.success}
          />
        )}
        <Text
          style={[
            styles.followBtnText,
            { color: isFollowing ? colors.error : colors.success },
          ]}
        >
          {isFollowing ? 'Remove' : 'Add to ORB'}
        </Text>
      </TouchableOpacity>
    </View>
  );
};

export const AddORBTickerSheet: React.FC<AddORBTickerSheetProps> = ({ visible, onClose }) => {
  const colors = useThemeColors();
  const [searchText, setSearchText] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const slideAnim = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (visible) {
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

  const result = searchResult?.success && searchResult.data ? searchResult.data : null;

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

          {/* Header */}
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.text }]}>Add Ticker to ORB</Text>
            <TouchableOpacity onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* Search input */}
          <View style={styles.inputWrap}>
            <View style={[styles.inputRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Ionicons name="search" size={17} color={colors.textSecondary} style={{ marginRight: 8 }} />
              <TextInput
                ref={inputRef}
                style={[styles.input, { color: colors.text }]}
                placeholder="Search ticker symbol…"
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

          {/* Result */}
          <View style={styles.resultArea}>
            {isLoading ? (
              <View style={styles.centered}>
                <ActivityIndicator size="large" color={colors.accent} />
              </View>
            ) : result ? (
              <ORBTickerResult
                ticker={result.ticker}
                companyName={result.company_name ?? result.ticker}
                price={result.current_price ?? 0}
                logoUrl={result.logo_url ?? ''}
              />
            ) : debouncedSearch.length > 0 ? (
              <View style={styles.centered}>
                <Ionicons name="search-outline" size={44} color={colors.textTertiary} />
                <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                  No results for "{debouncedSearch}"
                </Text>
              </View>
            ) : (
              <View style={styles.centered}>
                <Ionicons name="trending-up-outline" size={44} color={colors.textTertiary} />
                <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                  Type a ticker symbol to search
                </Text>
              </View>
            )}
          </View>
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
    height: SCREEN_HEIGHT * 0.55,
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
    marginBottom: 4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  title: { fontSize: 17, fontWeight: '700' },
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
  resultArea: { flex: 1, paddingHorizontal: 16 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 20 },
  emptyText: { fontSize: 15, marginTop: 12, textAlign: 'center' },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    padding: 14,
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
  price: { fontSize: 14, fontWeight: '600' },
  followBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1,
    minWidth: 110,
    justifyContent: 'center',
  },
  followBtnText: { fontSize: 13, fontWeight: '600' },
});
