import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import * as DocumentPicker from 'expo-document-picker';
import { Directory, File } from 'expo-file-system';
import { Image } from 'expo-image';
import { useFocusEffect } from '@react-navigation/native';
import { router, useNavigation } from 'expo-router';
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
  ScrollView,
} from 'react-native';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { LinearGradient } from 'expo-linear-gradient';

import { GlassCard } from '@/src/components/ui/glass-card';
import { LiquidBackground } from '@/src/components/ui/liquid-background';
import {
  createCustomPlaylist,
  DEFAULT_PLAYLIST_ICON,
  deletePlaylistById,
  getPlaylistsWithCounts,
  importVideoFromSource,
  initializeDatabase,
  parseImportedFilename,
  renamePlaylist,
  setPlaylistPinned,
  updatePlaylistIcon,
  type PlaylistRow,
} from '@/src/db/database';
import { useDatabaseContext } from '@/src/db/db-context';
import { useApp } from '@/src/providers/app-provider';
import { downloadYouTubeVideo } from '@/src/services/youtube-downloader';

type PlaylistMenuMode = 'actions' | 'rename' | null;
type ImportCandidate = {
  name: string;
  uri: string;
  file?: Blob | null;
};

const PLAYLIST_ICON_OPTIONS = [
  'folder-open-outline',
  'film-outline',
  'sparkles-outline',
  'flame-outline',
  'skull-outline',
  'heart-outline',
  'planet-outline',
  'rocket-outline',
  'game-controller-outline',
] as const;

function resolvePlaylistIcon(icon?: string): keyof typeof Ionicons.glyphMap {
  if (icon && Object.prototype.hasOwnProperty.call(Ionicons.glyphMap, icon)) {
    return icon as keyof typeof Ionicons.glyphMap;
  }

  return DEFAULT_PLAYLIST_ICON as keyof typeof Ionicons.glyphMap;
}

function PremiumAction({
  icon,
  title,
  onPress,
  color,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  onPress: () => void;
  color: string;
}) {
  return (
    <Pressable onPress={onPress} style={styles.actionItem}>
      <View style={[styles.actionIcon, { backgroundColor: `${color}20` }]}>
        <Ionicons name={icon} size={22} color={color} />
      </View>
      <Text style={styles.actionLabel} numberOfLines={1}>{title}</Text>
    </Pressable>
  );
}

function PlaylistCard({
  item,
  index,
  onPress,
  onOpenMenu,
}: {
  item: PlaylistRow;
  index: number;
  onPress: () => void;
  onOpenMenu: () => void;
}) {
  const { t } = useTranslation();
  const { theme } = useApp();

  return (
    <Animated.View
      entering={FadeInDown.delay(index * 50).springify()}
      layout={LinearTransition.springify().damping(18).stiffness(180)}
      style={styles.playlistShell}>
      <Pressable onPress={onPress}>
        <GlassCard style={styles.playlistCard}>
          <View style={styles.playlistArtwork}>
            {item.thumbnailUri ? (
              <Image source={{ uri: item.thumbnailUri }} style={styles.playlistThumbnail} contentFit="cover" />
            ) : (
              <View style={[styles.playlistThumbnail, { backgroundColor: theme.surfaceStrong }]}>
                <Ionicons name={resolvePlaylistIcon(item.icon)} size={32} color={theme.textMuted} />
              </View>
            )}

            <View style={styles.playlistBadges}>
               {item.is_pinned === 1 && (
                 <View style={[styles.pinBadge, { backgroundColor: theme.accentPrimary }]}>
                    <Ionicons name="pin" size={10} color="#000" />
                 </View>
               )}
            </View>

            <LinearGradient
              colors={['transparent', 'rgba(0,0,0,0.8)']}
              style={styles.playlistGradient}
            />

            <View style={styles.playlistInfo}>
              <Text style={styles.playlistTitle} numberOfLines={1}>{item.name}</Text>
              <Text style={styles.playlistCount}>{t('local.videosCount', { count: item.videoCount })}</Text>
            </View>
          </View>

          <Pressable onPress={onOpenMenu} style={styles.playlistMenuButton}>
             <Ionicons name="ellipsis-vertical" size={16} color="#FFF" />
          </Pressable>
        </GlassCard>
      </Pressable>
    </Animated.View>
  );
}

