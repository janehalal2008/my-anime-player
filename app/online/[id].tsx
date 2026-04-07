import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  FlatList,
  ListRenderItemInfo,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { LinearGradient } from 'expo-linear-gradient';

import { LiquidBackground } from '@/src/components/ui/liquid-background';
import { GlassCard } from '@/src/components/ui/glass-card';
import { useApp } from '@/src/providers/app-provider';
import { useDownloads } from '@/src/providers/download-provider';
import {
  fetchAnimeDetail,
  fetchKodikTranslations,
  type CatalogAnimeDetail,
  type KodikEpisode,
  type KodikSeason,
  type KodikTranslation,
} from '@/src/services/online-catalog';

function resolveIdParam(value?: string | string[]) {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function MetadataChip({
  icon,
  label,
  accent = false
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  accent?: boolean;
}) {
  const { theme } = useApp();

  return (
    <View style={[styles.metaChip, { backgroundColor: accent ? theme.accentPrimary : 'rgba(255,255,255,0.1)' }]}>
      <Ionicons name={icon} size={12} color={accent ? '#000' : theme.textPrimary} />
      <Text style={[styles.metaChipLabel, { color: accent ? '#000' : theme.textPrimary }]}>{label}</Text>
    </View>
  );
}

function EpisodeItem({
  item,
  index,
  onPress,
  onDownload,
  downloadState
}: {
  item: KodikEpisode;
  index: number;
  onPress: () => void;
  onDownload: () => void;
  downloadState: any;
}) {
  const { theme } = useApp();
  const { t } = useTranslation();

  const isDownloading = downloadState?.status === 'downloading' || downloadState?.status === 'queued';
  const isDownloaded = downloadState?.status === 'downloaded';

  return (
    <Animated.View
      entering={FadeInDown.delay(index * 15).springify()}
      layout={LinearTransition.springify().damping(18).stiffness(180)}
      style={styles.episodeItemWrap}>
      <Pressable onPress={onPress}>
        <GlassCard style={styles.episodeCard}>
          <View style={styles.episodeLeft}>
            <View style={[styles.episodeIndex, { backgroundColor: theme.accentPrimary }]}>
              <Text style={styles.episodeIndexText}>{item.number}</Text>
            </View>
            <View style={styles.episodeInfo}>
              <Text style={[styles.episodeTitle, { color: theme.textPrimary }]} numberOfLines={1}>
                {item.title || t('online.episodeLabel', { value: item.number })}
              </Text>
              {isDownloading && (
                <View style={styles.downloadProgress}>
                   <View style={[styles.downloadBar, { width: `${(downloadState.progress || 0) * 100}%`, backgroundColor: theme.accentPrimary }]} />
                </View>
              )}
            </View>
          </View>

          <View style={styles.episodeActions}>
             <Pressable onPress={(e) => { e.stopPropagation(); onDownload(); }} disabled={isDownloading || isDownloaded} style={styles.downloadButton}>
                <Ionicons
                  name={isDownloaded ? "checkmark-done-circle" : isDownloading ? "cloud-download" : "download-outline"}
                  size={22}
                  color={isDownloaded ? theme.success : isDownloading ? theme.accentSecondary : theme.textMuted}
                />
             </Pressable>
             <Ionicons name="play-circle-outline" size={24} color={theme.accentPrimary} />
          </View>
        </GlassCard>
      </Pressable>
    </Animated.View>
  );
}

export default function OnlineAnimeDetailScreen() {
  const { theme } = useApp();
  const { downloadEpisode, getDownloadState } = useDownloads();
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const animeId = useMemo(() => resolveIdParam(params.id), [params.id]);
  const [detail, setDetail] = useState<CatalogAnimeDetail | null>(null);
  const [translations, setTranslations] = useState<KodikTranslation[]>([]);
  const [selectedDubId, setSelectedDubId] = useState<string | null>(null);
  const [selectedSeasonId, setSelectedSeasonId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAnime = useCallback(async () => {
    if (!animeId) {
      setError(t('online.loadTitleErrorCopy'));
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const nextDetail = await fetchAnimeDetail(animeId);
      setDetail(nextDetail);

      const kodikTranslations = await fetchKodikTranslations(animeId, [nextDetail.title, nextDetail.originalTitle]);

      if (kodikTranslations.length > 0) {
        setTranslations(kodikTranslations);
        setSelectedDubId(kodikTranslations[0]?.id ?? null);
        setSelectedSeasonId(kodikTranslations[0]?.seasons[0]?.id ?? null);
      }
    } catch (err) {
      console.error('Failed to load anime:', err);
      setError(t('online.loadTitleErrorCopy'));
    } finally {
      setLoading(false);
    }
  }, [animeId, t]);

  useEffect(() => {
    void loadAnime();
  }, [loadAnime]);

  const activeTranslation = useMemo(
    () => translations.find((item) => item.id === selectedDubId) ?? translations[0] ?? null,
    [selectedDubId, translations]
  );

  const activeSeason = useMemo(
    () =>
      activeTranslation?.seasons.find((season) => season.id === selectedSeasonId) ??
      activeTranslation?.seasons[0] ??
      null,
    [activeTranslation, selectedSeasonId]
  );

  const renderEpisode = ({ item, index }: ListRenderItemInfo<KodikEpisode>) => {
    const downloadKey = `${animeId}-${activeTranslation?.id}-${item.number}`;
    const dState = getDownloadState(downloadKey);

    return (
      <EpisodeItem
        item={item}
        index={index}
        downloadState={dState}
        onDownload={() => {
           const resolvedLink = item.link ?? activeSeason?.link ?? activeTranslation?.playerLink;
           if (!resolvedLink || !detail) return;

           void downloadEpisode({
              externalId: downloadKey,
              remoteUrl: resolvedLink,
              seriesTitle: detail.title,
              filename: `${detail.title} - ${item.number}.mp4`,
              episodeNumber: item.number,
              thumbnailUri: detail.posterUrl,
              playlistIcon: 'film-outline'
           });
        }}
        onPress={() => {
          const resolvedLink = item.link ?? activeSeason?.link ?? activeTranslation?.playerLink;
          if (!resolvedLink || !detail) {
            return;
          }

          router.push({
            pathname: '/player/webview',
            params: {
              url: resolvedLink,
              title: detail.title,
              subtitle: `${activeTranslation?.title} • ${activeSeason?.label} • ${t('online.episodeLabel', { value: item.number })}`,
            },
          });
        }}
      />
    );
  };

  if (loading) {
    return (
      <LiquidBackground>
        <View style={styles.centerState}>
          <ActivityIndicator size="large" color={theme.accentPrimary} />
        </View>
      </LiquidBackground>
    );
  }

  if (error || !detail) {
    return (
      <LiquidBackground>
        <View style={styles.centerState}>
          <Text style={{ color: theme.textPrimary }}>{error || 'Error'}</Text>
          <Pressable onPress={() => router.back()} style={styles.backButton}>
            <Text style={{ color: theme.accentPrimary }}>{t('common.back')}</Text>
          </Pressable>
        </View>
      </LiquidBackground>
    );
  }

  return (
    <LiquidBackground>
      <FlatList
        data={activeSeason?.episodes ?? []}
        renderItem={renderEpisode}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={styles.backdropContainer}>
               <Image source={{ uri: detail.posterUrl ?? '' }} style={styles.backdrop} contentFit="cover" />
               <LinearGradient colors={['transparent', theme.gradient[0]]} style={styles.backdropGradient} />
            </View>

            <View style={styles.topActions}>
               <Pressable onPress={() => router.back()} style={styles.iconButton}>
                  <Ionicons name="chevron-back" size={24} color="#FFF" />
               </Pressable>
            </View>

            <View style={styles.infoSection}>
               <View style={styles.posterContainer}>
                  <Image source={{ uri: detail.posterUrl ?? '' }} style={styles.mainPoster} contentFit="cover" />
               </View>

               <View style={styles.mainInfo}>
                  <Text style={[styles.title, { color: theme.textPrimary }]}>{detail.title}</Text>
                  <Text style={[styles.originalTitle, { color: theme.textSecondary }]}>{detail.originalTitle}</Text>

                  <View style={styles.metaRow}>
                     <MetadataChip icon="star" label={detail.score} accent />
                     <MetadataChip icon="film-outline" label={detail.kind.toUpperCase()} />
                  </View>
               </View>
            </View>

            <GlassCard style={styles.descriptionCard}>
               <Text style={[styles.descriptionTitle, { color: theme.textPrimary }]}>{t('common.description', { defaultValue: 'Description' })}</Text>
               <Text style={[styles.descriptionText, { color: theme.textSecondary }]}>{detail.description}</Text>

               <View style={styles.genresRow}>
                  {detail.genres.map(genre => (
                    <View key={genre} style={[styles.genreTag, { borderColor: theme.accentPrimary }]}>
                       <Text style={[styles.genreText, { color: theme.accentPrimary }]}>{genre}</Text>
                    </View>
                  ))}
               </View>
            </GlassCard>

            <View style={styles.selectors}>
               <Text style={[styles.selectorTitle, { color: theme.textPrimary }]}>{t('online.dubbingTitle')}</Text>
               <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontalScroll}>
                  {translations.map(tr => (
                    <Pressable
                      key={tr.id}
                      onPress={() => setSelectedDubId(tr.id)}
                      style={[styles.selectorItem, selectedDubId === tr.id && { backgroundColor: theme.accentPrimary, borderColor: theme.accentPrimary }]}
                    >
                       <Text style={[styles.selectorItemText, { color: selectedDubId === tr.id ? '#000' : theme.textPrimary }]}>{tr.title}</Text>
                    </Pressable>
                  ))}
               </ScrollView>

               {activeTranslation && activeTranslation.seasons.length > 1 && (
                 <>
                   <Text style={[styles.selectorTitle, { color: theme.textPrimary, marginTop: 12 }]}>{t('online.seasonsTitle')}</Text>
                   <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontalScroll}>
                      {activeTranslation.seasons.map(sn => (
                        <Pressable
                          key={sn.id}
                          onPress={() => setSelectedSeasonId(sn.id)}
                          style={[styles.selectorItem, selectedSeasonId === sn.id && { backgroundColor: theme.accentPrimary, borderColor: theme.accentPrimary }]}
                        >
                           <Text style={[styles.selectorItemText, { color: selectedSeasonId === sn.id ? '#000' : theme.textPrimary }]}>{sn.label}</Text>
                        </Pressable>
                      ))}
                   </ScrollView>
                 </>
               )}
            </View>

            <Text style={[styles.episodesHeader, { color: theme.textPrimary }]}>{t('online.episodesTitle')}</Text>
          </View>
        }
      />
    </LiquidBackground>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    paddingBottom: 40,
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    paddingBottom: 20,
  },
  backdropContainer: {
    height: 300,
    width: '100%',
    position: 'relative',
  },
  backdrop: {
    width: '100%',
    height: '100%',
    opacity: 0.4,
  },
  backdropGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '100%',
  },
  topActions: {
    position: 'absolute',
    top: 50,
    left: 20,
    right: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    zIndex: 10,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoSection: {
    flexDirection: 'row',
    marginTop: -120,
    paddingHorizontal: 20,
    gap: 16,
  },
  posterContainer: {
    width: 120,
    height: 180,
    borderRadius: 16,
    overflow: 'hidden',
    elevation: 10,
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
  },
  mainPoster: {
    width: '100%',
    height: '100%',
  },
  mainInfo: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingBottom: 10,
  },
  title: {
    fontSize: 24,
    fontWeight: '900',
    marginBottom: 4,
  },
  originalTitle: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 12,
  },
  metaRow: {
    flexDirection: 'row',
    gap: 8,
  },
  metaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    gap: 5,
  },
  metaChipLabel: {
    fontSize: 12,
    fontWeight: '800',
  },
  descriptionCard: {
    margin: 20,
    padding: 16,
  },
  descriptionTitle: {
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 10,
  },
  descriptionText: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 16,
  },
  genresRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  genreTag: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
  },
  genreText: {
    fontSize: 12,
    fontWeight: '700',
  },
  selectors: {
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  selectorTitle: {
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 12,
  },
  horizontalScroll: {
    gap: 10,
  },
  selectorItem: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  selectorItemText: {
    fontSize: 14,
    fontWeight: '700',
  },
  episodesHeader: {
    fontSize: 20,
    fontWeight: '900',
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  episodeItemWrap: {
    paddingHorizontal: 20,
    marginBottom: 10,
  },
  episodeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
  },
  episodeLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  episodeIndex: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  episodeIndexText: {
    color: '#000',
    fontWeight: '900',
  },
  episodeInfo: {
    flex: 1,
    gap: 4,
  },
  episodeTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  episodeActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  downloadProgress: {
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 2,
    overflow: 'hidden',
    marginTop: 4,
  },
  downloadBar: {
    height: '100%',
  },
  downloadButton: {
    padding: 4,
  },
  backButton: {
    marginTop: 20,
    padding: 10,
  },
});
