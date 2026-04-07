import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';

import { apiRequest } from '@/src/services/backend-api';
import {
  DEFAULT_PLAYLIST_ICON,
  getVideoById,
  initializeDatabase,
  upsertRemoteEpisode,
  updateVideoDownloadState,
  type VideoRow,
} from '@/src/db/database';
import { useDatabaseContext } from '@/src/db/db-context';
import i18n from '@/src/i18n';

type DownloadState = {
  videoId: number;
  status: string;
  progress: number;
};

type DownloadRequest = {
  externalId: string;
  remoteUrl: string;
  headers?: Record<string, string>;
  seriesTitle: string;
  filename: string;
  episodeNumber?: number | null;
  thumbnailUri?: string | null;
  playlistIcon?: string | null;
};

type DownloadContextValue = {
  activeDownloads: Record<string, DownloadState>;
  downloadEpisode: (request: DownloadRequest) => Promise<VideoRow>;
  getDownloadState: (key: string) => DownloadState | null;
};

const DownloadContext = createContext<DownloadContextValue | null>(null);
const DOWNLOAD_DIRECTORY = `${FileSystem.documentDirectory ?? ''}downloads/`;

function sanitizeSegment(value: string) {
  const normalized = value
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized || `episode-${Date.now()}.mp4`;
}

export function DownloadProvider({ children }: { children: ReactNode }) {
  const db = useDatabaseContext();
  const [activeDownloads, setActiveDownloads] = useState<Record<string, DownloadState>>({});
  const lastPersistRef = useRef<Record<string, number>>({});

  const getDownloadState = useCallback((key: string) => activeDownloads[key] ?? null, [activeDownloads]);

  const downloadEpisode = useCallback(async (request: DownloadRequest) => {
    await initializeDatabase(db);

    const video = await upsertRemoteEpisode(db, {
      externalId: request.externalId,
      remoteUrl: request.remoteUrl,
      seriesTitle: request.seriesTitle,
      filename: request.filename,
      episodeNumber: request.episodeNumber ?? null,
      thumbnailUri: request.thumbnailUri ?? null,
      playlistIcon: request.playlistIcon?.trim() || DEFAULT_PLAYLIST_ICON,
    });

    if (video.download_status === 'downloaded' && video.uri) {
      return video;
    }

    if (Platform.OS === 'web') {
      throw new Error(i18n.t('downloads.webUnavailable'));
    }

    await FileSystem.makeDirectoryAsync(DOWNLOAD_DIRECTORY, { intermediates: true });

    const safeFilename = sanitizeSegment(request.filename);
    const targetUri = `${DOWNLOAD_DIRECTORY}${Date.now()}-${safeFilename}`;

    // Extract real URL if needed
    let finalUrl = request.remoteUrl;
    if (finalUrl.includes('kodik')) {
      try {
        const extractRes = await apiRequest<{ ok: boolean; direct_url: string }>('/api/media/download/extract', {
           method: 'POST',
           body: { kodik_link: finalUrl }
        });
        if (extractRes.ok && extractRes.direct_url) {
           finalUrl = extractRes.direct_url;
        }
      } catch (e) {
        console.warn('Failed to extract direct URL, using original link', e);
      }
    }

    await updateVideoDownloadState(db, video.id, {
      downloadStatus: 'queued',
      downloadProgress: 0,
      remoteUrl: request.remoteUrl,
    });

    setActiveDownloads((current) => ({
      ...current,
      [request.externalId]: {
        videoId: video.id,
        status: 'queued',
        progress: 0,
      },
    }));

    const resumable = FileSystem.createDownloadResumable(
      finalUrl,
      targetUri,
      {
        headers: request.headers,
      },
      (progressEvent) => {
        const total = progressEvent.totalBytesExpectedToWrite || 0;
        const written = progressEvent.totalBytesWritten || 0;
        const progress = total > 0 ? written / total : 0;

        setActiveDownloads((current) => ({
          ...current,
          [request.externalId]: {
            videoId: video.id,
            status: 'downloading',
            progress,
          },
        }));

        const now = Date.now();
        if (!lastPersistRef.current[request.externalId] || now - lastPersistRef.current[request.externalId] >= 700) {
          lastPersistRef.current[request.externalId] = now;
          void updateVideoDownloadState(db, video.id, {
            downloadStatus: 'downloading',
            downloadProgress: progress,
            remoteUrl: request.remoteUrl,
          });
        }
      }
    );

    try {
      const result = await resumable.downloadAsync();
      const localUri = result?.uri ?? targetUri;

      await updateVideoDownloadState(db, video.id, {
        uri: localUri,
        remoteUrl: request.remoteUrl,
        downloadStatus: 'downloaded',
        downloadProgress: 1,
      });

      setActiveDownloads((current) => ({
        ...current,
        [request.externalId]: {
          videoId: video.id,
          status: 'downloaded',
          progress: 1,
        },
      }));
    } catch (error) {
      await FileSystem.deleteAsync(targetUri, { idempotent: true }).catch(() => undefined);
      await updateVideoDownloadState(db, video.id, {
        remoteUrl: request.remoteUrl,
        downloadStatus: 'failed',
        downloadProgress: 0,
      });

      setActiveDownloads((current) => ({
        ...current,
        [request.externalId]: {
          videoId: video.id,
          status: 'failed',
          progress: 0,
        },
      }));

      throw error;
    }

    return (await getVideoById(db, video.id)) as VideoRow;
  }, [db]);

  const value = useMemo<DownloadContextValue>(() => ({
    activeDownloads,
    downloadEpisode,
    getDownloadState,
  }), [activeDownloads, downloadEpisode, getDownloadState]);

  return <DownloadContext.Provider value={value}>{children}</DownloadContext.Provider>;
}

export function useDownloads() {
  const context = useContext(DownloadContext);

  if (!context) {
    throw new Error('useDownloads must be used inside DownloadProvider.');
  }

  return context;
}
