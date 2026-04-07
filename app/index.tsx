import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { LinearGradient } from 'expo-linear-gradient';

import { GlassCard } from '@/src/components/ui/glass-card';
import { LiquidBackground } from '@/src/components/ui/liquid-background';
import { useAuth } from '@/src/providers/auth-provider';
import { useApp } from '@/src/providers/app-provider';

export default function WelcomeScreen() {
  const { t } = useTranslation();
  const { theme } = useApp();
  const { ready, user, continueAsGuest } = useAuth();

  useEffect(() => {
    if (ready && user) {
      router.replace('/local');
    }
  }, [ready, user]);

  return (
    <LiquidBackground>
      <View style={styles.content}>
        <View style={styles.hero}>
           <Image source={require('../assets/images/icon.png')} style={styles.logo} contentFit="contain" />
           <Text style={[styles.title, { color: theme.textPrimary }]}>ATHERIUM</Text>
           <Text style={[styles.subtitle, { color: theme.textSecondary }]}>Your premium anime lounge</Text>
        </View>

        <View style={styles.footer}>
           <GlassCard style={styles.authCard}>
              <Pressable
                onPress={() => router.push('/auth')}
                style={[styles.primaryBtn, { backgroundColor: theme.accentPrimary }]}
              >
                 <Text style={styles.primaryBtnText}>Get Started</Text>
              </Pressable>

              <Pressable
                onPress={async () => { await continueAsGuest(); router.replace('/local'); }}
                style={styles.guestBtn}
              >
                 <Text style={[styles.guestBtnText, { color: theme.textPrimary }]}>Continue as Guest</Text>
              </Pressable>
           </GlassCard>

           <Text style={[styles.version, { color: theme.textMuted }]}>v1.0.4 • Stable</Text>
        </View>
      </View>
    </LiquidBackground>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, justifyContent: 'space-between', padding: 32 },
  hero: { alignItems: 'center', marginTop: 100 },
  logo: { width: 120, height: 120, marginBottom: 24 },
  title: { fontSize: 48, fontWeight: '900', letterSpacing: 8 },
  subtitle: { fontSize: 16, fontWeight: '600', opacity: 0.7, marginTop: 8 },
  footer: { marginBottom: 40 },
  authCard: { padding: 24, gap: 16 },
  primaryBtn: { height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center', elevation: 8, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
  primaryBtnText: { fontSize: 18, fontWeight: '900', color: '#000' },
  guestBtn: { height: 56, alignItems: 'center', justifyContent: 'center' },
  guestBtnText: { fontSize: 15, fontWeight: '700' },
  version: { textAlign: 'center', marginTop: 24, fontSize: 12, fontWeight: '600', opacity: 0.5 },
});
