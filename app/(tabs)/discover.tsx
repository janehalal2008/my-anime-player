import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  FlatList,
  ListRenderItemInfo,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { LinearGradient } from 'expo-linear-gradient';

import { LiquidBackground } from '@/src/components/ui/liquid-background';
import { GlassCard } from '@/src/components/ui/glass-card';
import { useApp } from '@/src/providers/app-provider';
import { useAuth } from '@/src/providers/auth-provider';
import { fetchTrendingCatalog, searchCatalog, type CatalogAnime } from '@/src/services/online-catalog';

function CatalogCard({
  item,
  index,
  onPress,
}: {
  item: CatalogAnime;
  index: number;
  onPress: () => void;
}) {
  const { theme } = useApp();
  const { t } = useTranslation();

  return (
    <Animated.View
      entering={FadeInDown.delay(index * 45).springify()}
      layout={LinearTransition.springify().damping(18).stiffness(180)}
      style={styles.cardShell}>
      <Pressable onPress={onPress}>
        <GlassCard style={styles.card}>
          <View style={styles.posterShell}>
            {item.posterUrl ? (
              <Image source={{ uri: item.posterUrl }} style={styles.poster} contentFit="cover" />
            ) : (
              <View style={[styles.poster, styles.posterFallback, { backgroundColor: theme.surfaceStrong }]}>
                <Ionicons name="image-outline" size={24} color={theme.textPrimary} />
              </View>
            )}

            <LinearGradient
              colors={['transparent', 'rgba(0,0,0,0.85)']}
              style={styles.posterGradient}
            />

            <View style={[styles.scoreBadge, { backgroundColor: theme.accentPrimary }]}>
              <Ionicons name="star" size={10} color="#000" />
              <Text style={styles.scoreBadgeLabel}>{item.score}</Text>
            </View>

            <View style={styles.cardContentOverlay}>
               <Text style={[styles.cardTitle, { color: '#FFF' }]} numberOfLines={2}>
                {item.title}
              </Text>
              <Text style={[styles.cardMeta, { color: 'rgba(255,255,255,0.7)' }]} numberOfLines={1}>
                {t('discover.episodesCount', { count: item.episodesAired || item.episodes || 0 })}
              </Text>
            </View>
          </View>
        </GlassCard>
      </Pressable>
    </Animated.View>
  );
}

