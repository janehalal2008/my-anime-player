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

import i18n from '@/src/i18n';
import { apiRequest } from '@/src/services/backend-api';
import { deleteItem, getJson, setJson } from '@/src/utils/storage';

type AuthApiUser = {
  id: number | string | null;
  username: string;
  email: string | null;
  role: 'user' | 'admin' | 'moderator';
  rank: string;
  is_guest: boolean;
  avatar_seed?: string | null;
  created_at?: string | null;
  stats?: {
    friends?: number;
    messages?: number;
  };
};

type StoredSession = {
  token: string;
  user: AuthUser;
};

export type AuthUser = {
  id: string | null;
  username: string;
  email: string | null;
  role: 'user' | 'admin' | 'moderator';
  rank: string;
  isGuest: boolean;
  joinedAt: string;
  avatarSeed: string;
  age?: number;
  stats?: {
    friends: number;
    messages: number;
  };
};

export type PendingAuth = null;

type AuthContextValue = {
  ready: boolean;
  token: string | null;
  user: AuthUser | null;
  pendingAuth: PendingAuth;
  startRegister: (input: { username: string; email: string; password: string; age: number }) => Promise<void>;
  startLogin: (input: { email: string; password: string }) => Promise<void>;
  continueAsGuest: () => Promise<void>;
  submitTwoFactorCode: (code: string) => Promise<void>;
  cancelPendingAuth: () => Promise<void>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<void>;
};

const SESSION_KEY = 'auth_session_v4';
const AuthContext = createContext<AuthContextValue | null>(null);

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function mapApiUser(user: AuthApiUser): AuthUser {
  return {
    id: user.id === null ? null : String(user.id),
    username: user.username,
    email: user.email,
    role: user.role,
    rank: user.rank,
    isGuest: Boolean(user.is_guest),
    joinedAt: user.created_at || new Date().toISOString(),
    avatarSeed: user.avatar_seed || `${user.username}-${user.id ?? 'guest'}`,
    age: (user as any).age,
    stats: user.stats
      ? {
          friends: Number(user.stats.friends || 0),
          messages: Number(user.stats.messages || 0),
        }
      : undefined,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const sessionMutationRef = useRef(0);

  const persistSession = useCallback(async (nextToken: string, nextUser: AuthUser) => {
    sessionMutationRef.current += 1;
    const nextSession: StoredSession = {
      token: nextToken,
      user: nextUser,
    };

    setToken(nextToken);
    setUser(nextUser);
    await setJson(SESSION_KEY, nextSession);
  }, []);

  const clearSession = useCallback(async () => {
    sessionMutationRef.current += 1;
    setToken(null);
    setUser(null);
    await deleteItem(SESSION_KEY);
  }, []);

  const refreshSession = useCallback(async () => {
    const refreshVersion = sessionMutationRef.current;
    const storedSession = await getJson<StoredSession | null>(SESSION_KEY, null);

    if (refreshVersion !== sessionMutationRef.current) {
      return;
    }

    if (!storedSession?.token) {
      setToken(null);
      setUser(null);
      return;
    }

    try {
      const response = await apiRequest<{ user: AuthApiUser }>('/api/me', {
        token: storedSession.token,
      });
      if (refreshVersion !== sessionMutationRef.current) {
        return;
      }
      await persistSession(storedSession.token, mapApiUser(response.user));
    } catch (error) {
      if (refreshVersion !== sessionMutationRef.current) {
        return;
      }
      const message = error instanceof Error ? error.message : '';
      const tokenRejected =
        message === 'Invalid or expired authentication token.' ||
        message === 'Authentication token is required.' ||
        message.startsWith('HTTP 401');

      if (tokenRejected) {
        await clearSession();
        return;
      }

      setToken(storedSession.token);
      setUser(storedSession.user);
    }
  }, [clearSession, persistSession]);

  useEffect(() => {
    let active = true;

    async function hydrate() {
      try {
        await refreshSession();
      } finally {
        if (active) {
          setReady(true);
        }
      }
    }

    void hydrate();

    return () => {
      active = false;
    };
  }, [refreshSession]);

  const startRegister = useCallback(
    async (input: { username: string; email: string; password: string; age: number }) => {
      const username = input.username.trim();
      const email = normalizeEmail(input.email);
      const password = input.password;
      const age = input.age;

      if (username.length < 2) {
        throw new Error(i18n.t('auth.errors.usernameMin'));
      }

      if (!email.includes('@') || email.length < 5) {
        throw new Error(i18n.t('auth.errors.invalidEmail'));
      }

      if (password.length < 6) {
        throw new Error(i18n.t('auth.errors.passwordMin'));
      }

      const response = await apiRequest<{ token: string; user: AuthApiUser }>('/api/auth/register', {
        method: 'POST',
        body: { username, email, password, age },
      });

      await persistSession(response.token, mapApiUser(response.user));
    },
    [persistSession]
  );

  const startLogin = useCallback(
    async (input: { email: string; password: string }) => {
      const identifier = input.email.trim();
      const password = input.password;

      if (!identifier || !password) {
        throw new Error(i18n.t('auth.errors.invalidCredentials'));
      }

      const response = await apiRequest<{ token: string; user: AuthApiUser }>('/api/auth/login', {
        method: 'POST',
        body: {
          email: normalizeEmail(identifier),
          username: identifier,
          password,
        },
      });

      await persistSession(response.token, mapApiUser(response.user));
    },
    [persistSession]
  );

  const continueAsGuest = useCallback(async () => {
    const response = await apiRequest<{ token: string; user: AuthApiUser }>('/api/auth/guest', {
      method: 'POST',
    });

    await persistSession(response.token, mapApiUser(response.user));
  }, [persistSession]);

  const submitTwoFactorCode = useCallback(async (_code: string) => {
    throw new Error(i18n.t('auth.errors.noChallenge'));
  }, []);

  const cancelPendingAuth = useCallback(async () => undefined, []);

  const logout = useCallback(async () => {
    await clearSession();
  }, [clearSession]);

  const value = useMemo<AuthContextValue>(
    () => ({
      ready,
      token,
      user,
      pendingAuth: null,
      startRegister,
      startLogin,
      continueAsGuest,
      submitTwoFactorCode,
      cancelPendingAuth,
      logout,
      refreshSession,
    }),
    [
      cancelPendingAuth,
      continueAsGuest,
      logout,
      ready,
      refreshSession,
      startLogin,
      startRegister,
      submitTwoFactorCode,
      token,
      user,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider.');
  }

  return context;
}
