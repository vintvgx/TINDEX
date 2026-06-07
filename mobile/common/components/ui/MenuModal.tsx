import React, { useRef, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, Modal, Animated,
  ScrollView, StyleSheet, Dimensions, Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/lib/useColorScheme';
import { router } from 'expo-router';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const SHEET_HEIGHT = SCREEN_HEIGHT * 0.72;

export interface MenuItem {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  route?: string;
  onPress?: () => void;
  badge?: string;
  badgeColor?: string;
}

export interface MenuSection {
  title: string;
  items: MenuItem[];
}

interface Props {
  visible: boolean;
  onClose: () => void;
  sections: MenuSection[];
}

export const MenuModal: React.FC<Props> = ({ visible, onClose, sections }) => {
  const colors  = useThemeColors();
  const insets  = useSafeAreaInsets();
  const slideAnim = useRef(new Animated.Value(SHEET_HEIGHT)).current;

  useEffect(() => {
    if (visible) {
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        damping: 22,
        stiffness: 220,
      }).start();
    } else {
      Animated.timing(slideAnim, {
        toValue: SHEET_HEIGHT,
        duration: 220,
        useNativeDriver: true,
      }).start();
    }
  }, [visible, slideAnim]);

  const handleItem = (item: MenuItem) => {
    onClose();
    if (item.route) {
      setTimeout(() => router.push(item.route as any), 120);
    } else if (item.onPress) {
      setTimeout(item.onPress, 120);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />

      <Animated.View
        style={[
          styles.sheet,
          {
            backgroundColor: colors.card,
            paddingBottom: insets.bottom + 16,
            transform: [{ translateY: slideAnim }],
          },
        ]}
      >
        {/* Handle */}
        <View style={[styles.handle, { backgroundColor: colors.border }]} />

        <ScrollView showsVerticalScrollIndicator={false}>
          {sections.map((section, si) => (
            <View key={si} style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.tabBarInactive }]}>
                {section.title}
              </Text>
              {section.items.map((item, ii) => (
                <TouchableOpacity
                  key={ii}
                  onPress={() => handleItem(item)}
                  style={[styles.row, { borderBottomColor: colors.border }]}
                  activeOpacity={0.7}
                >
                  <View style={[styles.iconWrap, { backgroundColor: colors.background ?? '#000' }]}>
                    <Ionicons name={item.icon} size={18} color={colors.accent} />
                  </View>
                  <Text style={[styles.rowLabel, { color: colors.text }]}>{item.label}</Text>
                  {item.badge && (
                    <View style={[styles.badge, { backgroundColor: item.badgeColor ?? colors.accent }]}>
                      <Text style={styles.badgeText}>{item.badge}</Text>
                    </View>
                  )}
                  <Ionicons name="chevron-forward" size={14} color={colors.tabBarInactive} />
                </TouchableOpacity>
              ))}
            </View>
          ))}
        </ScrollView>
      </Animated.View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: SHEET_HEIGHT,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 16,
  },
  section: { paddingHorizontal: 20, marginBottom: 8 },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 8,
    marginTop: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowLabel: { flex: 1, fontSize: 15, fontWeight: '500' },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    marginRight: 4,
  },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },
});
