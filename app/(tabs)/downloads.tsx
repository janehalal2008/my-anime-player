import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { useFocusEffect } from '@react-navigation/native';
import { router, useNavigation } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  ListRenderItemInfo,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { LinearGradient } from 'expo-linear-gradient';

import { LiquidBackground } from '@/src/components/ui/liquid-background';
import { GlassCard } from '@/src/components/ui/glass-card';
import { deleteVideoById, getDownloadRows, initializeDatabase, type DownloadRow } from '@/src/db/database';
import { useDatabaseContext } from '@/src/db/db-context';
import { useDownloads } from '@/src/providers/download-provider';
import { useApp } from '@/src/providers/app-provider';

function DownloadCard({
  item,
  index,
  activeProgress,
  onPlay,
  onDelete,
}: {
  item: DownloadRow;
  index: number;
  activeProgress: number;
  onPlay: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const { theme } = useApp();
  const progress = Math.max(item.download_progress, activeProgress);
  const isDownloaded = item.download_status === 'downloaded' && Boolean(item.uri);
  const isDownloading = item.download_status === 'downloading' || item.download_status === 'queued';

  return (
    <Animated.View
      entering={FadeInDown.delay(index * 50).springify()}
      layout={LinearTransition.springify().damping(18).stiffness(180)}>
      <GlassCard style={styles.card}>
        <View style={styles.cardRow}>
          <View style={styles.thumbnailContainer}>
            {item.thumbnail_uri ? (
              <Image source={{ uri: item.thumbnail_uri }} style={styles.thumbnail} contentFit="cover" />
            ) : (
              <View style={[styles.thumbnail, { backgroundColor: theme.surfaceStrong }]}>
                <Ionicons name="film-outline" size={24} color={theme.textMuted} />
              </View>
            )}
            {isDownloading && (
              <View style={styles.loadingOverlay}>
                <ActivityIndicator size="small" color={theme.accentPrimary} />
              </View>
            )}
          </View>

          <View style={styles.info}>
            <Text style={[styles.title, { color: theme.textPrimary }]} numberOfLines={1}>
              {item.filename.replace(/\.[^.]+$/i, '').replace(/_/g, ' ')}
            </Text>
            <Text style={[styles.meta, { color: theme.textSecondary }]}>
              {item.playlist_name}
            </Text>

            <View style={styles.progressSection}>
              <View style={[styles.progressBarTrack, { backgroundColor: 'rgba(255,255,255,0.1)' }]}>
                 <View style={[styles.progressBarFill, { width: `${progress * 100}%`, backgroundColor: theme.accentPrimary }]} />
              </View>
              <Text style={[styles.progressText, { color: theme.textMuted }]}>{Math.round(progress * 100)}%</Text>
            </View>
          </View>

          <View style={styles.actions}>
            {isDownloaded ? (
              <Pressable onPress={onPlay} style={[styles.actionButton, { backgroundColor: theme.accentPrimary }]}>
                <Ionicons name="play" size={18} color="#000" />
              </Pressable>
            ) : (
              <View style={[styles.actionButton, { backgroundColor: 'rgba(255,255,255,0.05)' }]}>
                <Ionicons name="cloud-download-outline" size={18} color={theme.textMuted} />
              </View>
            )}
            <Pressable onPress={onDelete} style={styles.deleteButton}>
              <Ionicons name="trash-outline" size={18} color={theme.danger} />
            </Pressable>
          </View>
        </View>
      </GlassCard>
    </Animated.View>
  );
}

export default function DownloadsTabScreen() {
  const db = useDatabaseContext();
  const navigation = useNavigation();
  const { t } = useTranslation();
  const { theme } = useApp();
  const { activeDownloads } = useDownloads();
  const [items, setItems] = useState<DownloadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadDownloads = useCallback(async () => {
    setRefreshing(true);
    try {
      await initializeDatabase(db);
      const data = await getDownloadRows(db);
      setItems(data);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      void loadDownloads();
    }, [loadDownloads])
  );

  useEffect(() => {
    if (Object.keys(activeDownloads).length > 0) {
       // Refresh more frequently during active downloads
       const interval = setInterval(loadDownloads, 2000);
       return () => clearInterval(interval);
    }
  }, [activeDownloads, loadDownloads]);

  const activeProgressByVideoId = useMemo(() => {
    return Object.values(activeDownloads).reduce<Record<number, number>>((acc, item) => {
      acc[item.videoId] = item.progress;
      return acc;
    }, {});
  }, [activeDownloads]);

  const renderItem = ({ item, index }: ListRenderItemInfo<DownloadRow>) => (
    <DownloadCard
      item={item}
      index={index}
      activeProgress={activeProgressByVideoId[item.id] ?? 0}
      onPlay={() => {
        router.push({
          pathname: '/player/[source]/[id]',
          params: { source: 'download', id: String(item.id) },
        });
      }}
      onDelete={async () => {
        setItems(prev => prev.filter(i => i.id !== item.id));
        await deleteVideoById(db, item.id);
      }}
    />
  );

  return (
    <LiquidBackground>
      <View style={styles.screen}>
        <FlatList
          data={items}
          renderItem={renderItem}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          onRefresh={loadDownloads}
          refreshing={refreshing}
          ListHeaderComponent={
            <View style={styles.header}>
              <Text style={[styles.eyebrow, { color: theme.textMuted }]}>{t('downloads.eyebrow')}</Text>
              <Text style={[styles.title, { color: theme.textPrimary }]}>{t('downloads.title')}</Text>
              <Text style={[styles.subtitle, { color: theme.textSecondary }]}>{t('downloads.subtitle')}</Text>
            </View>
          }
          ListEmptyComponent={
            !loading ? (
              <View style={styles.emptyState}>
                <Ionicons name="cloud-download-outline" size={64} color={theme.textMuted} />
                <Text style={[styles.emptyTitle, { color: theme.textPrimary }]}>{t('downloads.emptyTitle')}</Text>
                <Text style={[styles.emptySubtitle, { color: theme.textSecondary }]}>{t('downloads.emptyCopy')}</Text>
              </View>
            ) : null
          }
        />
      </View>
    </LiquidBackground>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  listContent: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 100 },
  header: { marginBottom: 24 },
  eyebrow: { fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1.2 },
  title: { fontSize: 32, fontWeight: '900', marginTop: 4 },
  subtitle: { fontSize: 14, marginTop: 8, lineHeight: 20 },
  card: { padding: 12, marginBottom: 12 },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  thumbnailContainer: { width: 60, height: 84, borderRadius: 10, overflow: 'hidden', position: 'relative' },
  thumbnail: { width: '100%', height: '100%' },
  loadingOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' },
  info: { flex: 1, gap: 4 },
  title: { fontSize: 15, fontWeight: '800' },
  meta: { fontSize: 12, fontWeight: '600' },
  progressSection: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  progressBarTrack: { flex: 1, height: 4, borderRadius: 2, overflow: 'hidden' },
  progressBarFill: { height: '100%' },
  progressText: { fontSize: 10, fontWeight: '800', width: 25 },
  actions: { gap: 8, alignItems: 'center' },
  actionButton: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  deleteButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  emptyState: { alignItems: 'center', justifyContent: 'center', marginTop: 100, gap: 12 },
  emptyTitle: { fontSize: 20, fontWeight: '800' },
  emptySubtitle: { fontSize: 14, textAlign: 'center', maxWidth: 280, lineHeight: 20 },
});
