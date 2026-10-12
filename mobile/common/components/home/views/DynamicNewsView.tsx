import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import * as WebBrowser from 'expo-web-browser';
import { useThemeColors } from '@/lib/useColorScheme';
import { useLatestBrief } from '@/hooks/queries/digest/useMarketDigest';
import { useMarketNews } from '@/hooks/queries/news/useMarketNews';
import { isMuseBriefContent } from '@/common/types/marketDigest';

export interface HeadlineItem {
  headline: string;
  source: string;
  url: string;
  image?: string | null;
  published_at?: string | null;
}

/** Article host (for the favicon fallback) — Finnhub's `source` is a name, not a domain. */
function hostOf(url: string): string | null {
  const m = url.match(/^https?:\/\/([^/?#]+)/i);
  return m ? m[1].replace(/^www\./, '') : null;
}

function ago(iso?: string | null): string | null {
  if (!iso) return null;
  const mins = Math.max(0, (Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 60) return `${Math.max(1, Math.floor(mins))}m`;
  if (mins < 24 * 60) return `${Math.floor(mins / 60)}h`;
  return `${Math.floor(mins / 1440)}d`;
}

/**
 * Headlines for the Home card: the live /market-news feed (refreshed every
 * 15 min through the day), falling back to the latest Morning Brief's news
 * when the feed is unavailable or empty. Shared by the expanded view and the
 * minimized strip.
 */
export function useHeadlines(): { items: HeadlineItem[]; isLoading: boolean; fromBrief: boolean } {
  const news = useMarketNews();
  const latest = useLatestBrief();
  const content = latest.digest?.content_json;
  const brief = isMuseBriefContent(content) ? content : null;
  const live = news.data ?? [];
  if (live.length) return { items: live, isLoading: false, fromBrief: false };
  return {
    items: (brief?.news ?? []) as HeadlineItem[],
    isLoading: news.isLoading || latest.isLoading,
    fromBrief: true,
  };
}

/** 56×56 article image; the site's favicon when the article has none. */
function Thumb({ item, colors }: { item: HeadlineItem; colors: ReturnType<typeof useThemeColors> }) {
  const [failed, setFailed] = useState(false);
  const host = hostOf(item.url);
  const favicon = host ? `https://www.google.com/s2/favicons?domain=${host}&sz=64` : null;
  const src = !failed && item.image ? item.image : favicon;
  const isFavicon = src === favicon;
  return (
    <View style={[styles.thumb, { backgroundColor: colors.surfaceSecondary }]}>
      {src ? (
        <Image
          source={{ uri: src }}
          style={isFavicon ? styles.favicon : StyleSheet.absoluteFill}
          contentFit={isFavicon ? 'contain' : 'cover'}
          transition={150}
          onError={() => setFailed(true)}
        />
      ) : null}
    </View>
  );
}

/**
 * Dynamic card "news" view: the day's market headlines — tap one to read it
 * in the in-app browser.
 */
export function DynamicNewsView() {
  const colors = useThemeColors();
  const { items, isLoading, fromBrief } = useHeadlines();

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ padding: 14, paddingBottom: 26 }}
      showsVerticalScrollIndicator={false}
      nestedScrollEnabled
    >
      <Text style={[styles.mono, { fontSize: 10, letterSpacing: 2, color: colors.textTertiary }]}>
        HEADLINES{fromBrief && items.length ? ' · FROM THE BRIEF' : ''}
      </Text>

      {isLoading ? (
        <View style={{ marginTop: 12, gap: 12 }}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1, gap: 6 }}>
                <View style={{ height: 11, width: '90%', borderRadius: 4, backgroundColor: colors.surfaceSecondary }} />
                <View style={{ height: 11, width: '60%', borderRadius: 4, backgroundColor: colors.surfaceSecondary }} />
              </View>
              <View style={[styles.thumb, { backgroundColor: colors.surfaceSecondary }]} />
            </View>
          ))}
        </View>
      ) : items.length === 0 ? (
        <Text style={{ color: colors.textTertiary, fontSize: 13, marginTop: 16, lineHeight: 19 }}>
          No headlines right now.
        </Text>
      ) : (
        <View style={{ marginTop: 6 }}>
          {items.map((n, i) => {
            const when = ago(n.published_at);
            return (
              <TouchableOpacity
                key={`${n.url}-${i}`}
                activeOpacity={0.7}
                onPress={() => { if (n.url) WebBrowser.openBrowserAsync(n.url).catch(() => {}); }}
                style={[styles.row, { borderColor: colors.border }]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 12.5, color: colors.text, lineHeight: 17, fontWeight: '600' }} numberOfLines={3}>
                    {n.headline}
                  </Text>
                  <Text style={[styles.mono, { fontSize: 10, color: colors.textTertiary, marginTop: 4 }]} numberOfLines={1}>
                    {n.source}{when ? ` · ${when}` : ''}
                  </Text>
                </View>
                <Thumb item={n} colors={colors} />
              </TouchableOpacity>
            );
          })}
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
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  thumb: { width: 56, height: 56, borderRadius: 10, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  favicon: { width: 26, height: 26 },
});
