import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { useFocusEffect } from '@react-navigation/native';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  ListRenderItemInfo,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';

import { GlassCard } from '@/src/components/ui/glass-card';
import { GlassPressable } from '@/src/components/ui/glass-pressable';
import { LiquidBackground } from '@/src/components/ui/liquid-background';
import {
  deleteVideoById,
  DEFAULT_PLAYLIST_ICON,
  getAllPlaylists,
  getPlaylistById,
  getVideosByPlaylist,
  initializeDatabase,
  moveVideoToPlaylist,
  parseImportedFilename,
  renameVideo,
  setVideoPinned,
  type PlaylistDetailRow,
  type VideoRow,
} from '@/src/db/database';
import { useDatabaseContext } from '@/src/db/db-context';
import { useApp } from '@/src/providers/app-provider';

type VideoMenuMode = 'actions' | 'rename' | 'move' | null;
const AnimatedView = Animated.createAnimatedComponent(View);
const PRIMARY_TEXT = '#FFFFFF';
const SECONDARY_TEXT = '#A0A0A0';
const GLASS_BG = 'rgba(10, 14, 28, 0.42)';
const GLASS_BORDER = 'rgba(255,255,255,0.1)';

function resolvePlaylistIcon(icon?: string): keyof typeof Ionicons.glyphMap {
  if (icon && Object.prototype.hasOwnProperty.call(Ionicons.glyphMap, icon)) {
    return icon as keyof typeof Ionicons.glyphMap;
  }

  return DEFAULT_PLAYLIST_ICON as keyof typeof Ionicons.glyphMap;
}

function formatClock(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '00:00';
  }

  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainingSeconds = total % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
  }

  return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
}

function progressRatio(video: VideoRow) {
  if (!video.duration || video.duration <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(video.progress / video.duration, 1));
}

function displayFilename(filename: string) {
  return parseImportedFilename(filename).cleanFilename || filename.replace(/\.[^.]+$/i, '').trim() || filename;
}

function ActionSheetButton({
  label,
  icon,
  onPress,
  destructive,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  destructive?: boolean;
}) {
  const { theme } = useApp();

  return (
    <Pressable onPress={onPress} style={[styles.sheetButton, { borderBottomColor: theme.separator }]}>
      <Ionicons name={icon} size={18} color={destructive ? theme.danger : theme.textPrimary} />
      <Text style={[styles.sheetButtonLabel, { color: destructive ? theme.danger : theme.textPrimary }]}>
        {label}
      </Text>
    </Pressable>
  );
}