export default function DiscoverTabScreen() {
  const { theme } = useApp();
  const { user } = useAuth();
  const { t } = useTranslation();
  const [items, setItems] = useState<CatalogAnime[]>([]);
  const [query, setQuery] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [suggestions, setSuggestions] = useState<CatalogAnime[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const showSuggestions = useMemo(
    () => query.trim().length > 0 && (suggestionsLoading || suggestions.length > 0),
    [query, suggestions, suggestionsLoading]
  );

  const loadCatalog = useCallback(
    async (nextQuery?: string) => {
      const trimmedQuery = (nextQuery ?? activeQuery).trim();
      setError(null);
      setRefreshing(true);

      const includeHentai = Boolean(user && !user.isGuest && (user as any).age >= 18);

      try {
        const nextItems = trimmedQuery
          ? await searchCatalog(trimmedQuery, includeHentai)
          : await fetchTrendingCatalog(includeHentai);
        setItems(nextItems);
        setActiveQuery(trimmedQuery);
      } catch {
        setError(t('discover.loadError'));
        setItems([]);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [activeQuery, t, user]
  );

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  useEffect(() => {
    const trimmed = query.trim();

    if (trimmed.length < 2) {
      setSuggestions([]);
      setSuggestionsLoading(false);
      return;
    }

    let active = true;
    const timeoutId = setTimeout(() => {
      void (async () => {
        setSuggestionsLoading(true);

        try {
          const includeHentai = Boolean(user && !user.isGuest && (user as any).age >= 18);
          const results = await searchCatalog(trimmed, includeHentai);
          if (active) {
            setSuggestions(results.slice(0, 6));
          }
        } catch {
          if (active) {
            setSuggestions([]);
          }
        } finally {
          if (active) {
            setSuggestionsLoading(false);
          }
        }
      })();
    }, 220);

    return () => {
      active = false;
      clearTimeout(timeoutId);
    };
  }, [query, user]);

  const renderItem = ({ item, index }: ListRenderItemInfo<CatalogAnime>) => (
    <CatalogCard
      item={item}
      index={index}
      onPress={() => {
        router.push({
          pathname: '/online/[id]',
          params: {
            id: String(item.id),
          },
        });
      }}
    />
  );

  if (loading) {
    return (
      <LiquidBackground>
        <View style={styles.loadingState}>
          <ActivityIndicator size="large" color={theme.accentPrimary} />
          <Text style={[styles.loadingText, { color: theme.textPrimary }]}>{t('online.loading')}</Text>
        </View>
      </LiquidBackground>
    );
  }

  return (
    <LiquidBackground>
      <View style={styles.screen}>
        <FlatList
          data={items}
          renderItem={renderItem}
          keyExtractor={(item) => String(item.id)}
          style={styles.list}
          numColumns={2}
          columnWrapperStyle={styles.gridRow}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          onRefresh={() => {
            void loadCatalog();
          }}
          refreshing={refreshing}
          ListHeaderComponent={
            <View style={styles.header}>
              <GlassCard style={styles.heroCard}>
                <Image
                  source={require('../../assets/images/icon.png')}
                  style={styles.heroIcon}
                  contentFit="cover"
                />
                <View style={styles.heroCopy}>
                  <Text style={[styles.eyebrow, { color: theme.textSecondary }]}>{t('discover.heroEyebrow')}</Text>
                  <Text style={[styles.title, { color: theme.textPrimary }]}>{t('tabs.discover')}</Text>
                  <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
                    {t('discover.heroSubtitle')}
                  </Text>
                </View>
                <Pressable
                  onPress={() => {
                    void loadCatalog();
                  }}
                  style={[styles.heroAction, { backgroundColor: theme.surfaceStrong }]}>
                  {refreshing ? (
                    <ActivityIndicator size="small" color={theme.textPrimary} />
                  ) : (
                    <Ionicons name="refresh" size={18} color={theme.textPrimary} />
                  )}
                </Pressable>
              </GlassCard>

              <View style={styles.searchContainer}>
                <GlassCard style={styles.searchCard}>
                  <Ionicons name="search-outline" size={18} color={theme.textSecondary} />
                  <TextInput
                    value={query}
                    onChangeText={setQuery}
                    onSubmitEditing={() => {
                      setSuggestions([]);
                      void loadCatalog(query);
                    }}
                    placeholder={t('discover.searchPlaceholder')}
                    placeholderTextColor={theme.textMuted}
                    returnKeyType="search"
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={[styles.searchInput, { color: theme.textPrimary }]}
                  />
                  {query ? (
                    <Pressable
                      onPress={() => {
                        setQuery('');
                        setSuggestions([]);
                        void loadCatalog('');
                      }}
                      style={[styles.searchAction, { backgroundColor: theme.surfaceStrong }]}>
                      <Ionicons name="close" size={16} color={theme.textPrimary} />
                    </Pressable>
                  ) : (
                    <Pressable
                      onPress={() => {
                        void loadCatalog(query);
                      }}
                      style={[styles.searchAction, { backgroundColor: theme.surfaceStrong }]}>
                      <Ionicons name="arrow-forward" size={16} color={theme.textPrimary} />
                    </Pressable>
                  )}
                </GlassCard>

                {showSuggestions ? (
                  <GlassCard style={styles.searchDropdown}>
                    <FlatList
                      data={suggestions}
                      keyExtractor={(item) => `suggestion-${item.id}`}
                      keyboardShouldPersistTaps="handled"
                      scrollEnabled={false}
                      ListEmptyComponent={
                        <View style={styles.suggestionEmpty}>
                          <Text style={[styles.suggestionEmptyText, { color: theme.textSecondary }]}>
                            {t('discover.suggestionsEmpty')}
                          </Text>
                        </View>
                      }
                      renderItem={({ item }) => (
                        <Pressable
                          onPress={() => {
                            setQuery(item.title);
                            setSuggestions([]);
                            router.push({
                              pathname: '/online/[id]',
                              params: { id: String(item.id) },
                            });
                          }}
                          style={styles.suggestionRow}>
                          {item.posterUrl ? (
                            <Image source={{ uri: item.posterUrl }} style={styles.suggestionThumb} contentFit="cover" />
                          ) : (
                            <View style={[styles.suggestionThumb, { backgroundColor: theme.surfaceStrong }]} />
                          )}
                          <View style={styles.suggestionCopy}>
                            <Text style={[styles.suggestionTitle, { color: theme.textPrimary }]} numberOfLines={1}>
                              {item.title}
                            </Text>
                            <Text style={[styles.suggestionMeta, { color: theme.textSecondary }]} numberOfLines={1}>
                              {t('discover.episodesCount', { count: item.episodesAired || item.episodes || 0 })}
                            </Text>
                          </View>
                        </Pressable>
                      )}
                    />
                  </GlassCard>
                ) : null}
              </View>

              {error ? (
                <GlassCard style={styles.noticeCard}>
                  <Ionicons name="warning-outline" size={18} color={theme.warning} />
                  <Text style={[styles.noticeText, { color: theme.textSecondary }]}>{error}</Text>
                </GlassCard>
              ) : null}
            </View>
          }
          ListEmptyComponent={
            <GlassCard style={styles.emptyCard}>
              <Ionicons name="film-outline" size={28} color={theme.textPrimary} />
              <Text style={[styles.emptyTitle, { color: theme.textPrimary }]}>{t('discover.emptyTitle')}</Text>
              <Text style={[styles.emptyText, { color: theme.textSecondary }]}>
                {t('discover.emptyCopy')}
              </Text>
            </GlassCard>
          }
        />
      </View>
    </LiquidBackground>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 120,
  },
  loadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
  },
  loadingText: {
    fontSize: 18,
    fontWeight: '700',
  },
  header: {
    marginBottom: 20,
    gap: 14,
    zIndex: 10,
  },
  heroCard: {
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  heroIcon: {
    width: 60,
    height: 60,
    borderRadius: 14,
  },
  heroCopy: {
    flex: 1,
    gap: 4,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1.1,
  },
  title: {
    fontSize: 28,
    fontWeight: '900',
  },
  subtitle: {
    fontSize: 13,
    lineHeight: 18,
  },
  heroAction: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchContainer: {
    position: 'relative',
    zIndex: 9999,
    elevation: 100,
  },
  searchCard: {
    minHeight: 54,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  list: {
    flex: 1,
  },
  searchDropdown: {
    position: 'absolute',
    top: 60,
    left: 0,
    right: 0,
    zIndex: 10000,
    elevation: 101,
  },
  suggestionRow: {
    minHeight: 56,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  suggestionThumb: {
    width: 36,
    height: 50,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  suggestionCopy: {
    flex: 1,
    minWidth: 0,
  },
  suggestionTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  suggestionMeta: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: '600',
  },
  suggestionEmpty: {
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  suggestionEmptyText: {
    fontSize: 13,
    fontWeight: '600',
  },
  noticeCard: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  noticeText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    paddingVertical: 0,
  },
  searchAction: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridRow: {
    gap: 14,
    marginBottom: 14,
  },
  cardShell: {
    flex: 1,
  },
  card: {
    borderRadius: 14,
  },
  posterShell: {
    position: 'relative',
    width: '100%',
    aspectRatio: 0.7,
    overflow: 'hidden',
  },
  poster: {
    width: '100%',
    height: '100%',
  },
  posterGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '60%',
  },
  posterFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  scoreBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  scoreBadgeLabel: {
    fontSize: 11,
    fontWeight: '900',
    color: '#000',
  },
  cardContentOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 10,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '800',
    lineHeight: 18,
  },
  cardMeta: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: '700',
  },
  emptyCard: {
    marginTop: 40,
    padding: 24,
    alignItems: 'center',
    gap: 10,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '800',
  },
  emptyText: {
    textAlign: 'center',
    fontSize: 14,
    lineHeight: 20,
  },
});
