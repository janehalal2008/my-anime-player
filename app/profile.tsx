import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  ListRenderItemInfo,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';

import { GlassCard } from '@/src/components/ui/glass-card';
import { LiquidBackground } from '@/src/components/ui/liquid-background';
import { getAllVideos, initializeDatabase, parseImportedFilename, type VideoRow } from '@/src/db/database';
import { useDatabaseContext } from '@/src/db/db-context';
import { useAuth } from '@/src/providers/auth-provider';
import { useApp } from '@/src/providers/app-provider';

function formatHours(seconds: number) {
  const hours = seconds / 3600;
  return `${hours.toFixed(1)}h`;
}

function HistoryItem({ item, index }: { item: VideoRow; index: number }) {
  const { theme } = useApp();
  const title = parseImportedFilename(item.filename).cleanFilename;
  const progressPercent = item.duration > 0 ? Math.round((item.progress / item.duration) * 100) : 0;

  return (
    <Animated.View
      entering={FadeInDown.delay(index * 50).springify()}
      layout={LinearTransition.springify()}>
      <GlassCard style={styles.historyCard}>
         <View style={[styles.historyIndicator, { backgroundColor: theme.accentPrimary, width: `${progressPercent}%` }]} />
         <View style={styles.historyContent}>
            <Text style={[styles.historyTitle, { color: theme.textPrimary }]} numberOfLines={1}>{title}</Text>
            <Text style={[styles.historyPercent, { color: theme.textSecondary }]}>{progressPercent}% watched</Text>
         </View>
      </GlassCard>
    </Animated.View>
  );
}

export default function ProfileScreen() {
  const db = useDatabaseContext();
  const { t } = useTranslation();
  const { theme } = useApp();
  const { ready, user, logout } = useAuth();
  const [history, setHistory] = useState<VideoRow[]>([]);
  const [loading, setLoading] = useState(false);

  const stats = useMemo(() => {
    const totalWatchSeconds = history.reduce((sum, item) => sum + item.progress, 0);
    return {
      watched: history.length,
      time: formatHours(totalWatchSeconds),
    };
  }, [history]);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    try {
      await initializeDatabase(db);
      const rows = await getAllVideos(db);
      setHistory(rows.filter(r => r.progress > 0).sort((a,b) => b.id - a.id).slice(0, 5));
    } finally {
      setLoading(false);
    }
  }, [db]);

  useFocusEffect(useCallback(() => { if (user) loadHistory(); }, [user, loadHistory]));

  if (!ready) return null;

  return (
    <LiquidBackground>
      <View style={styles.screen}>
        {!user ? (
          <View style={styles.guestContainer}>
             <GlassCard style={styles.guestCard}>
                <Ionicons name="person-circle-outline" size={64} color={theme.textMuted} />
                <Text style={[styles.title, { color: theme.textPrimary, textAlign: 'center' }]}>Join the community</Text>
                <Pressable onPress={() => router.push('/auth')} style={[styles.authBtn, { backgroundColor: theme.accentPrimary }]}>
                   <Text style={{ fontWeight: '900' }}>Sign In</Text>
                </Pressable>
             </GlassCard>
          </View>
        ) : (
          <FlatList
            data={history}
            contentContainerStyle={styles.listContent}
            keyExtractor={item => String(item.id)}
            renderItem={({ item, index }) => <HistoryItem item={item} index={index} />}
            ListHeaderComponent={
              <View style={styles.header}>
                 <View style={styles.profileInfo}>
                    <View style={[styles.avatar, { backgroundColor: theme.surfaceStrong }]}>
                       <Text style={[styles.avatarText, { color: theme.textPrimary }]}>{user.username.slice(0, 1).toUpperCase()}</Text>
                    </View>
                    <View>
                       <Text style={[styles.username, { color: theme.textPrimary }]}>{user.username}</Text>
                       <Text style={[styles.rank, { color: theme.accentPrimary }]}>{user.rank}</Text>
                    </View>
                 </View>

                 <View style={styles.statsGrid}>
                    <GlassCard style={styles.statBox}>
                       <Text style={[styles.statValue, { color: theme.textPrimary }]}>{stats.watched}</Text>
                       <Text style={[styles.statLabel, { color: theme.textSecondary }]}>Titles</Text>
                    </GlassCard>
                    <GlassCard style={styles.statBox}>
                       <Text style={[styles.statValue, { color: theme.textPrimary }]}>{stats.time}</Text>
                       <Text style={[styles.statLabel, { color: theme.textSecondary }]}>Watched</Text>
                    </GlassCard>
                    {user.age && (
                      <GlassCard style={styles.statBox}>
                         <Text style={[styles.statValue, { color: theme.textPrimary }]}>{user.age}</Text>
                         <Text style={[styles.statLabel, { color: theme.textSecondary }]}>Age</Text>
                      </GlassCard>
                    )}
                 </View>

                 <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>Recently Watched</Text>
              </View>
            }
            ListFooterComponent={
              <Pressable onPress={() => { logout(); router.replace('/'); }} style={styles.logoutBtn}>
                 <Text style={{ color: theme.danger, fontWeight: '700' }}>Logout</Text>
              </Pressable>
            }
          />
        )}
      </View>
    </LiquidBackground>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  listContent: { padding: 20, paddingBottom: 100 },
  header: { marginBottom: 20 },
  profileInfo: { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 24, marginTop: 40 },
  avatar: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 32, fontWeight: '900' },
  username: { fontSize: 24, fontWeight: '900' },
  rank: { fontSize: 14, fontWeight: '700', textTransform: 'uppercase' },
  statsGrid: { flexDirection: 'row', gap: 12, marginBottom: 32 },
  statBox: { flex: 1, padding: 16, alignItems: 'center' },
  statValue: { fontSize: 18, fontWeight: '900' },
  statLabel: { fontSize: 12, fontWeight: '600', marginTop: 4 },
  sectionTitle: { fontSize: 18, fontWeight: '800', marginBottom: 16 },
  historyCard: { padding: 0, marginBottom: 12, overflow: 'hidden', height: 60, justifyContent: 'center' },
  historyIndicator: { position: 'absolute', top: 0, left: 0, bottom: 0, opacity: 0.1 },
  historyContent: { paddingHorizontal: 16 },
  historyTitle: { fontSize: 15, fontWeight: '700' },
  historyPercent: { fontSize: 12, fontWeight: '600', marginTop: 2 },
  logoutBtn: { marginTop: 40, alignItems: 'center', padding: 16 },
  guestContainer: { flex: 1, justifyContent: 'center', padding: 20 },
  guestCard: { padding: 32, alignItems: 'center', gap: 20 },
  title: { fontSize: 22, fontWeight: '900' },
  authBtn: { paddingHorizontal: 32, paddingVertical: 12, borderRadius: 12 },
});
