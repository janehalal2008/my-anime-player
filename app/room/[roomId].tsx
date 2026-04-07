import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ListRenderItemInfo,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  FullscreenPlayer,
  type PlaybackSyncCommand,
  type PlayableMedia,
} from '@/src/components/player/fullscreen-player';
import { GlassCard } from '@/src/components/ui/glass-card';
import { LiquidBackground } from '@/src/components/ui/liquid-background';
import { useApp } from '@/src/providers/app-provider';
import { useAuth } from '@/src/providers/auth-provider';
import { createAuthenticatedSocket, type RealtimeSocket } from '@/src/services/realtime';

type RoomMedia = {
  uri: string;
  title?: string;
  subtitle?: string;
  headers?: Record<string, string>;
};

type RoomState = {
  roomId: string;
  media: RoomMedia | null;
  currentTime: number;
  isPlaying: boolean;
  updatedAt?: string;
  updatedBy?: {
    username?: string;
    role?: string;
    rank?: string;
  };
};

type ActivityItem = {
  id: string;
  text: string;
};

type RoomMessage = {
  id: string;
  roomId: string;
  userId: string | null;
  username: string;
  text: string;
  isGuest: boolean;
  createdAt: string;
};

function formatRoomActivity(text: string) {
  return {
    id: `activity-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    text,
  };
}

function parseHeaders(raw: string | string[] | undefined) {
  const serialized = Array.isArray(raw) ? raw[0] : raw;
  if (!serialized) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(serialized) as Record<string, string>;
    return parsed && typeof parsed === 'object' ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function formatTime(value: string) {
  const date = new Date(value);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export default function RoomScreen() {
  const { theme } = useApp();
  const { token, user } = useAuth();
  const params = useLocalSearchParams<{
    roomId?: string | string[];
    mediaUri?: string | string[];
    mediaTitle?: string | string[];
    mediaSubtitle?: string | string[];
    mediaHeaders?: string | string[];
  }>();
  const roomId = Array.isArray(params.roomId) ? params.roomId[0] : params.roomId;
  const initialMediaUri = Array.isArray(params.mediaUri) ? params.mediaUri[0] : params.mediaUri;
  const initialMediaTitle = Array.isArray(params.mediaTitle) ? params.mediaTitle[0] : params.mediaTitle;
  const initialMediaSubtitle = Array.isArray(params.mediaSubtitle) ? params.mediaSubtitle[0] : params.mediaSubtitle;
  const initialMediaHeaders = parseHeaders(params.mediaHeaders);
  const socketRef = useRef<RealtimeSocket | null>(null);
  const initialMediaAppliedRef = useRef(false);
  const skipNextSyncRef = useRef(false);
  const [connected, setConnected] = useState(false);
  const [joining, setJoining] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [syncCommand, setSyncCommand] = useState<PlaybackSyncCommand | null>(null);
  const [urlDraft, setUrlDraft] = useState(initialMediaUri || '');
  const [titleDraft, setTitleDraft] = useState(initialMediaTitle || '');
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [messages, setMessages] = useState<RoomMessage[]>([]);
  const [chatVisible, setChatVisible] = useState(false);
  const [messageDraft, setMessageDraft] = useState('');

  const playableMedia = useMemo<PlayableMedia | null>(() => {
    if (!roomState?.media?.uri) {
      return null;
    }

    return {
      uri: roomState.media.uri,
      headers: roomState.media.headers,
      progress: roomState.currentTime || 0,
    };
  }, [roomState]);

  function pushActivity(text: string) {
    setActivities((current) => [formatRoomActivity(text), ...current].slice(0, 30));
  }

  const emitSetMedia = useCallback(() => {
    const socket = socketRef.current;
    const uri = urlDraft.trim() || initialMediaUri?.trim() || '';

    if (!socket || !roomId || !uri) {
      return;
    }

    setError(null);
    socket.emit(
      'set_media',
      {
        roomId,
        media: {
          uri,
          title: titleDraft.trim() || initialMediaTitle || 'Watch Party',
          subtitle: initialMediaSubtitle || user?.username || 'Atherium',
          headers: initialMediaHeaders,
        },
      },
      (ack: { ok?: boolean; error?: string; state?: RoomState }) => {
        if (!ack?.ok || !ack.state) {
          setError(ack?.error || 'Unable to load this stream in the room.');
          return;
        }

        setRoomState(ack.state);
        setSyncCommand({
          id: `media-${Date.now()}`,
          action: 'pause',
          currentTime: 0,
          isPlaying: false,
        });
        pushActivity(`Медіа завантажено: ${ack.state.media?.title || 'Watch Party'}`);
      }
    );
  }, [
    initialMediaHeaders,
    initialMediaSubtitle,
    initialMediaTitle,
    initialMediaUri,
    roomId,
    titleDraft,
    urlDraft,
    user?.username,
  ]);

  useEffect(() => {
    if (!roomId || !token || user?.isGuest) {
      router.replace('/social');
      return;
    }

    const socket = createAuthenticatedSocket(token);
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      socket.emit(
        'join_room',
        { roomId },
        (ack: { ok?: boolean; error?: string; state?: RoomState | null; messages?: RoomMessage[] }) => {
          if (!ack?.ok) {
            setError(ack?.error || 'Unable to join the room.');
            setJoining(false);
            return;
          }

          if (ack.state) {
            setRoomState(ack.state);
            if (ack.state.media) {
              setSyncCommand({
                id: `initial-${Date.now()}`,
                action: ack.state.isPlaying ? 'play' : 'pause',
                currentTime: ack.state.currentTime || 0,
                isPlaying: ack.state.isPlaying,
              });
            }
          }

          if (Array.isArray(ack.messages)) {
            setMessages(ack.messages);
          }

          setJoining(false);
          pushActivity(`Підключено до кімнати ${roomId}`);

          if (!ack.state?.media && initialMediaUri && !initialMediaAppliedRef.current) {
            initialMediaAppliedRef.current = true;
            emitSetMedia();
          }
        }
      );
    });

    socket.on('disconnect', () => {
      setConnected(false);
    });

    socket.on('user_joined', (payload: { user?: { username?: string } }) => {
      pushActivity(`${payload.user?.username || 'Хтось'} приєднався до кімнати`);
    });

    socket.on('user_left', (payload: { user?: { username?: string } }) => {
      pushActivity(`${payload.user?.username || 'Хтось'} вийшов із кімнати`);
    });

    socket.on('room_state', (nextState: RoomState) => {
      setRoomState(nextState);
      if (nextState.media) {
        setSyncCommand({
          id: `state-${nextState.updatedAt || Date.now()}`,
          action: nextState.isPlaying ? 'play' : 'pause',
          currentTime: nextState.currentTime || 0,
          isPlaying: nextState.isPlaying,
        });
        if (nextState.media.title) {
          setTitleDraft((current) => current || nextState.media?.title || '');
        }
        if (nextState.media.uri) {
          setUrlDraft((current) => current || nextState.media?.uri || '');
        }
      }
    });

    socket.on(
      'player_synced',
      (payload: {
        action: 'play' | 'pause' | 'seek';
        currentTime: number;
        isPlaying: boolean;
        sentAt?: string;
        user?: { username?: string };
      }) => {
        skipNextSyncRef.current = true;
        setSyncCommand({
          id: `sync-${payload.sentAt || Date.now()}`,
          action: payload.action,
          currentTime: payload.currentTime || 0,
          isPlaying: payload.isPlaying,
        });
        if (payload.user?.username) {
          pushActivity(`${payload.user.username}: ${payload.action}`);
        }
      }
    );

    socket.on('room_message', (message: RoomMessage) => {
      setMessages((current) => [...current, message]);
    });

    return () => {
      socket.emit('leave_room', { roomId });
      socket.disconnect();
      if (socketRef.current === socket) {
        socketRef.current = null;
      }
    };
  }, [emitSetMedia, initialMediaSubtitle, initialMediaTitle, initialMediaUri, roomId, token, user?.isGuest]);

  async function handlePlaybackEvent(event: PlaybackSyncCommand) {
    const socket = socketRef.current;
    if (!socket || !roomId || skipNextSyncRef.current) {
      skipNextSyncRef.current = false;
      return;
    }

    socket.emit('sync_player', {
      roomId,
      action: event.action,
      currentTime: event.currentTime,
      isPlaying: event.isPlaying,
    });

    setRoomState((current) =>
      current
        ? {
            ...current,
            currentTime: event.currentTime,
            isPlaying: event.isPlaying,
          }
        : current
    );
  }

  async function sendRoomMessage() {
    const socket = socketRef.current;
    const text = messageDraft.trim();

    if (!socket || !roomId || !text) {
      return;
    }

    socket.emit('room_message', { roomId, text }, (ack: { ok?: boolean; error?: string }) => {
      if (!ack?.ok) {
        setError(ack?.error || 'Unable to send room message.');
        return;
      }
      setMessageDraft('');
    });
  }

  const renderMessage = ({ item }: ListRenderItemInfo<RoomMessage>) => {
    const mine = item.userId && user?.id && item.userId === user.id;

    return (
      <View style={[styles.messageRow, mine ? styles.messageRowMine : styles.messageRowFriend]}>
        <View
          style={[
            styles.messageBubble,
            mine
              ? { backgroundColor: theme.accentPrimary }
              : { backgroundColor: theme.surfaceStrong, borderColor: theme.cardBorder, borderWidth: 1 },
          ]}>
          <Text style={[styles.messageAuthor, { color: mine ? '#05070F' : theme.textPrimary }]}>
            {item.username}
          </Text>
          <Text style={[styles.messageText, { color: mine ? '#05070F' : theme.textPrimary }]}>{item.text}</Text>
          <Text style={[styles.messageTime, { color: mine ? 'rgba(5,7,15,0.7)' : theme.textMuted }]}>
            {formatTime(item.createdAt)}
          </Text>
        </View>
      </View>
    );
  };

  if (joining) {
    return (
      <LiquidBackground>
        <SafeAreaView style={styles.centerState}>
          <ActivityIndicator size="large" color={theme.textPrimary} />
          <Text style={[styles.loadingTitle, { color: theme.textPrimary }]}>Підключення до кімнати…</Text>
        </SafeAreaView>
      </LiquidBackground>
    );
  }

  return (
    <LiquidBackground>
      <SafeAreaView style={styles.safeArea}>
        {playableMedia ? (
          <View style={styles.playerWrap}>
            <FullscreenPlayer
              media={playableMedia}
              autoPlay={roomState?.isPlaying ?? false}
              title={roomState?.media?.title || 'Watch Party'}
              subtitle={roomState?.media?.subtitle || roomId}
              syncCommand={syncCommand}
              onPlaybackEvent={handlePlaybackEvent}
              onPersistProgress={async (snapshot) => {
                setRoomState((current) =>
                  current
                    ? {
                        ...current,
                        currentTime: snapshot.currentTime,
                        isPlaying: snapshot.playing,
                      }
                    : current
                );
              }}
              onClose={() => {
                router.back();
              }}
            />

            <View style={styles.roomHud}>
              <GlassCard style={styles.hudCard}>
                <Text style={[styles.hudTitle, { color: theme.textPrimary }]}>{roomId}</Text>
                <Text style={[styles.hudSubtitle, { color: theme.textSecondary }]}>
                  {connected ? 'Онлайн' : 'Офлайн'} • {messages.length} повідомлень
                </Text>
              </GlassCard>
              <Pressable onPress={() => setChatVisible(true)} style={[styles.chatFab, { backgroundColor: theme.accentPrimary }]}>
                <Ionicons name="chatbubble-ellipses" size={20} color="#05070F" />
              </Pressable>
            </View>
          </View>
        ) : (
          <>
            <View style={styles.header}>
              <Pressable onPress={() => router.back()} style={[styles.headerButton, { borderColor: theme.cardBorder }]}>
                <Ionicons name="chevron-back" size={20} color={theme.textPrimary} />
              </Pressable>
              <View style={styles.headerCopy}>
                <Text style={[styles.title, { color: theme.textPrimary }]}>Спільний перегляд</Text>
                <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
                  {roomId} • {connected ? 'онлайн' : 'офлайн'}
                </Text>
              </View>
              <Pressable onPress={() => setChatVisible(true)} style={[styles.headerButton, { borderColor: theme.cardBorder }]}>
                <Ionicons name="chatbubble-ellipses-outline" size={20} color={theme.textPrimary} />
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={styles.content}>
              <GlassCard style={styles.card}>
                <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>Запустити аніме в кімнаті</Text>
                <Text style={[styles.cardCopy, { color: theme.textSecondary }]}>
                  Якщо ти зайшов із тайтлу, URL уже підтягнувся. Інакше встав `.m3u8` або прямий медіа URL вручну.
                </Text>
                <TextInput
                  value={titleDraft}
                  onChangeText={setTitleDraft}
                  placeholder="Назва тайтлу"
                  placeholderTextColor={theme.textMuted}
                  style={[styles.input, { color: theme.textPrimary, borderColor: theme.cardBorder, backgroundColor: theme.inputBackground }]}
                />
                <TextInput
                  value={urlDraft}
                  onChangeText={setUrlDraft}
                  placeholder="https://example.com/stream.m3u8"
                  placeholderTextColor={theme.textMuted}
                  style={[styles.input, { color: theme.textPrimary, borderColor: theme.cardBorder, backgroundColor: theme.inputBackground }]}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                {error ? <Text style={[styles.errorText, { color: theme.danger }]}>{error}</Text> : null}
                <Pressable onPress={() => emitSetMedia()} style={[styles.primaryButton, { backgroundColor: theme.accentPrimary }]}>
                  <Ionicons name="play" size={18} color="#05070F" />
                  <Text style={styles.primaryButtonLabel}>Запустити для кімнати</Text>
                </Pressable>
              </GlassCard>

              <GlassCard style={styles.card}>
                <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>Активність кімнати</Text>
                <View style={styles.activityStack}>
                  {activities.length > 0 ? (
                    activities.map((item) => (
                      <View key={item.id} style={[styles.activityItem, { borderColor: theme.cardBorder }]}>
                        <Text style={[styles.activityText, { color: theme.textSecondary }]}>{item.text}</Text>
                      </View>
                    ))
                  ) : (
                    <Text style={[styles.cardCopy, { color: theme.textSecondary }]}>
                      Запроси друга, завантаж сюди стрім і відкрий чат. У кімнаті синхронізуються play, pause та seek.
                    </Text>
                  )}
                </View>
              </GlassCard>
            </ScrollView>
          </>
        )}

        <Modal animationType="slide" transparent visible={chatVisible} onRequestClose={() => setChatVisible(false)}>
          <View style={styles.modalBackdrop}>
            <GlassCard style={styles.chatModal}>
              <View style={styles.chatHeader}>
                <View>
                  <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>Чат кімнати</Text>
                  <Text style={[styles.cardCopy, { color: theme.textSecondary }]}>{roomId}</Text>
                </View>
                <Pressable onPress={() => setChatVisible(false)} style={[styles.headerButton, { borderColor: theme.cardBorder }]}>
                  <Ionicons name="close" size={18} color={theme.textPrimary} />
                </Pressable>
              </View>

              <FlatList
                data={messages}
                renderItem={renderMessage}
                keyExtractor={(item) => item.id}
                contentContainerStyle={styles.messagesContent}
                ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
                ListEmptyComponent={
                  <View style={styles.emptyChatWrap}>
                    <Text style={[styles.cardCopy, { color: theme.textSecondary }]}>
                      Тут буде спільний чат під час перегляду.
                    </Text>
                  </View>
                }
              />

              <View style={[styles.chatComposer, { borderColor: theme.cardBorder }]}>
                <TextInput
                  value={messageDraft}
                  onChangeText={setMessageDraft}
                  placeholder="Напиши повідомлення"
                  placeholderTextColor={theme.textMuted}
                  style={[styles.chatInput, { color: theme.textPrimary }]}
                  onSubmitEditing={() => {
                    void sendRoomMessage();
                  }}
                  returnKeyType="send"
                />
                <Pressable onPress={() => { void sendRoomMessage(); }} style={[styles.sendButton, { backgroundColor: theme.accentPrimary }]}>
                  <Ionicons name="send" size={18} color="#05070F" />
                </Pressable>
              </View>
            </GlassCard>
          </View>
        </Modal>
      </SafeAreaView>
    </LiquidBackground>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  centerState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingTitle: { fontSize: 18, fontWeight: '800' },
  playerWrap: { flex: 1 },
  roomHud: {
    position: 'absolute',
    top: 24,
    right: 16,
    left: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    pointerEvents: 'box-none',
  },
  hudCard: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 4,
  },
  hudTitle: { fontSize: 14, fontWeight: '900' },
  hudSubtitle: { fontSize: 12, fontWeight: '600' },
  chatFab: {
    width: 52,
    height: 52,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    paddingHorizontal: 18,
    paddingTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  headerCopy: { flex: 1 },
  title: { fontSize: 20, fontWeight: '900' },
  subtitle: { marginTop: 4, fontSize: 12, fontWeight: '600' },
  content: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 120, gap: 14 },
  card: { padding: 18, gap: 12 },
  cardTitle: { fontSize: 18, fontWeight: '900' },
  cardCopy: { fontSize: 14, lineHeight: 20 },
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
    flexDirection: 'row',
    gap: 10,
  },
  primaryButtonLabel: { color: '#05070F', fontSize: 15, fontWeight: '900' },
  activityStack: { gap: 10 },
  activityItem: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  activityText: { fontSize: 13, lineHeight: 18 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(2,6,23,0.55)',
    justifyContent: 'flex-end',
    padding: 12,
  },
  chatModal: {
    maxHeight: '70%',
    padding: 14,
    gap: 12,
  },
  chatHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  messagesContent: {
    paddingVertical: 8,
    flexGrow: 1,
  },
  messageRow: { width: '100%' },
  messageRowMine: { alignItems: 'flex-end' },
  messageRowFriend: { alignItems: 'flex-start' },
  messageBubble: {
    maxWidth: '84%',
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  messageAuthor: { fontSize: 12, fontWeight: '900' },
  messageText: { marginTop: 4, fontSize: 14, lineHeight: 19 },
  messageTime: { marginTop: 6, fontSize: 11, fontWeight: '700', alignSelf: 'flex-end' },
  emptyChatWrap: { paddingVertical: 20, alignItems: 'center' },
  chatComposer: {
    borderTopWidth: 1,
    paddingTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  chatInput: {
    flex: 1,
    minHeight: 44,
    fontSize: 14,
    paddingHorizontal: 8,
  },
  sendButton: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