function EpisodeRow({
  item,
  index,
  onPlay,
  onOpenMenu,
}: {
  item: VideoRow;
  index: number;
  onPlay: () => void;
  onOpenMenu: () => void;
}) {
  const { t } = useTranslation();
  const { theme } = useApp();
  const ratio = progressRatio(item);

  return (
    <AnimatedView
      entering={FadeInDown.delay(index * 100).springify()}
      layout={LinearTransition.springify().damping(20).stiffness(180)}>
      <Pressable onPress={onPlay}>
        <BlurView intensity={40} tint="dark" style={styles.episodeCard}>
        {item.is_pinned ? (
          <View style={styles.pinBadge}>
            <Ionicons name="pin" size={12} color={PRIMARY_TEXT} />
          </View>
        ) : null}

        <View style={styles.episodeTopRow}>
          {item.thumbnail_uri ? (
            <Image source={{ uri: item.thumbnail_uri }} style={styles.thumbnail} contentFit="cover" />
          ) : (
            <View style={[styles.iconWrap, { backgroundColor: theme.surfaceStrong }]}>
              <Ionicons name="play" size={18} color={PRIMARY_TEXT} />
            </View>
          )}

          <Pressable
            onPress={(event) => {
              event.stopPropagation();
              onOpenMenu();
            }}
            style={[styles.menuButton, { backgroundColor: theme.surfaceMuted }]}>
            <Ionicons name="ellipsis-horizontal" size={18} color={PRIMARY_TEXT} />
          </Pressable>
        </View>

        <Text style={styles.episodeTitle} numberOfLines={2}>
          {displayFilename(item.filename)}
        </Text>
        <Text style={styles.episodeMeta}>
          {item.episode_num
            ? t('playlist.episode', { value: item.episode_num })
            : t('playlist.unknownEpisode')}{' '}
          • {t('playlist.durationLine', { progress: formatClock(item.progress), duration: formatClock(item.duration) })}
        </Text>

        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${ratio * 100}%`, backgroundColor: theme.accentPrimary }]} />
        </View>
        </BlurView>
      </Pressable>
    </AnimatedView>
  );
}

export default function FolderScreen() {
  const db = useDatabaseContext();
  const navigation = useNavigation();
  const { t } = useTranslation();
  const { theme } = useApp();
  const { width } = useWindowDimensions();
  const params = useLocalSearchParams<{ folderKey?: string | string[] }>();
  const rawPlaylistId = Array.isArray(params.folderKey) ? params.folderKey[0] : params.folderKey;
  const playlistId = Number(rawPlaylistId);

  const [playlist, setPlaylist] = useState<PlaylistDetailRow | null>(null);
  const [videos, setVideos] = useState<VideoRow[]>([]);
  const [allPlaylists, setAllPlaylists] = useState<PlaylistDetailRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedVideo, setSelectedVideo] = useState<VideoRow | null>(null);
  const [videoMenuMode, setVideoMenuMode] = useState<VideoMenuMode>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [submittingAction, setSubmittingAction] = useState(false);

  const availablePlaylists = useMemo(
    () => allPlaylists.filter((item) => item.id !== playlistId),
    [allPlaylists, playlistId]
  );
  const episodeColumnCount = width >= 1380 ? 2 : 1;
  const contentMaxWidth = width >= 1700 ? 1500 : width >= 1300 ? 1260 : 980;

  const loadPlaylistData = useCallback(async () => {
    setError(null);
    setLoading(true);

    try {
      await initializeDatabase(db);

      if (!Number.isFinite(playlistId) || playlistId <= 0) {
        throw new Error(t('playlist.loadError'));
      }

      const [playlistRow, videoRows, playlistRows] = await Promise.all([
        getPlaylistById(db, playlistId),
        getVideosByPlaylist(db, playlistId),
        getAllPlaylists(db),
      ]);

      if (!playlistRow) {
        throw new Error(t('playlist.loadError'));
      }

      setPlaylist(playlistRow);
      setVideos(videoRows);
      setAllPlaylists(playlistRows);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t('playlist.loadError'));
      setPlaylist(null);
      setVideos([]);
      setAllPlaylists([]);
    } finally {
      setLoading(false);
    }
  }, [db, playlistId, t]);

  useFocusEffect(
    useCallback(() => {
      void loadPlaylistData();
    }, [loadPlaylistData])
  );

  useEffect(() => {
    navigation.setOptions({
      headerShown: true,
      headerTransparent: true,
      headerTitle: '',
      headerShadowVisible: false,
      headerBackVisible: false,
      headerLeft: () => null,
      headerStyle: {
        backgroundColor: 'transparent',
      },
    });
  }, [navigation]);

  const closeMenus = useCallback(() => {
    setSelectedVideo(null);
    setVideoMenuMode(null);
    setRenameDraft('');
  }, []);

  const handleTogglePin = useCallback(async () => {
    if (!selectedVideo) {
      return;
    }

    setSubmittingAction(true);
    setError(null);

    try {
      await setVideoPinned(db, selectedVideo.id, selectedVideo.is_pinned === 0);
      closeMenus();
      await loadPlaylistData();
    } catch {
      setError(t('playlist.loadError'));
    } finally {
      setSubmittingAction(false);
    }
  }, [closeMenus, db, loadPlaylistData, selectedVideo, t]);

  const handleRename = useCallback(async () => {
    if (!selectedVideo) {
      return;
    }

    setSubmittingAction(true);
    setError(null);

    try {
      await renameVideo(db, selectedVideo.id, renameDraft);
      closeMenus();
      await loadPlaylistData();
    } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : t('playlist.renameVideo'));
    } finally {
      setSubmittingAction(false);
    }
  }, [closeMenus, db, loadPlaylistData, renameDraft, selectedVideo, t]);

  const handleDelete = useCallback(async () => {
    if (!selectedVideo) {
      return;
    }

    const videoId = selectedVideo.id;
    setSubmittingAction(true);
    setError(null);

    try {
      setVideos(prev => prev.filter(v => v.id !== videoId));
      await deleteVideoById(db, videoId);
      closeMenus();
    } catch {
      setError(t('playlist.deleteVideo'));
      await loadPlaylistData();
    } finally {
      setSubmittingAction(false);
    }
  }, [closeMenus, db, loadPlaylistData, selectedVideo, t]);

  const handleMove = useCallback(
    async (targetPlaylistId: number) => {
      if (!selectedVideo) {
        return;
      }

      setSubmittingAction(true);
      setError(null);

      try {
        await moveVideoToPlaylist(db, selectedVideo.id, targetPlaylistId);
        closeMenus();
        await loadPlaylistData();
      } catch {
        setError(t('playlist.moveVideo'));
      } finally {
        setSubmittingAction(false);
      }
    },
    [closeMenus, db, loadPlaylistData, selectedVideo, t]
  );

  const renderItem = ({ item, index }: ListRenderItemInfo<VideoRow>) => (
    <EpisodeRow
      item={item}
      index={index}
      onPlay={() => {
        router.push({
          pathname: '/player/[source]/[id]',
          params: {
            source: 'library',
            id: String(item.id),
          },
        });
      }}
      onOpenMenu={() => {
        setSelectedVideo(item);
        setVideoMenuMode('actions');
        setRenameDraft(item.filename);
      }}
    />
  );

  return (
    <LiquidBackground>
      <View style={styles.screen}>
        {loading ? (
          <View style={styles.centerState}>
            <ActivityIndicator size="large" color={theme.textPrimary} />
            <Text style={[styles.stateTitle, { color: theme.textPrimary }]}>{t('playlist.loading')}</Text>
          </View>
        ) : (
          <FlatList
            data={videos}
            renderItem={renderItem}
            keyExtractor={(item) => String(item.id)}
            numColumns={episodeColumnCount}
            columnWrapperStyle={episodeColumnCount > 1 ? styles.episodeColumns : undefined}
            contentContainerStyle={[
              styles.listContent,
              { maxWidth: contentMaxWidth, alignSelf: 'center', width: '100%' },
              videos.length === 0 && styles.listContentEmpty,
            ]}
            showsVerticalScrollIndicator={false}
            initialNumToRender={12}
            maxToRenderPerBatch={12}
            windowSize={8}
            removeClippedSubviews
            ItemSeparatorComponent={() => <View style={{ height: 16 }} />}
            ListHeaderComponent={
              <>
                <AnimatedView entering={FadeInDown.duration(420)} style={styles.header}>
                  <GlassPressable
                    onPress={() => {
                      router.back();
                    }}
                    style={styles.backButtonWrap}
                    contentStyle={styles.backButton}>
                    <Ionicons name="chevron-back" size={20} color={theme.textPrimary} />
                  </GlassPressable>

                  <View style={styles.headerCopy}>
                    <Text style={[styles.eyebrow, { color: theme.textMuted }]}>{t('playlist.headerEyebrow')}</Text>
                    <View style={styles.playlistIdentityRow}>
                      <View style={[styles.playlistIconWrap, { backgroundColor: theme.surfaceStrong }]}>
                        <Ionicons name={resolvePlaylistIcon(playlist?.icon)} size={18} color={theme.textPrimary} />
                      </View>
                      {playlist?.is_pinned ? (
                        <View style={[styles.headerPinBadge, { backgroundColor: theme.surfaceStrong }]}>
                          <Ionicons name="pin" size={12} color={theme.textPrimary} />
                        </View>
                      ) : null}
                    </View>
                    <Text style={[styles.headerTitle, { color: theme.textPrimary }]} numberOfLines={2}>
                      {playlist?.name ?? t('common.playlist')}
                    </Text>
                    <Text style={[styles.headerSubtitle, { color: theme.textSecondary }]}>
                      {playlist ? `${videos.length} • ${t('common.file')}` : t('playlist.loadError')}
                    </Text>
                  </View>
                </AnimatedView>

                {error ? (
                  <GlassCard style={styles.messageCard}>
                    <Text style={[styles.messageText, { color: theme.danger }]}>{error}</Text>
                  </GlassCard>
                ) : null}
              </>
            }
            ListEmptyComponent={
              <View style={styles.emptyStateWrap}>
                <GlassCard style={styles.emptyCard}>
                  <Text style={[styles.emptyTitle, { color: theme.textPrimary }]}>{t('playlist.emptyTitle')}</Text>
                  <Text style={[styles.emptyCopy, { color: theme.textSecondary }]}>{t('playlist.emptyCopy')}</Text>
                </GlassCard>
              </View>
            }
          />
        )}
      </View>

      <Modal
        animationType="fade"
        transparent
        visible={videoMenuMode === 'actions' && Boolean(selectedVideo)}
        onRequestClose={closeMenus}>
        <View style={styles.modalBackdrop}>
          <GlassCard style={styles.sheetCard}>
            <Text style={[styles.sheetTitle, { color: theme.textPrimary }]}>
              {selectedVideo ? displayFilename(selectedVideo.filename) : ''}
            </Text>

            <ActionSheetButton
              label={selectedVideo?.is_pinned ? t('actions.unpin') : t('actions.pin')}
              icon="pin-outline"
              onPress={() => {
                void handleTogglePin();
              }}
            />
            <ActionSheetButton
              label={t('actions.rename')}
              icon="create-outline"
              onPress={() => {
                setVideoMenuMode('rename');
              }}
            />
            <ActionSheetButton
              label={t('actions.move')}
              icon="swap-horizontal-outline"
              onPress={() => {
                setVideoMenuMode('move');
              }}
            />
            <ActionSheetButton
              label={t('actions.delete')}
              icon="trash-outline"
              destructive
              onPress={() => {
                void handleDelete();
              }}
            />

            <Pressable onPress={closeMenus} style={[styles.closeRowButton, { backgroundColor: theme.surfaceMuted }]}>
              <Text style={[styles.closeRowLabel, { color: theme.textPrimary }]}>{t('common.close')}</Text>
            </Pressable>
          </GlassCard>
        </View>
      </Modal>

      <Modal
        animationType="fade"
        transparent
        visible={videoMenuMode === 'rename' && Boolean(selectedVideo)}
        onRequestClose={closeMenus}>
        <View style={styles.modalBackdrop}>
          <GlassCard style={styles.modalCard}>
            <Text style={[styles.modalTitle, { color: theme.textPrimary }]}>{t('playlist.renameVideo')}</Text>
            <TextInput
              value={renameDraft}
              onChangeText={setRenameDraft}
              placeholder={t('playlist.renamePlaceholder')}
              placeholderTextColor={theme.textMuted}
              style={[
                styles.modalInput,
                {
                  color: theme.textPrimary,
                  backgroundColor: theme.inputBackground,
                  borderColor: theme.separator,
                },
              ]}
            />

            <View style={styles.modalActions}>
              <Pressable onPress={closeMenus} style={[styles.modalButton, { backgroundColor: theme.surfaceMuted }]}>
                <Text style={[styles.modalButtonLabel, { color: theme.textPrimary }]}>{t('common.cancel')}</Text>
              </Pressable>
              <Pressable
                disabled={submittingAction}
                onPress={() => {
                  void handleRename();
                }}
                style={[styles.modalButton, { backgroundColor: theme.surfaceStrong }]}>
                {submittingAction ? (
                  <ActivityIndicator size="small" color={theme.textPrimary} />
                ) : (
                  <Text style={[styles.modalButtonLabel, { color: theme.textPrimary }]}>{t('common.save')}</Text>
                )}
              </Pressable>
            </View>
          </GlassCard>
        </View>
      </Modal>

      <Modal
        animationType="fade"
        transparent
        visible={videoMenuMode === 'move' && Boolean(selectedVideo)}
        onRequestClose={closeMenus}>
        <View style={styles.modalBackdrop}>
          <GlassCard style={styles.modalCard}>
            <Text style={[styles.modalTitle, { color: theme.textPrimary }]}>{t('playlist.moveVideo')}</Text>

            {availablePlaylists.length === 0 ? (
              <Text style={[styles.modalCopy, { color: theme.textSecondary }]}>{t('playlist.noTargetPlaylists')}</Text>
            ) : (
              availablePlaylists.map((item) => (
                <Pressable
                  key={item.id}
                  disabled={submittingAction}
                  onPress={() => {
                    void handleMove(item.id);
                  }}
                  style={[styles.playlistOption, { backgroundColor: theme.surfaceMuted }]}>
                  <View style={styles.playlistOptionCopy}>
                    <Ionicons name={resolvePlaylistIcon(item.icon)} size={16} color={theme.accentPrimary} />
                    <Text style={[styles.playlistOptionLabel, { color: theme.textPrimary }]}>{item.name}</Text>
                  </View>
                </Pressable>
              ))
            )}

            <Pressable onPress={closeMenus} style={[styles.closeRowButton, { backgroundColor: theme.surfaceStrong }]}>
              <Text style={[styles.closeRowLabel, { color: theme.textPrimary }]}>{t('common.close')}</Text>
            </Pressable>
          </GlassCard>
        </View>
      </Modal>
    </LiquidBackground>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    marginBottom: 20,
  },
  backButtonWrap: {
    width: 58,
    height: 58,
  },
  backButton: {
    width: 58,
    height: 58,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
  },
  headerCopy: {
    flex: 1,
  },
  playlistIdentityRow: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  playlistIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerPinBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  eyebrow: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  headerTitle: {
    marginTop: 8,
    fontSize: 30,
    fontWeight: '800',
    lineHeight: 34,
  },
  headerSubtitle: {
    marginTop: 8,
    fontSize: 14,
    lineHeight: 20,
  },
  messageCard: {
    marginBottom: 14,
    padding: 14,
  },
  messageText: {
    fontSize: 14,
    fontWeight: '700',
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  stateTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  listContent: {
    paddingTop: 20,
    paddingHorizontal: 20,
    paddingBottom: 120,
  },
  listContentEmpty: {
    flexGrow: 1,
  },
  episodeColumns: {
    gap: 16,
    marginBottom: 16,
  },
  episodeWrap: {
    flex: 1,
  },
  episodeCard: {
    padding: 16,
    gap: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: GLASS_BORDER,
    overflow: 'hidden',
    backgroundColor: GLASS_BG,
  },
  pinBadge: {
    position: 'absolute',
    top: 14,
    right: 14,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
    backgroundColor: 'rgba(0,0,0,0.36)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  episodeTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  iconWrap: {
    width: 46,
    height: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbnail: {
    width: 72,
    height: 72,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  menuButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  episodeTitle: {
    color: PRIMARY_TEXT,
    fontSize: 16,
    fontWeight: '800',
    lineHeight: 22,
  },
  episodeMeta: {
    color: SECONDARY_TEXT,
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
  progressTrack: {
    height: 6,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
  },
  emptyCard: {
    width: '100%',
    padding: 22,
  },
  emptyStateWrap: {
    flex: 1,
    justifyContent: 'center',
    paddingTop: 12,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '800',
  },
  emptyCopy: {
    marginTop: 8,
    fontSize: 14,
    lineHeight: 20,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(4, 7, 18, 0.56)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    maxWidth: 420,
    padding: 20,
    gap: 16,
  },
  sheetCard: {
    width: '100%',
    maxWidth: 420,
    padding: 18,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 8,
  },
  sheetButton: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sheetButtonLabel: {
    fontSize: 15,
    fontWeight: '700',
  },
  closeRowButton: {
    marginTop: 16,
    minHeight: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeRowLabel: {
    fontSize: 14,
    fontWeight: '800',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '800',
  },
  modalInput: {
    minHeight: 52,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 14,
    fontSize: 15,
    fontWeight: '600',
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  modalButton: {
    minWidth: 110,
    minHeight: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  modalButtonLabel: {
    fontSize: 14,
    fontWeight: '800',
  },
  modalCopy: {
    fontSize: 14,
    lineHeight: 20,
  },
  playlistOption: {
    minHeight: 48,
    borderRadius: 14,
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  playlistOptionCopy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  playlistOptionLabel: {
    fontSize: 14,
    fontWeight: '700',
  },
});
