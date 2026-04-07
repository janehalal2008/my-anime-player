import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState, type AppStateStatus, Platform } from 'react-native';

import i18n from '@/src/i18n';
import { useAuth } from '@/src/providers/auth-provider';
import { apiRequest } from '@/src/services/backend-api';
import { createAuthenticatedSocket, type RealtimeSocket } from '@/src/services/realtime';

export type SocialFriend = {
  id: string;
  userId: string;
  name: string;
  handle: string;
  email?: string | null;
  avatarSeed?: string;
  rank?: string;
  role?: string;
  status: 'online' | 'offline' | 'away';
  invitedToRoom: boolean;
  createdAt: string;
};

export type SocialFriendRequest = {
  id: string;
  direction: 'incoming' | 'outgoing';
  status: string;
  createdAt: string;
  user: SocialFriend;
};

export type SocialRoomInvite = {
  id: string;
  roomId: string;
  direction: 'incoming' | 'outgoing';
  status: string;
  createdAt: string;
  user: SocialFriend;
};

export type SocialPublicProfile = {
  user: {
    id: string;
    username: string;
    email: string | null;
    role: string;
    rank: string;
    avatarSeed: string;
    createdAt: string;
    isGuest: boolean;
    status: 'online' | 'offline' | 'away';
    stats: {
      friends: number;
      messages: number;
    };
  };
  relationship: 'self' | 'friend' | 'incoming_request' | 'outgoing_request' | 'none';
};

export type ChatMessage = {
  id: string;
  chatId: string;
  sender: 'me' | 'friend';
  text: string;
  createdAt: string;
};

export type ChatThread = {
  id: string;
  friendId: string;
  lastMessageAt: string;
  friend?: SocialFriend;
};

type SocialContextValue = {
  ready: boolean;
  friends: SocialFriend[];
  incomingRequests: SocialFriendRequest[];
  outgoingRequests: SocialFriendRequest[];
  incomingRoomInvites: SocialRoomInvite[];
  outgoingRoomInvites: SocialRoomInvite[];
  chats: ChatThread[];
  messagesByChatId: Record<string, ChatMessage[]>;
  refreshSocial: (options?: { silent?: boolean }) => Promise<void>;
  addFriend: (query: string) => Promise<SocialFriendRequest | null>;
  acceptFriendRequest: (requestId: string) => Promise<void>;
  declineFriendRequest: (requestId: string) => Promise<void>;
  inviteToRoom: (friendId: string, roomId?: string) => Promise<SocialRoomInvite | null>;
  clearInvite: (friendId: string) => Promise<void>;
  acceptRoomInvite: (inviteId: string) => Promise<{ roomId: string }>;
  declineRoomInvite: (inviteId: string) => Promise<void>;
  getOrCreateChat: (friendId: string) => Promise<ChatThread>;
  loadMessages: (chatId: string) => Promise<ChatMessage[]>;
  sendMessage: (chatId: string, text: string) => Promise<void>;
  getPublicProfile: (userId: string) => Promise<SocialPublicProfile>;
};

const SocialContext = createContext<SocialContextValue | null>(null);

type FriendsResponse = {
  friends: SocialFriend[];
  incomingRequests?: SocialFriendRequest[];
  outgoingRequests?: SocialFriendRequest[];
  incomingRoomInvites?: SocialRoomInvite[];
  outgoingRoomInvites?: SocialRoomInvite[];
};

type ChatsResponse = {
  chats: ChatThread[];
};

type MessagesResponse = {
  messages: ChatMessage[];
};

function sortFriends(items: SocialFriend[]) {
  return [...items].sort((left, right) => {
    const statusPriority = { online: 0, away: 1, offline: 2 };
    if (statusPriority[left.status] !== statusPriority[right.status]) {
      return statusPriority[left.status] - statusPriority[right.status];
    }

    return left.name.localeCompare(right.name);
  });
}

