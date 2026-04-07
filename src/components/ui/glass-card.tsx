import { BlurView } from 'expo-blur';
import { type ReactNode } from 'react';
import { StyleProp, StyleSheet, ViewStyle, View } from 'react-native';

import { useApp } from '@/src/providers/app-provider';

export function GlassCard({
  children,
  style,
  intensity = 72,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  intensity?: number;
}) {
  const { theme } = useApp();

  // Animix-like premium feel: Subtle borders, deep blurs
  // On Android, BlurView can be tricky, so we rely more on background color alpha
  const isDark = theme.id !== 'sakura';

  return (
    <BlurView
      intensity={intensity}
      tint={isDark ? 'dark' : 'light'}
      style={[
        styles.card,
        {
          backgroundColor: theme.cardBackground,
          borderColor: isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.05)',
        },
        style,
      ]}>
      <View style={styles.inner}>
        {children}
      </View>
    </BlurView>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 20,
    borderWidth: 1,
    overflow: 'hidden',
  },
  inner: {
    padding: 0, // Let the parent decide padding or use a wrapper
  },
});
