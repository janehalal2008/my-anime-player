import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { GlassCard } from '@/src/components/ui/glass-card';
import { LiquidBackground } from '@/src/components/ui/liquid-background';
import { useAuth } from '@/src/providers/auth-provider';
import { useApp } from '@/src/providers/app-provider';

type Mode = 'login' | 'register';

export default function AuthEntryScreen() {
  const params = useLocalSearchParams<{ mode?: string | string[] }>();
  const paramMode = Array.isArray(params.mode) ? params.mode[0] : params.mode;
  const { t } = useTranslation();
  const { theme } = useApp();
  const { ready, user, startLogin, startRegister } = useAuth();
  const [mode, setMode] = useState<Mode>(paramMode === 'login' ? 'login' : 'register');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [age, setAge] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (paramMode === 'login' || paramMode === 'register') {
      setMode(paramMode);
    }
  }, [paramMode]);

  useEffect(() => {
    if (ready && user) {
      router.replace('/local');
    }
  }, [ready, user]);

  async function submit() {
    setLoading(true);
    setError(null);

    const ageNum = parseInt(age, 10);
    if (mode === 'register' && (isNaN(ageNum) || ageNum < 4 || ageNum > 120)) {
        setError(t('auth.errors.invalidAge', { defaultValue: 'Please enter a valid age (4-120).' }));
        setLoading(false);
        return;
    }

    try {
      if (mode === 'register') {
        await startRegister({ username, email, password, age: ageNum });
      } else {
        await startLogin({ email, password });
      }

      router.replace('/local');
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : t('auth.genericError', { defaultValue: 'Unable to continue.' }));
    } finally {
      setLoading(false);
    }
  }

  return (
    <LiquidBackground>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={[styles.backButton, { borderColor: theme.cardBorder }]}>
            <Ionicons name="chevron-back" size={20} color={theme.textPrimary} />
          </Pressable>
        </View>

        <View style={styles.center}>
          <GlassCard style={styles.card}>
            <Text style={[styles.eyebrow, { color: theme.textMuted }]}>{t('auth.eyebrow', { defaultValue: 'Account access' })}</Text>
            <Text style={[styles.title, { color: theme.textPrimary }]}>
              {mode === 'login'
                ? t('auth.loginTitle', { defaultValue: 'Login to your account' })
                : t('auth.registerTitle', { defaultValue: 'Create your account' })}
            </Text>

            <View style={[styles.modeRow, { backgroundColor: theme.surfaceMuted, borderColor: theme.cardBorder }]}>
              {(['login', 'register'] as const).map((item) => {
                const active = item === mode;

                return (
                  <Pressable
                    key={item}
                    onPress={() => {
                      setMode(item);
                      setError(null);
                    }}
                    style={[
                      styles.modeButton,
                      active && { backgroundColor: theme.surfaceStrong },
                    ]}>
                    <Text style={[styles.modeLabel, { color: active ? theme.textPrimary : theme.textSecondary }]}>
                      {item === 'login'
                        ? t('auth.login', { defaultValue: 'Login' })
                        : t('auth.register', { defaultValue: 'Register' })}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {mode === 'register' ? (
              <>
                <TextInput
                  value={username}
                  onChangeText={setUsername}
                  placeholder={t('auth.username', { defaultValue: 'Username' })}
                  placeholderTextColor={theme.textMuted}
                  style={[styles.input, { color: theme.textPrimary, borderColor: theme.cardBorder, backgroundColor: theme.inputBackground }]}
                  autoCapitalize="words"
                />
                <TextInput
                  value={age}
                  onChangeText={setAge}
                  placeholder={t('auth.age', { defaultValue: 'Age' })}
                  placeholderTextColor={theme.textMuted}
                  style={[styles.input, { color: theme.textPrimary, borderColor: theme.cardBorder, backgroundColor: theme.inputBackground }]}
                  keyboardType="number-pad"
                />
              </>
            ) : null}

            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder={t('auth.email', { defaultValue: 'Email' })}
              placeholderTextColor={theme.textMuted}
              style={[styles.input, { color: theme.textPrimary, borderColor: theme.cardBorder, backgroundColor: theme.inputBackground }]}
              autoCapitalize="none"
              keyboardType="email-address"
            />

            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder={t('auth.password', { defaultValue: 'Password' })}
              placeholderTextColor={theme.textMuted}
              style={[styles.input, { color: theme.textPrimary, borderColor: theme.cardBorder, backgroundColor: theme.inputBackground }]}
              autoCapitalize="none"
              secureTextEntry
            />

            {error ? <Text style={[styles.errorText, { color: theme.danger }]}>{error}</Text> : null}

            <Pressable onPress={() => { void submit(); }} disabled={loading} style={[styles.primaryButton, { backgroundColor: theme.accentPrimary }]}>
              {loading ? (
                <ActivityIndicator size="small" color="#05070F" />
              ) : (
                <Text style={styles.primaryButtonLabel}>{t('auth.continue', { defaultValue: 'Continue' })}</Text>
              )}
            </Pressable>
          </GlassCard>
        </View>
      </SafeAreaView>
    </LiquidBackground>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  header: { paddingHorizontal: 20, paddingTop: 8 },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  center: { flex: 1, justifyContent: 'center', paddingHorizontal: 20 },
  card: { padding: 22, gap: 14 },
  eyebrow: { fontSize: 12, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase' },
  title: { fontSize: 30, fontWeight: '900', lineHeight: 34 },
  modeRow: {
    flexDirection: 'row',
    borderRadius: 16,
    borderWidth: 1,
    padding: 4,
    gap: 4,
  },
  modeButton: { flex: 1, minHeight: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  modeLabel: { fontSize: 14, fontWeight: '800' },
  input: {
    minHeight: 52,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 14,
    fontSize: 14,
    fontWeight: '600',
  },
  errorText: { fontSize: 13, lineHeight: 18 },
  primaryButton: {
    minHeight: 52,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonLabel: {
    color: '#05070F',
    fontSize: 15,
    fontWeight: '900',
  },
});
