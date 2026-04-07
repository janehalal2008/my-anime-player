import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import { Image } from 'expo-image';
import { type ReactNode, useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';

import { GlassCard } from '@/src/components/ui/glass-card';
import { LiquidBackground } from '@/src/components/ui/liquid-background';
import { clearBrokenVideoEntries, initializeDatabase } from '@/src/db/database';
import { useDatabaseContext } from '@/src/db/db-context';
import { SUPPORTED_LANGUAGES } from '@/src/i18n';
import { useApp } from '@/src/providers/app-provider';
import { THEME_PRESET_OPTIONS } from '@/src/theme/liquid';

function SettingToggle({ title, value, onValueChange }: { title: string, value: boolean, onValueChange: (v: boolean) => void }) {
  const { theme } = useApp();
  return (
    <GlassCard style={styles.settingCard}>
       <Text style={[styles.settingText, { color: theme.textPrimary }]}>{title}</Text>
       <Switch
         value={value}
         onValueChange={onValueChange}
         trackColor={{ false: 'rgba(255,255,255,0.1)', true: theme.accentPrimary }}
       />
    </GlassCard>
  );
}

export default function SettingsTabScreen() {
  const db = useDatabaseContext();
  const { t } = useTranslation();
  const {
    theme,
    language,
    autoDeleteWatchedEpisodes,
    themePreset,
    setLanguage,
    setAutoDeleteWatchedEpisodes,
    setThemePreset,
  } = useApp();

  const [sheetMode, setSheetMode] = useState<'language' | 'theme' | null>(null);

  const handleClearCache = async () => {
    if (FileSystem.cacheDirectory) {
      const entries = await FileSystem.readDirectoryAsync(FileSystem.cacheDirectory);
      for (const entry of entries) {
        await FileSystem.deleteAsync(`${FileSystem.cacheDirectory}${entry}`, { idempotent: true });
      }
    }
  };

  return (
    <LiquidBackground>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
           <Text style={[styles.eyebrow, { color: theme.textMuted }]}>Customization</Text>
           <Text style={[styles.title, { color: theme.textPrimary }]}>{t('settings.title')}</Text>
        </View>

        <View style={styles.section}>
           <SettingToggle
             title={t('settings.autoDelete')}
             value={autoDeleteWatchedEpisodes}
             onValueChange={setAutoDeleteWatchedEpisodes}
           />
        </View>

        <View style={styles.section}>
           <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>Appearance & Language</Text>
           <Pressable onPress={() => setSheetMode('language')}>
              <GlassCard style={styles.selectionCard}>
                 <Text style={[styles.selectionText, { color: theme.textPrimary }]}>Language</Text>
                 <View style={styles.selectionValue}>
                    <Text style={{ color: theme.accentPrimary }}>{SUPPORTED_LANGUAGES.find(l => l.code === language)?.nativeLabel}</Text>
                    <Ionicons name="chevron-forward" size={16} color={theme.textMuted} />
                 </View>
              </GlassCard>
           </Pressable>

           <Pressable onPress={() => setSheetMode('theme')}>
              <GlassCard style={[styles.selectionCard, { marginTop: 12 }]}>
                 <Text style={[styles.selectionText, { color: theme.textPrimary }]}>Theme</Text>
                 <View style={styles.selectionValue}>
                    <Text style={{ color: theme.accentPrimary }}>{THEME_PRESET_OPTIONS.find(t => t.id === themePreset)?.label}</Text>
                    <Ionicons name="chevron-forward" size={16} color={theme.textMuted} />
                 </View>
              </GlassCard>
           </Pressable>
        </View>

        <View style={styles.section}>
           <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>Maintenance</Text>
           <Pressable onPress={handleClearCache}>
              <GlassCard style={styles.selectionCard}>
                 <Text style={[styles.selectionText, { color: theme.textPrimary }]}>{t('settings.clearCache')}</Text>
                 <Ionicons name="trash-outline" size={18} color={theme.danger} />
              </GlassCard>
           </Pressable>
        </View>
      </ScrollView>

      <Modal animationType="slide" transparent visible={sheetMode !== null} onRequestClose={() => setSheetMode(null)}>
         <View style={styles.modalBackdrop}>
            <GlassCard style={styles.sheetCard}>
               <Text style={[styles.modalTitle, { color: theme.textPrimary }]}>{sheetMode === 'language' ? 'Select Language' : 'Select Theme'}</Text>
               <ScrollView style={{ maxHeight: 400 }}>
                  {sheetMode === 'language' ? SUPPORTED_LANGUAGES.map(l => (
                    <Pressable key={l.code} onPress={() => { setLanguage(l.code); setSheetMode(null); }} style={styles.option}>
                       <Text style={{ color: language === l.code ? theme.accentPrimary : theme.textPrimary, fontSize: 16 }}>{l.nativeLabel}</Text>
                       {language === l.code && <Ionicons name="checkmark" size={20} color={theme.accentPrimary} />}
                    </Pressable>
                  )) : THEME_PRESET_OPTIONS.map(tp => (
                    <Pressable key={tp.id} onPress={() => { setThemePreset(tp.id); setSheetMode(null); }} style={styles.option}>
                       <Text style={{ color: themePreset === tp.id ? theme.accentPrimary : theme.textPrimary, fontSize: 16 }}>{tp.label}</Text>
                       {themePreset === tp.id && <Ionicons name="checkmark" size={20} color={theme.accentPrimary} />}
                    </Pressable>
                  ))}
               </ScrollView>
               <Pressable onPress={() => setSheetMode(null)} style={styles.closeBtn}>
                  <Text style={{ color: theme.textSecondary }}>Close</Text>
               </Pressable>
            </GlassCard>
         </View>
      </Modal>
    </LiquidBackground>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingBottom: 100 },
  header: { marginBottom: 32, marginTop: 20 },
  eyebrow: { fontSize: 12, fontWeight: '800', textTransform: 'uppercase' },
  title: { fontSize: 32, fontWeight: '900', marginTop: 4 },
  section: { marginBottom: 32 },
  sectionTitle: { fontSize: 14, fontWeight: '800', textTransform: 'uppercase', marginBottom: 12, opacity: 0.6 },
  settingCard: { padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  settingText: { fontSize: 16, fontWeight: '700' },
  selectionCard: { padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  selectionText: { fontSize: 16, fontWeight: '700' },
  selectionValue: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheetCard: { padding: 24, borderBottomLeftRadius: 0, borderBottomRightRadius: 0 },
  modalTitle: { fontSize: 20, fontWeight: '900', marginBottom: 20 },
  option: { paddingVertical: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' },
  closeBtn: { marginTop: 20, alignItems: 'center', padding: 12 },
});