function sortRequests(items: SocialFriendRequest[]) {
  return [...items].sort(
    (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
  );
}

function sortInvites(items: SocialRoomInvite[]) {
  return [...items].sort(
    (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
  );
}

function sortChats(items: ChatThread[]) {
  return [...items].sort(
    (left, right) => new Date(right.lastMessageAt).getTime() - new Date(left.lastMessageAt).getTime()
  );
}

function normalizeFriend(friend: SocialFriend): SocialFriend {
  return {
    ...friend,
    id: String(friend.id),
    userId: String(friend.userId || friend.id),
    invitedToRoom: Boolean(friend.invitedToRoom),
  };
}

function normalizeRequest(request: SocialFriendRequest): SocialFriendRequest {
  return {
    ...request,
    id: String(request.id),
    user: normalizeFriend(request.user),
  };
}

function normalizeRoomInvite(invite: SocialRoomInvite): SocialRoomInvite {
  return {
    ...invite,
    id: String(invite.id),
    roomId: String(invite.roomId),
    user: normalizeFriend(invite.user),
  };
}

function normalizeChat(chat: ChatThread): ChatThread {
  return {
    ...chat,
    id: String(chat.id),
    friendId: String(chat.friendId),
    friend: chat.friend ? normalizeFriend(chat.friend) : undefined,
  };
}

function normalizeMessage(message: ChatMessage): ChatMessage {
  return {
    ...message,
    id: String(message.id),
    chatId: String(message.chatId),
  };
}

function normalizePublicProfile(payload: SocialPublicProfile): SocialPublicProfile {
  return {
    relationship: payload.relationship,
    user: {
      id: String(payload.user.id),
      username: payload.user.username,
      email: payload.user.email,
      role: payload.user.role,
      rank: payload.user.rank,
      avatarSeed: payload.user.avatarSeed,
      createdAt: payload.user.createdAt,
      isGuest: payload.user.isGuest,
      status: payload.user.status,
      stats: {
        friends: Number(payload.user.stats?.friends || 0),
        messages: Number(payload.user.stats?.messages || 0),
      },
    },
  };
}

export function SocialProvider({ children }: { children: ReactNode }) {
  const { token, user } = useAuth();
  const [ready, setReady] = useState(false);
  const [friends, setFriends] = useState<SocialFriend[]>([]);
  const [incomingRequests, setIncomingRequests] = useState<SocialFriendRequest[]>([]);
  const [outgoingRequests, setOutgoingRequests] = useState<SocialFriendRequest[]>([]);
  const [incomingRoomInvites, setIncomingRoomInvites] = useState<SocialRoomInvite[]>([]);
  const [outgoingRoomInvites, setOutgoingRoomInvites] = useState<SocialRoomInvite[]>([]);
  const [chats, setChats] = useState<ChatThread[]>([]);
  const [messagesByChatId, setMessagesByChatId] = useState<Record<string, ChatMessage[]>>({});
  const socketRef = useRef<RealtimeSocket | null>(null);

  const refreshSocial = useCallback(async (options?: { silent?: boolean }) => {
    if (!token || user?.isGuest) {
      setFriends([]);
      setIncomingRequests([]);
      setOutgoingRequests([]);
      setIncomingRoomInvites([]);
      setOutgoingRoomInvites([]);
      setChats([]);
      setMessagesByChatId({});
      setReady(true);
      return;
    }

    if (!options?.silent) {
      setReady(false);
    }

    try {
      const [friendsResponse, chatsResponse] = await Promise.all([
        apiRequest<FriendsResponse>('/api/social/friends', { token }),
        apiRequest<ChatsResponse>('/api/social/chats', { token }),
      ]);

      const normalizedFriends = sortFriends((friendsResponse.friends || []).map(normalizeFriend));
      const friendsById = new Map(normalizedFriends.map((friend) => [friend.userId, friend]));
      const normalizedChats = sortChats(
        (chatsResponse.chats || []).map((chat) => {
          const normalizedChat = normalizeChat(chat);
          return {
            ...normalizedChat,
            friend: normalizedChat.friend || friendsById.get(normalizedChat.friendId),
          };
        })
      );

      setFriends(normalizedFriends);
      setIncomingRequests(sortRequests((friendsResponse.incomingRequests || []).map(normalizeRequest)));
      setOutgoingRequests(sortRequests((friendsResponse.outgoingRequests || []).map(normalizeRequest)));
      setIncomingRoomInvites(sortInvites((friendsResponse.incomingRoomInvites || []).map(normalizeRoomInvite)));
      setOutgoingRoomInvites(sortInvites((friendsResponse.outgoingRoomInvites || []).map(normalizeRoomInvite)));
      setChats(normalizedChats);
    } catch {
      setFriends([]);
      setIncomingRequests([]);
      setOutgoingRequests([]);
      setIncomingRoomInvites([]);
      setOutgoingRoomInvites([]);
      setChats([]);
    } finally {
      setReady(true);
    }
  }, [token, user?.isGuest]);

  useEffect(() => {
    void refreshSocial();
  }, [refreshSocial]);

  useEffect(() => {
    if (!token || user?.isGuest) {
      socketRef.current?.disconnect();
      socketRef.current = null;
      return;
    }

    const socket = createAuthenticatedSocket(token);
    socketRef.current = socket;

    const handleRefresh = () => {
      void refreshSocial({ silent: true });
    };

    socket.on('social_refresh', handleRefresh);
    socket.on('chat_message', handleRefresh);

    return () => {
      socket.off('social_refresh', handleRefresh);
      socket.off('chat_message', handleRefresh);
      socket.disconnect();
      if (socketRef.current === socket) {
        socketRef.current = null;
      }
    };
  }, [refreshSocial, token, user?.isGuest]);

  useEffect(() => {
    if (!token || user?.isGuest) {
      return;
    }

    const interval = setInterval(() => {
      void refreshSocial({ silent: true });
    }, 8000);

    const subscription = AppState.addEventListener('change', (status: AppStateStatus) => {
      if (status === 'active') {
        void refreshSocial({ silent: true });
      }
    });
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void refreshSocial({ silent: true });
      }
    };

    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }

    return () => {
      clearInterval(interval);
      subscription.remove();
      if (Platform.OS === 'web' && typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
    };
  }, [refreshSocial, token, user?.isGuest]);

  const addFriend = useCallback(
    async (query: string) => {
      if (!token) {
        throw new Error(i18n.t('social.errors.signInRequired', { defaultValue: 'Sign in first.' }));
      }

      const trimmed = query.trim().replace(/^@+/, '');
      if (trimmed.length < 2) {
        throw new Error(i18n.t('social.errors.handleMin'));
      }

      const response = await apiRequest<{ request: SocialFriendRequest | null }>('/api/social/friends', {
        method: 'POST',
        token,
        body: { query: trimmed },
      });

      await refreshSocial();
      return response.request ? normalizeRequest(response.request) : null;
    },
    [refreshSocial, token]
  );

  const acceptFriendRequest = useCallback(
    async (requestId: string) => {
      if (!token) {
        return;
      }

      await apiRequest(`/api/social/friend-requests/${requestId}/accept`, {
        method: 'POST',
        token,
      });

      await refreshSocial();
    },
    [refreshSocial, token]
  );

  const declineFriendRequest = useCallback(
    async (requestId: string) => {
      if (!token) {
        return;
      }

      await apiRequest(`/api/social/friend-requests/${requestId}/reject`, {
        method: 'POST',
        token,
      });

      await refreshSocial();
    },
    [refreshSocial, token]
  );

  const inviteToRoom = useCallback(
    async (friendId: string, roomId?: string) => {
      if (!token) {
        throw new Error(i18n.t('social.errors.signInRequired', { defaultValue: 'Sign in first.' }));
      }

      const response = await apiRequest<{ invite: { id: string; roomId: string } | null }>(
        `/api/social/friends/${friendId}/invite`,
        {
          method: 'POST',
          token,
          body: { roomId },
        }
      );

      await refreshSocial();
      if (!response.invite) {
        return null;
      }

      return {
        id: String(response.invite.id),
        roomId: String(response.invite.roomId),
        direction: 'outgoing' as const,
        status: 'pending',
        createdAt: new Date().toISOString(),
        user: friends.find((friend) => friend.userId === friendId) ?? normalizeFriend({
          id: friendId,
          userId: friendId,
          name: 'Friend',
          handle: '@friend',
          status: 'offline',
          invitedToRoom: true,
          createdAt: new Date().toISOString(),
        }),
      };
    },
    [friends, refreshSocial, token]
  );

  const clearInvite = useCallback(
    async (friendId: string) => {
      if (!token) {
        return;
      }

      await apiRequest(`/api/social/friends/${friendId}/invite`, {
        method: 'DELETE',
        token,
      });

      await refreshSocial();
    },
    [refreshSocial, token]
  );

  const acceptRoomInvite = useCallback(
    async (inviteId: string) => {
      if (!token) {
        throw new Error(i18n.t('social.errors.signInRequired', { defaultValue: 'Sign in first.' }));
      }

      const response = await apiRequest<{ roomId: string }>(`/api/social/room-invites/${inviteId}/accept`, {
        method: 'POST',
        token,
      });

      await refreshSocial();
      return { roomId: String(response.roomId) };
    },
    [refreshSocial, token]
  );

  const declineRoomInvite = useCallback(
    async (inviteId: string) => {
      if (!token) {
        return;
      }

      await apiRequest(`/api/social/room-invites/${inviteId}/reject`, {
        method: 'POST',
        token,
      });

      await refreshSocial();
    },
    [refreshSocial, token]
  );

  const getOrCreateChat = useCallback(
    async (friendId: string) => {
      if (!token) {
        throw new Error(i18n.t('social.errors.signInRequired', { defaultValue: 'Sign in first.' }));
      }

      const response = await apiRequest<{ chat: ChatThread }>(`/api/social/chats/with/${friendId}`, {
        method: 'POST',
        token,
      });

      const normalizedChat = normalizeChat(response.chat);
      const enrichedChat: ChatThread = {
        ...normalizedChat,
        friend: friends.find((item) => item.userId === friendId),
      };

      setChats((current) => sortChats([enrichedChat, ...current.filter((item) => item.id !== enrichedChat.id)]));
      return enrichedChat;
    },
    [friends, token]
  );

  const loadMessages = useCallback(
    async (chatId: string) => {
      if (!token) {
        return [];
      }

      const response = await apiRequest<MessagesResponse>(`/api/social/chats/${chatId}/messages`, {
        token,
      });
      const nextMessages = (response.messages || []).map(normalizeMessage);
      setMessagesByChatId((current) => ({
        ...current,
        [chatId]: nextMessages,
      }));
      return nextMessages;
    },
    [token]
  );

  const sendMessage = useCallback(
    async (chatId: string, text: string) => {
      if (!token) {
        throw new Error(i18n.t('social.errors.signInRequired', { defaultValue: 'Sign in first.' }));
      }

      const trimmed = text.trim();
      if (!trimmed) {
        return;
      }

      const response = await apiRequest<{ message: ChatMessage }>(`/api/social/chats/${chatId}/messages`, {
        method: 'POST',
        token,
        body: { text: trimmed },
      });

      const nextMessage = normalizeMessage(response.message);
      setMessagesByChatId((current) => ({
        ...current,
        [chatId]: [...(current[chatId] ?? []), nextMessage],
      }));
      setChats((current) =>
        sortChats(
          current.map((chat) =>
            chat.id === chatId
              ? {
                  ...chat,
                  lastMessageAt: nextMessage.createdAt,
                }
              : chat
          )
        )
      );
    },
    [token]
  );

  const getPublicProfile = useCallback(
    async (userId: string) => {
      if (!token) {
        throw new Error(i18n.t('social.errors.signInRequired', { defaultValue: 'Sign in first.' }));
      }

      const response = await apiRequest<{
        user: {
          id: string;
          username: string;
          email: string | null;
          role: string;
          rank: string;
          avatar_seed: string;
          created_at: string;
          is_guest: boolean;
          status: 'online' | 'offline' | 'away';
          stats: {
            friends: number;
            messages: number;
          };
        };
        relationship: SocialPublicProfile['relationship'];
      }>(`/api/social/users/${userId}`, {
        token,
      });

      return normalizePublicProfile({
        relationship: response.relationship,
        user: {
          id: String(response.user.id),
          username: response.user.username,
          email: response.user.email,
          role: response.user.role,
          rank: response.user.rank,
          avatarSeed: response.user.avatar_seed,
          createdAt: response.user.created_at,
          isGuest: Boolean(response.user.is_guest),
          status: response.user.status,
          stats: {
            friends: Number(response.user.stats?.friends || 0),
            messages: Number(response.user.stats?.messages || 0),
          },
        },
      });
    },
    [token]
  );

  const value = useMemo<SocialContextValue>(
    () => ({
      ready,
      friends,
      incomingRequests,
      outgoingRequests,
      incomingRoomInvites,
      outgoingRoomInvites,
      chats,
      messagesByChatId,
      refreshSocial,
      addFriend,
      acceptFriendRequest,
      declineFriendRequest,
      inviteToRoom,
      clearInvite,
      acceptRoomInvite,
      declineRoomInvite,
      getOrCreateChat,
      loadMessages,
      sendMessage,
      getPublicProfile,
    }),
    [
      acceptFriendRequest,
      acceptRoomInvite,
      addFriend,
      chats,
      clearInvite,
      declineFriendRequest,
      declineRoomInvite,
      friends,
      getOrCreateChat,
      getPublicProfile,
      incomingRequests,
      incomingRoomInvites,
      inviteToRoom,
      loadMessages,
      messagesByChatId,
      outgoingRequests,
      outgoingRoomInvites,
      ready,
      refreshSocial,
      sendMessage,
    ]
  );

  return <SocialContext.Provider value={value}>{children}</SocialContext.Provider>;
}

export function useSocial() {
  const context = useContext(SocialContext);

  if (!context) {
    throw new Error('useSocial must be used inside SocialProvider.');
  }

  return context;
}
