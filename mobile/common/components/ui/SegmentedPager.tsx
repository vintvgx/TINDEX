import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated, useWindowDimensions } from 'react-native';
import { TabView, type NavigationState, type SceneRendererProps } from 'react-native-tab-view';
import { useThemeColors } from '@/lib/useColorScheme';

export interface SegmentedPagerRoute {
  key: string;
  label: string;
}

interface Props {
  routes: SegmentedPagerRoute[];
  renderScene: (key: string) => React.ReactNode;
  /**
   * Externally-driven active page (e.g. from a `?section=` deep link). When
   * this changes to a key not currently active, the pager jumps to it.
   * Uncontrolled otherwise — normal swipe/tap navigation is all internal state.
   */
  activeKey?: string | null;
  onIndexChange?: (key: string) => void;
}

/**
 * Shared swipeable "top tabs" pager — Astor-style pill segment row + real
 * swipe-gesture paging (react-native-tab-view). Used identically by the Home,
 * ORB, and Accounts bottom tabs to page between their sub-screens.
 */
export function SegmentedPager({ routes, renderScene, activeKey, onIndexChange }: Props) {
  const colors = useThemeColors();
  const layout = useWindowDimensions();
  const [index, setIndex] = useState(0);

  // Jump to the externally-requested page (deep link) whenever it names a
  // route not already active — e.g. Menu → "ORB / Trade Log".
  useEffect(() => {
    if (!activeKey) return;
    const targetIndex = routes.findIndex(r => r.key === activeKey);
    if (targetIndex >= 0 && targetIndex !== index) setIndex(targetIndex);
  // Only re-sync when the requested key changes, not on every local swipe.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey, routes]);

  const handleIndexChange = useCallback((next: number) => {
    setIndex(next);
    onIndexChange?.(routes[next]?.key);
  }, [routes, onIndexChange]);

  const navigationState: NavigationState<SegmentedPagerRoute> = { index, routes };

  return (
    <TabView
      navigationState={navigationState}
      onIndexChange={handleIndexChange}
      initialLayout={{ width: layout.width, height: 0 }}
      lazy
      lazyPreloadDistance={1}
      renderScene={({ route }) => <>{renderScene(route.key)}</>}
      renderTabBar={props => (
        <PillTabBar {...props} colors={colors} onSelect={handleIndexChange} />
      )}
      style={{ backgroundColor: colors.background }}
    />
  );
}

function PillTabBar({
  navigationState, position, colors, onSelect,
}: SceneRendererProps & {
  navigationState: NavigationState<SegmentedPagerRoute>;
  colors: ReturnType<typeof useThemeColors>;
  onSelect: (index: number) => void;
}) {
  const [rowWidth, setRowWidth] = useState(0);
  const count = navigationState.routes.length;
  const segmentWidth = count > 0 ? rowWidth / count : 0;

  // `position` tracks the swipe continuously (e.g. 1.35 mid-swipe between
  // pages 1 and 2) — interpolating it directly is what makes the highlight
  // slide in real time with the gesture instead of snapping at release.
  const translateX = position.interpolate({
    inputRange: navigationState.routes.map((_, i) => i),
    outputRange: navigationState.routes.map((_, i) => i * segmentWidth),
  });

  return (
    <View style={[styles.wrap, { borderBottomColor: colors.border }]}>
      <View style={[styles.pillRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View
          style={styles.pillRowInner}
          onLayout={e => setRowWidth(e.nativeEvent.layout.width)}
        >
          {segmentWidth > 0 && (
            <Animated.View
              pointerEvents="none"
              style={[
                styles.activeHighlight,
                { width: segmentWidth, backgroundColor: colors.accent, transform: [{ translateX }] },
              ]}
            />
          )}
          {navigationState.routes.map((route, i) => {
            const active = i === navigationState.index;
            return (
              <TouchableOpacity
                key={route.key}
                onPress={() => onSelect(i)}
                activeOpacity={0.8}
                style={styles.pill}
              >
                <Text
                  style={[
                    styles.pillText,
                    { color: active ? colors.iconButton ?? '#fff' : colors.tabBarInactive, fontWeight: active ? '700' : '600' },
                  ]}
                  numberOfLines={1}
                >
                  {route.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  pillRow: {
    borderRadius: 100,
    borderWidth: 1,
    padding: 3,
  },
  // No padding/gap — each pill is exactly rowWidth/count wide and contiguous,
  // so `index * segmentWidth` lines up exactly with the animated highlight.
  pillRowInner: {
    flexDirection: 'row',
  },
  activeHighlight: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    borderRadius: 100,
  },
  pill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 100,
  },
  pillText: {
    fontSize: 13,
  },
});
