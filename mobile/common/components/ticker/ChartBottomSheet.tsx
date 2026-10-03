import React from 'react';
import { View, Text, Pressable, Modal, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors } from '@/lib/useColorScheme';

/**
 * ChartBottomSheet — slide-from-bottom sheet used by the chart toolbar
 * (Technicals, Options Positioning, Chart Settings). Backdrop tap or the
 * close button dismisses it.
 */
export function ChartBottomSheet({
  visible, title, onClose, children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const colors = useThemeColors();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: '#000', opacity: 0.5 }]} onPress={onClose} />
        <View style={s.sheetWrap} pointerEvents="box-none">
          <View style={[s.sheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={s.handle} />
            <View style={s.header}>
              <Text style={[s.title, { color: colors.text }]}>{title}</Text>
              <Pressable onPress={onClose} hitSlop={10}>
                <Ionicons name="close" size={20} color={colors.textSecondary} />
              </Pressable>
            </View>
            <ScrollView
              contentContainerStyle={{ gap: 14, paddingBottom: 8 }}
              showsVerticalScrollIndicator={false}
              bounces={false}
            >
              {children}
            </ScrollView>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  sheetWrap: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '82%',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderBottomWidth: 0,
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 24,
    gap: 10,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#8E8E93',
    alignSelf: 'center',
    marginBottom: 4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: { fontSize: 17, fontWeight: '800' },
});
