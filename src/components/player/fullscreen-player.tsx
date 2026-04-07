import { MaterialIcons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  GestureResponderEvent,
  LayoutChangeEvent,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useVideoPlayer, VideoView, type VideoPlayer } from 'expo-video';

import { useApp } from '@/src/providers/app-provider';

export type PlayableMedia = {
  uri: string;
  progress?: number;
  duration?: number;
  headers?: Record<string, string>;
};

export type PlaybackSyncCommand = {
  id: string;
  action: 'play' | 'pause' | 'seek';
  currentTime: number;
  isPlaying: boolean;
};

type PlayerSnapshot = {
  currentTime: number;
  duration: number;
  playing: boolean;
};

type FullscreenPlayerProps = {
  media: PlayableMedia;
  title?: string;
  subtitle?: string;
  autoPlay?: boolean;
  onClose: () => Promise<void> | void;
  onPersistProgress?: (snapshot: PlayerSnapshot) => Promise<void> | void;
  onFinished?: () => Promise<void> | void;
  syncCommand?: PlaybackSyncCommand | null;
  onPlaybackEvent?: (event: PlaybackSyncCommand) => Promise<void> | void;
};

const PLAYER_RED = '#FF0000';

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

function readSnapshot(player: VideoPlayer): PlayerSnapshot | null {
  try {
    return {
      currentTime: Number.isFinite(player.currentTime) ? player.currentTime : 0,
      duration: Number.isFinite(player.duration) ? player.duration : 0,
      playing: player.playing,
    };
  } catch {
    return null;
  }
}

export function normalizePlayableUri(uri: string) {
  if (!uri) {
    return uri;
  }

  if (
    uri.startsWith('file://') ||
    uri.startsWith('http://') ||
    uri.startsWith('https://') ||
    uri.startsWith('content://') ||
    uri.startsWith('blob:')
  ) {
    return uri;
  }

  return `file://${uri}`;
}

function PlayerErrorState({
  message,
  onClose,
}: {
  message: string;
  onClose: () => Promise<void> | void;
}) {
  const { theme } = useApp();
  const { t } = useTranslation();

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.errorCard}>
          <Text style={[styles.errorTitle, { color: theme.textPrimary }]}>{t('player.errorTitle')}</Text>
          <Text style={[styles.errorCopy, { color: theme.textSecondary }]}>{message}</Text>
          <Pressable onPress={() => { void onClose(); }} style={styles.errorButton}>
            <Text style={[styles.errorButtonLabel, { color: theme.textPrimary }]}>{t('player.back')}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}

export function FullscreenPlayer(props: FullscreenPlayerProps) {
  const { t } = useTranslation();
  const playableUri = useMemo(() => normalizePlayableUri(props.media.uri), [props.media.uri]);

  if (!playableUri || playableUri.trim() === '') {
    return <PlayerErrorState message={t('player.emptyUrl')} onClose={props.onClose} />;
  }

  return <FullscreenPlayerContent {...props} media={{ ...props.media, uri: playableUri }} />;
}

