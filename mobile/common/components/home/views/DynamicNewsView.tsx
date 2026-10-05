import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import { useThemeColors } from '@/lib/useColorScheme';
import { useMarketDigest } from '@/hooks/queries/digest/useMarketDigest';
import { isMuseBriefContent } from '@/common/types/marketDigest';

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Dynamic card "news" view: headline news from the Morning Brief —
 * tap a headline to read the post in the in-app browser.
 */
export function DynamicNewsView() {
  const colors = useThemeColors();
  const { data, isLoading } = useMarketDigest(todayISO());
  const content = data?.data?.content_json;
  const brief = isMuseBriefContent(content) ? content : null;
  const news = brief?.news ?? [];

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ padding: 14, paddingBottom: 26 }}
      showsVerticalScrollIndicator={false}
      nestedScrollEnabled
    >
      <Text style={[styles.mono, { fontSize: 10, letterSpacing: 2, color: colors.textTertiary }]}>
        HEADLINES
      </Text>

      {isLoading ? (
        <Text style={{ color: colors.textTertiary, fontSize: 13, marginTop: 16 }}>Loading news…</Text>
      ) : news.length === 0 ? (
        <Text style={{ color: colors.textTertiary, fontSize: 13, marginTop: 16, lineHeight: 19 }}>
          No headlines yet — they arrive with the 8:00 AM brief.
        </Text>
      ) : (
        <View style={{ marginTop: 6 }}>
          {news.map((n, i) => (
            <TouchableOpacity
              key={i}
              activeOpacity={0.7}
              onPress={() => {
                if (n.url) WebBrowser.openBrowserAsync(n.url).catch(() => {});
              }}
              style={[styles.row, { borderColor: colors.border }]}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 12.5, color: colors.text, lineHeight: 17, fontWeight: '600' }}>
                  {n.headline}
                </Text>
                <Text style={[styles.mono, { fontSize: 10, color: colors.textTertiary, marginTop: 3 }]}>
                  {n.source}
                </Text>
              </View>
              <Ionicons name="open-outline" size={14} color={colors.textTertiary} />
            </TouchableOpacity>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  mono: { fontFamily: 'Menlo' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
