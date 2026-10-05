import React, { useEffect } from 'react';
import { Modal, View, TouchableOpacity, ActivityIndicator, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { MuseDigestView } from './MuseDigestView';
import { isMuseBriefContent, type MuseBriefContent } from '@/common/types/marketDigest';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { format, parseISO } from 'date-fns';
import { useThemeColors } from '@/lib/useColorScheme';
import { useMarketDigest } from '@/hooks/queries/digest/useMarketDigest';
import { useSeenMarketDigests } from '@/hooks/useSeenMarketDigests';

interface Props {
  /** ISO date (YYYY-MM-DD) of the digest to view. */
  date: string | null;
  visible: boolean;
  onClose: () => void;
  /**
   * In-app preview: when provided, the modal renders this content directly
   * (always muse-brief-v1) instead of fetching `date` from the API. Used by
   * the Daily Review preview toggle.
   */
  previewContent?: MuseBriefContent | null;
}

/**
 * Full-screen viewer for one day's Morning Brief (MuseDigestView).
 *
 * Pure viewer — the brief is published by the 8:00 AM ET job
 * (POST /muse/market-digest/publish), and this only ever opens once a digest
 * for `date` already exists.
 */
export function MarketDigestModal({ date, visible, onClose, previewContent }: Props) {
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen">
      {/* Two providers, both needed for the same underlying reason: a core
          RN <Modal> renders in its own separate native view hierarchy, so
          neither the outer SafeAreaProvider nor the outer
          GestureHandlerRootView (both mounted once, in app/_layout.tsx) can
          see into it.
          - SafeAreaProvider: without a nested one, insets silently come back
            as 0 and the progress bar/close button render under the notch.
          - GestureHandlerRootView: gesture-handler components inside the
            brief (e.g. sheets it opens) need a root anchored in the modal's
            own native hierarchy, or their handlers register against none and
            can wedge sibling screens' gestures after the modal closes. */}
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <DigestModalContent date={date} visible={visible} onClose={onClose} previewContent={previewContent} />
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </Modal>
  );
}

function DigestModalContent({ date, visible, onClose, previewContent }: Props) {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();

  const { data, isLoading, error } = useMarketDigest(visible && !previewContent ? date : null);
  // Preview mode bypasses the API entirely and renders the fixture.
  const content = previewContent ?? data?.data?.content_json;
  const { markSeen } = useSeenMarketDigests();

  // Record this date as viewed so MarketDigestCard stops showing it on Home.
  useEffect(() => {
    if (visible && date) markSeen(date);
  }, [visible, date, markSeen]);

  const dateLabel = content ? format(parseISO(content.digest_date), 'EEE, MMM d') : '';
  const brief = isMuseBriefContent(content) ? content : null;

  // Only the Morning Brief (muse-brief-v1) view exists now — the legacy
  // Claude-era slide deck was removed in the 0.7 redesign. It used to be the
  // fallback whenever content wasn't (yet) a muse brief, which included the
  // loading state, so "Open full" briefly — or, for an older-format day,
  // permanently — showed the old UI.
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: 6, flexDirection: 'row', justifyContent: 'flex-end' }}>
        <TouchableOpacity
          onPress={onClose}
          hitSlop={10}
          style={{
            width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center',
            backgroundColor: colors.surfaceSecondary,
          }}
        >
          <Ionicons name="close" size={18} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>
      {brief ? (
        <MuseDigestView content={brief} dateLabel={dateLabel} preview={!!previewContent} onCloseDigest={onClose} />
      ) : (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
          {isLoading ? (
            <ActivityIndicator size="large" color={colors.accent} />
          ) : (
            <Text style={{ color: colors.textTertiary, fontSize: 13, textAlign: 'center', lineHeight: 19 }}>
              {error || !content
                ? 'No Morning Brief for this date.'
                : 'This day predates the current Morning Brief format.'}
            </Text>
          )}
        </View>
      )}
    </View>
  );
}