function FullscreenPlayerContent({
  media,
  title,
  subtitle,
  autoPlay = true,
  onClose,
  onPersistProgress,
  onFinished,
  syncCommand,
  onPlaybackEvent,
}: FullscreenPlayerProps) {
  const { theme } = useApp();
  const { t } = useTranslation();
  const [position, setPosition] = useState(media.progress ?? 0);
  const [duration, setDuration] = useState(media.duration ?? 0);
  const [isPlaying, setIsPlaying] = useState(autoPlay);
  const [showControls, setShowControls] = useState(true);
  const [skipFeedback, setSkipFeedback] = useState<string | null>(null);
  const controlsOpacity = useSharedValue(1);
  const feedbackOpacity = useSharedValue(0);
  const controlsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const feedbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPersistAtRef = useRef(0);
  const progressTrackWidthRef = useRef(1);
  const finishedRef = useRef(false);
  const lastAppliedSyncIdRef = useRef<string | null>(null);
  const playableUri = useMemo(() => normalizePlayableUri(media.uri), [media.uri]);

  const overlayStyle = useAnimatedStyle(() => ({
    opacity: controlsOpacity.value,
  }));

  const feedbackStyle = useAnimatedStyle(() => ({
    opacity: feedbackOpacity.value,
  }));

  const player = useVideoPlayer(
    {
      uri: playableUri,
      headers: media.headers,
      contentType: playableUri.includes('.m3u8') ? 'hls' : 'auto',
      metadata: {
        title,
        artist: subtitle,
      },
    },
    (videoPlayer) => {
      videoPlayer.staysActiveInBackground = true;
      videoPlayer.currentTime = media.progress ?? 0;
      if (autoPlay) {
        videoPlayer.play();
      } else {
        videoPlayer.pause();
      }
    }
  );

  useEffect(() => {
    const subscription = player.addListener('statusChange', (event) => {
      if (event.status === 'error' || event.error) {
        console.error('Video playback error:', {
          uri: playableUri,
          error: event.error,
          status: event.status,
        });
      }
    });

    return () => {
      subscription.remove();
    };
  }, [playableUri, player]);

  const persistSnapshot = useCallback(
    async (snapshot: PlayerSnapshot) => {
      if (!onPersistProgress) {
        return;
      }

      await onPersistProgress(snapshot);
    },
    [onPersistProgress]
  );

  const emitPlaybackEvent = useCallback(
    (action: PlaybackSyncCommand['action'], currentTime: number, nextIsPlaying: boolean) => {
      if (!onPlaybackEvent) {
        return;
      }

      void onPlaybackEvent({
        id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        action,
        currentTime,
        isPlaying: nextIsPlaying,
      });
    },
    [onPlaybackEvent]
  );

  const clearHideTimer = useCallback(() => {
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
      controlsTimeoutRef.current = null;
    }
  }, []);

  const scheduleAutoHide = useCallback(() => {
    clearHideTimer();
    controlsTimeoutRef.current = setTimeout(() => {
      controlsOpacity.value = withTiming(0, { duration: 220 }, (finished) => {
        if (finished) {
          runOnJS(setShowControls)(false);
        }
      });
    }, 3000);
  }, [clearHideTimer, controlsOpacity]);

  const revealControls = useCallback(() => {
    setShowControls(true);
    controlsOpacity.value = withTiming(1, { duration: 180 });
    scheduleAutoHide();
  }, [controlsOpacity, scheduleAutoHide]);

  const hideControls = useCallback(() => {
    clearHideTimer();
    controlsOpacity.value = withTiming(0, { duration: 220 }, (finished) => {
      if (finished) {
        runOnJS(setShowControls)(false);
      }
    });
  }, [clearHideTimer, controlsOpacity]);

  useEffect(() => {
    revealControls();

    return () => {
      clearHideTimer();
      if (feedbackTimeoutRef.current) {
        clearTimeout(feedbackTimeoutRef.current);
      }
    };
  }, [clearHideTimer, revealControls]);

  useEffect(() => {
    const interval = setInterval(() => {
      const snapshot = readSnapshot(player);
      if (!snapshot) {
        return;
      }

      setPosition(snapshot.currentTime);
      setDuration(snapshot.duration);
      setIsPlaying(snapshot.playing);

      if (Date.now() - lastPersistAtRef.current >= 5000) {
        lastPersistAtRef.current = Date.now();
        void persistSnapshot(snapshot);
      }
    }, 1000);

    return () => {
      clearInterval(interval);
    };
  }, [persistSnapshot, player]);

  useEffect(() => {
    if (!syncCommand || syncCommand.id === lastAppliedSyncIdRef.current) {
      return;
    }

    lastAppliedSyncIdRef.current = syncCommand.id;

    try {
      player.currentTime = syncCommand.currentTime;
    } catch {
      // Ignore sync jitter and continue.
    }

    setPosition(syncCommand.currentTime);

    if (syncCommand.action === 'pause' || !syncCommand.isPlaying) {
      player.pause();
      setIsPlaying(false);
    } else {
      player.play();
      setIsPlaying(true);
    }

    revealControls();
  }, [player, revealControls, syncCommand]);

  useEffect(() => {
    if (finishedRef.current || duration <= 0) {
      return;
    }

    if (position >= Math.max(duration - 0.5, 0.5)) {
      finishedRef.current = true;
      const snapshot = readSnapshot(player) ?? {
        currentTime: duration,
        duration,
        playing: false,
      };
      void persistSnapshot(snapshot);
      void onFinished?.();
    }
  }, [duration, onFinished, persistSnapshot, player, position]);

  const showTransientFeedback = useCallback(
    (label: string) => {
      if (feedbackTimeoutRef.current) {
        clearTimeout(feedbackTimeoutRef.current);
      }

      setSkipFeedback(label);
      feedbackOpacity.value = withTiming(1, { duration: 120 });

      feedbackTimeoutRef.current = setTimeout(() => {
        feedbackOpacity.value = withTiming(0, { duration: 180 });
        setSkipFeedback(null);
      }, 700);
    },
    [feedbackOpacity]
  );

  const handleScreenPress = useCallback(() => {
    if (showControls) {
      hideControls();
      return;
    }

    revealControls();
  }, [hideControls, revealControls, showControls]);

  const handleSeekBy = useCallback(
    (seconds: number) => {
      let nextPosition = 0;

      try {
        player.seekBy(seconds);
      } catch {
        const nextTime = Math.max(0, (player.currentTime || 0) + seconds);
        player.currentTime = nextTime;
      }

      setPosition((current) => {
        const nextTime = current + seconds;
        if (duration > 0) {
          nextPosition = Math.max(0, Math.min(duration, nextTime));
          return nextPosition;
        }

        nextPosition = Math.max(0, nextTime);
        return nextPosition;
      });

      revealControls();
      showTransientFeedback(`${seconds > 0 ? '+' : ''}${seconds}s`);
      emitPlaybackEvent('seek', nextPosition, isPlaying);
    },
    [duration, emitPlaybackEvent, isPlaying, player, revealControls, showTransientFeedback]
  );

  const togglePlayback = useCallback(() => {
    if (isPlaying) {
      player.pause();
      setIsPlaying(false);
      emitPlaybackEvent('pause', Number.isFinite(player.currentTime) ? player.currentTime : position, false);
    } else {
      player.play();
      setIsPlaying(true);
      emitPlaybackEvent('play', Number.isFinite(player.currentTime) ? player.currentTime : position, true);
    }

    revealControls();
  }, [emitPlaybackEvent, isPlaying, player, position, revealControls]);

  const handleClose = useCallback(async () => {
    const snapshot = readSnapshot(player);
    if (snapshot) {
      await persistSnapshot(snapshot);
    }

    await onClose();
  }, [onClose, persistSnapshot, player]);

  const handleProgressTrackLayout = useCallback((event: LayoutChangeEvent) => {
    progressTrackWidthRef.current = Math.max(event.nativeEvent.layout.width, 1);
  }, []);

  const seekToRatio = useCallback(
    (nextRatio: number) => {
      if (!duration || duration <= 0) {
        return;
      }

      const safeRatio = Math.max(0, Math.min(nextRatio, 1));
      const nextTime = duration * safeRatio;
      player.currentTime = nextTime;
      setPosition(nextTime);
      revealControls();
      emitPlaybackEvent('seek', nextTime, isPlaying);
    },
    [duration, emitPlaybackEvent, isPlaying, player, revealControls]
  );

  const handleProgressTrackPress = useCallback(
    (event: GestureResponderEvent) => {
      const ratio = event.nativeEvent.locationX / progressTrackWidthRef.current;
      seekToRatio(ratio);
    },
    [seekToRatio]
  );

  useEffect(() => {
    if (Platform.OS !== 'web') {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase?.() || '';
      if (tagName === 'input' || tagName === 'textarea') {
        return;
      }

      if (event.code === 'Space') {
        event.preventDefault();
        togglePlayback();
        return;
      }

      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        handleSeekBy(-15);
        return;
      }

      if (event.key === 'ArrowRight') {
        event.preventDefault();
        handleSeekBy(15);
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        void handleClose();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleClose, handleSeekBy, togglePlayback]);

  const progressRatio = duration > 0 ? Math.max(0, Math.min(position / duration, 1)) : 0;

  return (
    <View style={styles.root}>
      <VideoView
        style={styles.video}
        player={player}
        nativeControls={false}
        contentFit="contain"
      />

      <Pressable onPress={handleScreenPress} style={StyleSheet.absoluteFill} />

      {skipFeedback ? (
        <Animated.View pointerEvents="none" style={[styles.feedbackBubble, feedbackStyle]}>
          <Text style={styles.feedbackText}>{skipFeedback}</Text>
        </Animated.View>
      ) : null}

      <Animated.View pointerEvents={showControls ? 'box-none' : 'none'} style={[styles.overlay, overlayStyle]}>
        <SafeAreaView style={styles.safeArea} pointerEvents="box-none">
          <View style={styles.topBar}>
            <Pressable onPress={() => { void handleClose(); }} style={styles.topButton}>
              <MaterialIcons name="arrow-back" size={22} color={theme.textPrimary} />
            </Pressable>

            <View style={styles.topCopy}>
              {title ? (
                <Text style={[styles.title, { color: theme.textPrimary }]} numberOfLines={1}>
                  {title}
                </Text>
              ) : null}
              {subtitle ? (
                <Text style={[styles.subtitle, { color: theme.textSecondary }]} numberOfLines={1}>
                  {subtitle}
                </Text>
              ) : null}
            </View>

            <Pressable style={styles.hostButton}>
              <MaterialIcons name="groups" size={20} color={theme.textPrimary} />
              <Text style={[styles.hostButtonLabel, { color: theme.textPrimary }]}>{t('player.cowatch', { defaultValue: 'Co-watch' })}</Text>
            </Pressable>
          </View>

          <View style={styles.centerControls}>
            <Pressable onPress={() => { handleSeekBy(-15); }} style={styles.skipButton}>
              <MaterialIcons name="replay-10" size={28} color="#FFFFFF" />
              <Text style={styles.skipLabel}>15</Text>
            </Pressable>

            <Pressable onPress={togglePlayback} style={styles.playButton}>
              <MaterialIcons name={isPlaying ? 'pause' : 'play-arrow'} size={40} color="#FFFFFF" />
            </Pressable>

            <Pressable onPress={() => { handleSeekBy(15); }} style={styles.skipButton}>
              <MaterialIcons name="forward-10" size={28} color="#FFFFFF" />
              <Text style={styles.skipLabel}>15</Text>
            </Pressable>
          </View>

          <View style={styles.bottomDock}>
            <View style={styles.timeRow}>
              <Text style={[styles.timeText, { color: theme.textPrimary }]}>{formatClock(position)}</Text>
              <Text style={[styles.timeText, { color: theme.textPrimary }]}>{formatClock(duration)}</Text>
            </View>

            <View
              onLayout={handleProgressTrackLayout}
              onStartShouldSetResponder={() => true}
              onMoveShouldSetResponder={() => true}
              onResponderGrant={handleProgressTrackPress}
              onResponderMove={handleProgressTrackPress}
              style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${progressRatio * 100}%` }]} />
              <View style={[styles.progressThumb, { left: `${progressRatio * 100}%` }]} />
            </View>
          </View>
        </SafeAreaView>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000000',
  },
  errorCard: {
    margin: 24,
    marginTop: 'auto',
    marginBottom: 'auto',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(10,10,12,0.78)',
    padding: 20,
    gap: 10,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: '800',
  },
  errorCopy: {
    fontSize: 14,
    lineHeight: 20,
  },
  errorButton: {
    marginTop: 6,
    alignSelf: 'flex-start',
    minHeight: 42,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorButtonLabel: {
    fontSize: 14,
    fontWeight: '800',
  },
  video: {
    flex: 1,
    backgroundColor: '#000000',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  safeArea: {
    flex: 1,
    justifyContent: 'space-between',
  },
  topBar: {
    paddingHorizontal: 16,
    paddingTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  topButton: {
    width: 42,
    height: 42,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  topCopy: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 16,
    fontWeight: '800',
  },
  subtitle: {
    marginTop: 4,
    fontSize: 12,
    fontWeight: '600',
  },
  hostButton: {
    minHeight: 42,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  hostButtonLabel: {
    fontSize: 12,
    fontWeight: '800',
  },
  centerControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24,
  },
  skipButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  skipLabel: {
    marginTop: 2,
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  playButton: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomDock: {
    paddingHorizontal: 14,
    paddingBottom: 8,
  },
  timeRow: {
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  timeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  progressTrack: {
    height: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: PLAYER_RED,
  },
  progressThumb: {
    position: 'absolute',
    top: -4,
    width: 10,
    height: 10,
    borderRadius: 5,
    marginLeft: -5,
    backgroundColor: PLAYER_RED,
  },
  feedbackBubble: {
    position: 'absolute',
    top: '18%',
    alignSelf: 'center',
    minWidth: 88,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.66)',
    alignItems: 'center',
  },
  feedbackText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
});