export default function LocalTabScreen() {
  const db = useDatabaseContext();
  const navigation = useNavigation();
  const { t } = useTranslation();
  const { theme } = useApp();
  const { width } = useWindowDimensions();
  const [playlists, setPlaylists] = useState<PlaylistRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [creatingPlaylist, setCreatingPlaylist] = useState(false);
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [customPlaylistName, setCustomPlaylistName] = useState('');
  const [customPlaylistIcon, setCustomPlaylistIcon] = useState<string>(DEFAULT_PLAYLIST_ICON);
  const [selectedPlaylist, setSelectedPlaylist] = useState<PlaylistRow | null>(null);
  const [playlistMenuMode, setPlaylistMenuMode] = useState<PlaylistMenuMode>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [renameIconDraft, setRenameIconDraft] = useState<string>(DEFAULT_PLAYLIST_ICON);
  const [pickedAssets, setPickedAssets] = useState<ImportCandidate[]>([]);
  const [importModalVisible, setImportModalVisible] = useState(false);
  const [selectedImportPlaylistId, setSelectedImportPlaylistId] = useState<number | null>(null);
  const [newImportPlaylistName, setNewImportPlaylistName] = useState('');
  const [newImportPlaylistIcon, setNewImportPlaylistIcon] = useState<string>(DEFAULT_PLAYLIST_ICON);
  const [submittingAction, setSubmittingAction] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [youtubeModalVisible, setYouTubeModalVisible] = useState(false);
  const [youtubeUrl, setYouTubeUrl] = useState('');
  const [youtubeDownloading, setYouTubeDownloading] = useState(false);
  const [youtubeProgress, setYouTubeProgress] = useState(0);

  const playlistColumnCount = width >= 1100 ? 4 : width >= 600 ? 3 : 2;

  const loadPlaylists = useCallback(async () => {
    setError(null);
    setLoading(true);
    setRefreshing(true);

    try {
      await initializeDatabase(db);
      const data = await getPlaylistsWithCounts(db);
      setPlaylists(data);
    } catch {
      setError(t('local.refreshError'));
      setPlaylists([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [db, t]);

  useFocusEffect(
    useCallback(() => {
      void loadPlaylists();
    }, [loadPlaylists])
  );

  useEffect(() => {
    navigation.setOptions({
      headerShown: false,
    });
  }, [navigation]);

  const closePlaylistModals = useCallback(() => {
    setSelectedPlaylist(null);
    setPlaylistMenuMode(null);
    setRenameDraft('');
    setRenameIconDraft(DEFAULT_PLAYLIST_ICON);
  }, []);

  const closeImportModal = useCallback(() => {
    setImportModalVisible(false);
    setPickedAssets([]);
    setSelectedImportPlaylistId(null);
    setNewImportPlaylistName('');
    setNewImportPlaylistIcon(DEFAULT_PLAYLIST_ICON);
  }, []);

  const closeYouTubeModal = useCallback(() => {
    if (youtubeDownloading) {
      return;
    }

    setYouTubeModalVisible(false);
    setYouTubeUrl('');
    setYouTubeProgress(0);
  }, [youtubeDownloading]);

  const handleCreatePlaylist = useCallback(async () => {
    const trimmedName = customPlaylistName.trim();
    if (!trimmedName) {
      setError(t('local.createError'));
      return;
    }

    setCreatingPlaylist(true);
    setError(null);

    try {
      await createCustomPlaylist(db, trimmedName, customPlaylistIcon);
      setCreateModalVisible(false);
      setCustomPlaylistName('');
      setCustomPlaylistIcon(DEFAULT_PLAYLIST_ICON);
      await loadPlaylists();
    } catch (createError) {
      setError(t('local.createError'));
    } finally {
      setCreatingPlaylist(false);
    }
  }, [customPlaylistIcon, customPlaylistName, db, loadPlaylists, t]);

  const handleTogglePin = useCallback(async () => {
    if (!selectedPlaylist) {
      return;
    }

    setSubmittingAction(true);
    try {
      await setPlaylistPinned(db, selectedPlaylist.id, selectedPlaylist.is_pinned === 0);
      closePlaylistModals();
      await loadPlaylists();
    } catch {
      setError(t('local.refreshError'));
    } finally {
      setSubmittingAction(false);
    }
  }, [closePlaylistModals, db, loadPlaylists, selectedPlaylist, t]);

  const handleDelete = useCallback(async () => {
    if (!selectedPlaylist) {
      return;
    }

    const playlistId = selectedPlaylist.id;
    setSubmittingAction(true);

    try {
      setPlaylists(prev => prev.filter(p => p.id !== playlistId));
      await deletePlaylistById(db, playlistId);
      closePlaylistModals();
    } catch {
      setError(t('common.delete'));
      await loadPlaylists();
    } finally {
      setSubmittingAction(false);
    }
  }, [closePlaylistModals, db, loadPlaylists, selectedPlaylist, t]);

  const renderPlaylist = ({ item, index }: ListRenderItemInfo<PlaylistRow>) => (
    <PlaylistCard
      item={item}
      index={index}
      onPress={() => {
        router.push({
          pathname: '/folder/[folderKey]',
          params: { folderKey: String(item.id) },
        });
      }}
      onOpenMenu={() => {
        setSelectedPlaylist(item);
        setPlaylistMenuMode('actions');
        setRenameDraft(item.name);
        setRenameIconDraft(item.icon || DEFAULT_PLAYLIST_ICON);
      }}
    />
  );

  return (
    <LiquidBackground>
      <View style={styles.screen}>
        <FlatList
          data={playlists}
          renderItem={renderPlaylist}
          keyExtractor={(item) => String(item.id)}
          numColumns={playlistColumnCount}
          columnWrapperStyle={styles.playlistRow}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <View style={styles.header}>
              <View style={styles.headerTop}>
                <View>
                  <Text style={[styles.eyebrow, { color: theme.textMuted }]}>{t('local.eyebrow')}</Text>
                  <Text style={[styles.title, { color: theme.textPrimary }]}>{t('local.title')}</Text>
                </View>
                <Pressable onPress={loadPlaylists} style={[styles.refreshButton, { backgroundColor: theme.surfaceStrong }]}>
                   <Ionicons name="refresh" size={20} color={theme.textPrimary} />
                </Pressable>
              </View>

              <GlassCard style={styles.actionsCard}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.actionsScroll}>
                   <PremiumAction icon="add-circle-outline" title={t('local.createPlaylist')} color={theme.accentPrimary} onPress={() => setCreateModalVisible(true)} />
                   <PremiumAction icon="cloud-upload-outline" title={t('local.importFiles')} color={theme.accentSecondary} onPress={() => {}} />
                   <PremiumAction icon="logo-youtube" title="YouTube" color="#FF0000" onPress={() => setYouTubeModalVisible(true)} />
                </ScrollView>
              </GlassCard>

              <Text style={[styles.sectionTitle, { color: theme.textPrimary }]}>{t('common.playlist')}</Text>
            </View>
          }
          ListEmptyComponent={
            !loading ? (
              <View style={styles.emptyState}>
                 <Ionicons name="folder-open-outline" size={48} color={theme.textMuted} />
                 <Text style={[styles.emptyText, { color: theme.textSecondary }]}>{t('local.emptyTitle')}</Text>
              </View>
            ) : null
          }
        />
      </View>

      <Modal animationType="fade" transparent visible={createModalVisible} onRequestClose={() => setCreateModalVisible(false)}>
        <View style={styles.modalBackdrop}>
           <GlassCard style={styles.modalCard}>
              <Text style={[styles.modalTitle, { color: theme.textPrimary }]}>{t('local.createTitle')}</Text>
              <TextInput
                value={customPlaylistName}
                onChangeText={setCustomPlaylistName}
                placeholder={t('local.createPlaceholder')}
                placeholderTextColor={theme.textMuted}
                style={[styles.input, { color: theme.textPrimary, borderColor: theme.cardBorder, backgroundColor: theme.inputBackground }]}
                autoFocus
              />
              <View style={styles.modalActions}>
                 <Pressable onPress={() => setCreateModalVisible(false)} style={styles.modalButton}>
                    <Text style={{ color: theme.textSecondary }}>{t('common.cancel')}</Text>
                 </Pressable>
                 <Pressable onPress={handleCreatePlaylist} disabled={creatingPlaylist} style={[styles.modalButton, { backgroundColor: theme.accentPrimary }]}>
                    <Text style={{ color: '#000', fontWeight: '800' }}>{t('common.create')}</Text>
                 </Pressable>
              </View>
           </GlassCard>
        </View>
      </Modal>

      <Modal animationType="fade" transparent visible={playlistMenuMode === 'actions'} onRequestClose={closePlaylistModals}>
        <View style={styles.modalBackdrop}>
           <GlassCard style={styles.sheetCard}>
              <Text style={[styles.sheetTitle, { color: theme.textPrimary }]}>{selectedPlaylist?.name}</Text>
              <Pressable onPress={handleTogglePin} style={styles.sheetAction}>
                 <Ionicons name="pin-outline" size={20} color={theme.textPrimary} />
                 <Text style={[styles.sheetActionLabel, { color: theme.textPrimary }]}>{selectedPlaylist?.is_pinned ? t('actions.unpin') : t('actions.pin')}</Text>
              </Pressable>
              <Pressable onPress={handleDelete} style={styles.sheetAction}>
                 <Ionicons name="trash-outline" size={20} color={theme.danger} />
                 <Text style={[styles.sheetActionLabel, { color: theme.danger }]}>{t('actions.delete')}</Text>
              </Pressable>
              <Pressable onPress={closePlaylistModals} style={styles.sheetClose}>
                 <Text style={{ color: theme.textSecondary }}>{t('common.close')}</Text>
              </Pressable>
           </GlassCard>
        </View>
      </Modal>
    </LiquidBackground>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  listContent: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 100 },
  header: { marginBottom: 20 },
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  eyebrow: { fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1.2 },
  title: { fontSize: 32, fontWeight: '900' },
  refreshButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  actionsCard: { padding: 12, marginBottom: 24 },
  actionsScroll: { gap: 12 },
  actionItem: { alignItems: 'center', width: 90, gap: 8 },
  actionIcon: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  actionLabel: { fontSize: 11, fontWeight: '700', color: '#FFF' },
  sectionTitle: { fontSize: 18, fontWeight: '800', marginBottom: 12 },
  playlistRow: { gap: 14, marginBottom: 14 },
  playlistShell: { flex: 1 },
  playlistCard: { borderRadius: 16 },
  playlistArtwork: { aspectRatio: 1, position: 'relative', overflow: 'hidden' },
  playlistThumbnail: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
  playlistBadges: { position: 'absolute', top: 8, left: 8, zIndex: 10 },
  pinBadge: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  playlistGradient: { position: 'absolute', bottom: 0, left: 0, right: 0, height: '50%' },
  playlistInfo: { position: 'absolute', bottom: 10, left: 10, right: 10 },
  playlistTitle: { color: '#FFF', fontSize: 14, fontWeight: '800' },
  playlistCount: { color: 'rgba(255,255,255,0.6)', fontSize: 11, fontWeight: '600' },
  playlistMenuButton: { position: 'absolute', top: 8, right: 4, padding: 4 },
  emptyState: { alignItems: 'center', justifyContent: 'center', marginTop: 60, gap: 12 },
  emptyText: { fontSize: 16, fontWeight: '600' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  modalCard: { width: '100%', padding: 20, gap: 16 },
  modalTitle: { fontSize: 20, fontWeight: '900' },
  input: { minHeight: 50, borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, fontSize: 15 },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12 },
  modalButton: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10 },
  sheetCard: { width: '100%', padding: 20, gap: 12 },
  sheetTitle: { fontSize: 18, fontWeight: '800', marginBottom: 8 },
  sheetAction: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  sheetActionLabel: { fontSize: 16, fontWeight: '600' },
  sheetClose: { marginTop: 8, paddingVertical: 10, alignItems: 'center' },
});
