import i18n from '@/src/i18n';
import { Platform } from 'react-native';

const SHIKIMORI_BASE_URL = 'https://shikimori.one';
const MEDIA_BACKEND_BASE_URL =
  process.env.EXPO_PUBLIC_MEDIA_BACKEND_URL ||
  (Platform.OS === 'web'
    ? 'https://217-60-245-84.sslip.io/api/media'
    : 'https://217-60-245-84.sslip.io/api/media');
const KODIK_REQUEST_TIMEOUT_MS = 35000;

type ShikimoriCatalogResponseItem = {
  id: number;
  name: string;
  russian: string;
  image?: {
    original?: string;
  };
  score?: string;
  kind?: string;
  episodes?: number;
  episodes_aired?: number;
};

type ShikimoriDetailResponse = ShikimoriCatalogResponseItem & {
  description?: string | null;
  status?: string | null;
  genres?: {
    id: number;
    name: string;
    russian: string;
  }[];
};

type KodikSearchResponse = {
  results?: KodikSearchResult[];
};

type KodikSearchResult = {
  id?: string | number;
  title?: string;
  other_title?: string;
  link?: string;
  type?: string;
  episodes_count?: number | string;
  last_season?: number | string;
  episodes?: Record<string, KodikEpisodePayload | string | null | undefined>;
  episodes_data?: Record<string, KodikEpisodePayload | string | null | undefined>;
  material_data?: {
    anime_poster_url?: string;
    poster_url?: string;
  };
  translation?: {
    id?: number | string;
    title?: string;
    type?: string;
  };
  seasons?: Record<string, KodikSeasonPayload | string | null | undefined>;
};

type KodikSeasonPayload = {
  title?: string;
  link?: string;
  episodes?: Record<string, KodikEpisodePayload | string | null | undefined>;
};

type KodikEpisodePayload = {
  title?: string;
  link?: string;
  screenshots?: string[];
};

export type CatalogAnime = {
  id: number;
  title: string;
  originalTitle: string;
  score: string;
  posterUrl: string | null;
  episodes: number;
  episodesAired: number;
  kind: string;
};

export type CatalogAnimeDetail = CatalogAnime & {
  description: string;
  status: string;
  genres: string[];
};

export type KodikEpisode = {
  id: string;
  number: number;
  title: string;
  link: string | null;
  screenshot: string | null;
};

export type KodikSeason = {
  id: string;
  label: string;
  link: string | null;
  episodes: KodikEpisode[];
};

export type KodikTranslation = {
  id: string;
  title: string;
  type: string;
  posterUrl: string | null;
  playerLink: string | null;
  seasons: KodikSeason[];
};

function toPositiveNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function buildShikimoriPosterUrl(path?: string) {
  if (!path) {
    return null;
  }

  return `${SHIKIMORI_BASE_URL}${path}`;
}

function normalizeText(value?: string | null) {
  return String(value ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\[[^[\]]+]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeComparisonText(value?: string | null) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-z0-9а-яіїєґ]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeKodikLink(link?: string | null) {
  if (!link) {
    return null;
  }

  if (link.startsWith('//')) {
    return `https:${link}`;
  }

  if (link.startsWith('http://') || link.startsWith('https://')) {
    return link;
  }

  if (link.startsWith('/')) {
    return `https://kodik.info${link}`;
  }

  return `https://${link}`;
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string') {
      throw new Error(payload.error);
    }

    throw new Error(`HTTP ${response.status}`);
  }

  return (await response.json()) as T;
}

function delay(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isKodikRetryableError(error: unknown) {
  return (
    error instanceof Error &&
    (error.message.includes('HTTP 502') ||
      error.message.includes('HTTP 520') ||
      error.message.includes('HTTP 521') ||
      error.message.includes('HTTP 522') ||
      error.message.includes('HTTP 524'))
  );
}

async function requestKodikResults(params: Record<string, string>) {
  const searchParams = new URLSearchParams(params);
  const url = `${MEDIA_BACKEND_BASE_URL}/kodik/search?${searchParams.toString()}`;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), KODIK_REQUEST_TIMEOUT_MS);

    try {
      const payload = await requestJson<KodikSearchResponse>(url, {
        headers: {
          Accept: 'application/json',
          ...(Platform.OS === 'web' ? {} : { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }),
        },
        signal: controller.signal,
      });
      return payload.results ?? [];
    } catch (error) {
      console.error('Kodik request failed:', error);

      if (attempt === 0 && isKodikRetryableError(error)) {
        await delay(2500);
        continue;
      }

      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(i18n.t('online.providerTimeout'));
      }

      if (error instanceof Error && error.message.includes('Kodik timeout')) {
        throw new Error(i18n.t('online.providerTimeout'));
      }

      if (error instanceof Error && error.message.includes('Network request failed')) {
        throw new Error(i18n.t('online.providerBlocked'));
      }

      if (
        error instanceof Error &&
        (error.message.includes('Kodik blocked') ||
          error.message.includes('Failed to fetch Kodik.') ||
          error.message.includes('All Kodik mirrors failed.'))
      ) {
        throw new Error(i18n.t('online.providerBlocked'));
      }

      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  return [];
}

function mapCatalogAnime(item: ShikimoriCatalogResponseItem): CatalogAnime {
  return {
    id: item.id,
    title: item.russian || item.name || i18n.t('discover.unknownTitle'),
    originalTitle: item.name || item.russian || i18n.t('discover.unknownTitle'),
    score: item.score || '0.0',
    posterUrl: buildShikimoriPosterUrl(item.image?.original),
    episodes: toPositiveNumber(item.episodes, 0),
    episodesAired: toPositiveNumber(item.episodes_aired, 0),
    kind: item.kind || 'tv',
  };
}

function buildSeasonLabel(seasonNumber: number) {
  return `${i18n.t('online.seasonLabel')} ${seasonNumber}`;
}

function buildEpisodeTitle(episodeNumber: number) {
  return i18n.t('online.episodeLabel', { value: episodeNumber });
}

function buildFallbackEpisodes(count: number, link: string | null) {
  return Array.from({ length: Math.max(count, 1) }, (_, index) => ({
    id: `episode-${index + 1}`,
    number: index + 1,
    title: buildEpisodeTitle(index + 1),
    link,
    screenshot: null,
  }));
}

function parseSeasonNumber(value: unknown, fallback = 1) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized || normalized === 'undefined' || normalized === 'null') {
    return fallback;
  }

  const numeric = normalized.match(/\d+/);
  return toPositiveNumber(numeric?.[0], fallback);
}

function getRootEpisodesPayload(result: KodikSearchResult) {
  const candidates = [result.episodes, result.episodes_data];
  for (const candidate of candidates) {
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

function parseSeasonEpisodes(
  seasonPayload: KodikSeasonPayload | string | null | undefined,
  seasonLabel: string,
  fallbackLink: string | null,
  fallbackCount: number,
  fallbackEpisodesData?: Record<string, KodikEpisodePayload | string | null | undefined>
) {
  if (typeof seasonPayload === 'string') {
    return buildFallbackEpisodes(fallbackCount, normalizeKodikLink(seasonPayload));
  }

  const seasonLink = normalizeKodikLink(seasonPayload?.link) ?? fallbackLink;
  const episodesData = seasonPayload?.episodes ?? fallbackEpisodesData;

  if (!episodesData || typeof episodesData !== 'object') {
    return buildFallbackEpisodes(fallbackCount, seasonLink);
  }

  const episodes = Object.entries(episodesData)
    .map(([episodeKey, episodePayload]) => {
      const episodeNumber = toPositiveNumber(String(episodeKey).replace(/\D+/g, ''), 0);

      if (typeof episodePayload === 'string') {
        return {
          id: `${seasonLabel}-${episodeNumber || episodeKey}`,
          number: episodeNumber || 1,
          title: buildEpisodeTitle(episodeNumber || 1),
          link: normalizeKodikLink(episodePayload) ?? seasonLink,
          screenshot: null,
        };
      }

      const payload = episodePayload ?? {};
      const link = normalizeKodikLink(payload.link) ?? seasonLink;
      const title = normalizeText(payload.title) || buildEpisodeTitle(episodeNumber || 1);
      const screenshot = payload.screenshots?.[0] ?? null;

      return {
        id: `${seasonLabel}-${episodeNumber || episodeKey}`,
        number: episodeNumber || 1,
        title,
        link,
        screenshot,
      };
    })
    .sort((left, right) => left.number - right.number);

  return episodes.length > 0 ? episodes : buildFallbackEpisodes(fallbackCount, seasonLink);
}

function parseSeasons(result: KodikSearchResult): KodikSeason[] {
  const fallbackLink = normalizeKodikLink(result.link);
  const fallbackCount = toPositiveNumber(result.episodes_count, 1);
  const seasonsPayload = result.seasons;
  const fallbackSeasonNumber = parseSeasonNumber(result.last_season, 1);
  const rootEpisodesData = getRootEpisodesPayload(result);

  if (!seasonsPayload || typeof seasonsPayload !== 'object' || Array.isArray(seasonsPayload)) {
    const fallbackLabel = buildSeasonLabel(fallbackSeasonNumber);

    return [
      {
        id: `season-${fallbackSeasonNumber}`,
        label: fallbackLabel,
        link: fallbackLink,
        episodes: parseSeasonEpisodes(
          {
            link: fallbackLink ?? undefined,
            episodes: rootEpisodesData,
          },
          fallbackLabel,
          fallbackLink,
          fallbackCount,
          rootEpisodesData
        ),
      },
    ];
  }

  const seasons = Object.entries(seasonsPayload)
    .map(([seasonKey, seasonPayload], index) => {
      const numericSeason = parseSeasonNumber(seasonKey, index + 1);
      const label =
        (typeof seasonPayload === 'string' ? '' : normalizeText(seasonPayload?.title)) || buildSeasonLabel(numericSeason);
      const seasonLink =
        typeof seasonPayload === 'string'
          ? normalizeKodikLink(seasonPayload)
          : normalizeKodikLink(seasonPayload?.link) ?? fallbackLink;

      return {
        id: `season-${numericSeason}`,
        label,
        link: seasonLink,
        episodes: parseSeasonEpisodes(seasonPayload, label, seasonLink, fallbackCount),
      };
    })
    .sort((left, right) => {
      const leftValue = toPositiveNumber(left.id.replace(/\D+/g, ''), 0);
      const rightValue = toPositiveNumber(right.id.replace(/\D+/g, ''), 0);
      return leftValue - rightValue;
    });

  return seasons.length > 0
    ? seasons
    : [
        {
          id: `season-${fallbackSeasonNumber}`,
          label: buildSeasonLabel(fallbackSeasonNumber),
          link: fallbackLink,
          episodes: buildFallbackEpisodes(fallbackCount, fallbackLink),
        },
      ];
}

function mergeTranslations(results: KodikSearchResult[], requestedShikimoriId?: string) {
  const translations = new Map<string, KodikTranslation>();

  // CRITICAL FIX: Strictly filter by shikimori_id if provided to avoid franchise bug
  const filteredResults = requestedShikimoriId
    ? results.filter(r => {
        const rid = String((r as any).shikimori_id || '');
        // We strictly enforce requestedShikimoriId if rid exists on the result
        return !rid || rid === requestedShikimoriId;
      })
    : results;

  for (const result of filteredResults) {
    const translationTitle = normalizeText(result.translation?.title) || i18n.t('online.dubs.original');
    const translationType = normalizeText(result.translation?.type) || 'voice';

    // CRITICAL: USE RESULT ID TO PREVENT OVERWRITING DUBS!
    // Often AniDub and others might share same translation ID across different result entries
    const key = String(result.id || result.translation?.id || `${translationTitle}-${Math.random()}`);

    const playerLink = normalizeKodikLink(result.link);
    const posterUrl = normalizeKodikLink(result.material_data?.anime_poster_url) ?? normalizeKodikLink(result.material_data?.poster_url);

    // FLATTEN ALL EPISODES FROM ALL SEASONS as requested in the override
    const flatEpisodes: KodikEpisode[] = [];

    // Check if result has seasons
    if (result.seasons && typeof result.seasons === 'object') {
      Object.entries(result.seasons).forEach(([seasonNum, seasonPayload]: [string, any]) => {
        if (seasonPayload?.episodes && typeof seasonPayload.episodes === 'object') {
          Object.entries(seasonPayload.episodes).forEach(([epNum, epData]: [string, any]) => {
            const numericNum = toPositiveNumber(epNum.replace(/\D+/g, ''), 0) || 1;

            let epLink = null;
            let epTitle = null;
            let epScreenshot = null;

            if (typeof epData === 'string') {
              epLink = normalizeKodikLink(epData);
            } else if (epData && typeof epData === 'object') {
              epLink = normalizeKodikLink(epData.link);
              epTitle = normalizeText(epData.title);
              epScreenshot = epData.screenshots?.[0] ?? null;
            }

            flatEpisodes.push({
              id: `${key}-s${seasonNum}-e${numericNum}`,
              number: numericNum,
              title: epTitle || i18n.t('online.episodeLabel', { value: numericNum }),
              link: epLink ?? playerLink,
              screenshot: epScreenshot,
            });
          });
        }
      });
    }

    // If no seasons found, try to grab root episodes
    if (flatEpisodes.length === 0) {
      const rootEpisodes = getRootEpisodesPayload(result);
      if (rootEpisodes && typeof rootEpisodes === 'object') {
        Object.entries(rootEpisodes).forEach(([epNum, epData]: [string, any]) => {
           const numericNum = toPositiveNumber(epNum.replace(/\D+/g, ''), 0) || 1;
           let epLink = null;
           if (typeof epData === 'string') epLink = normalizeKodikLink(epData);
           else if (epData) epLink = normalizeKodikLink(epData.link);

           flatEpisodes.push({
             id: `${key}-e${numericNum}`,
             number: numericNum,
             title: (epData && typeof epData === 'object' && normalizeText(epData.title)) || i18n.t('online.episodeLabel', { value: numericNum }),
             link: epLink ?? playerLink,
             screenshot: (epData && typeof epData === 'object' && epData.screenshots?.[0]) || null,
           });
        });
      }
    }

    // If still no episodes, create at least one if it's not a serial or we have a link
    if (flatEpisodes.length === 0 && playerLink) {
       const count = toPositiveNumber(result.episodes_count, 1);
       for (let i = 1; i <= count; i++) {
         flatEpisodes.push({
           id: `${key}-fallback-e${i}`,
           number: i,
           title: i18n.t('online.episodeLabel', { value: i }),
           link: playerLink,
           screenshot: null,
         });
       }
    }

    // Remove duplicates and sort episodes
    const uniqueEpisodes = Array.from(new Map(flatEpisodes.map(item => [item.number, item])).values())
      .sort((a, b) => a.number - b.number);

    if (uniqueEpisodes.length > 0) {
      translations.set(key, {
        id: key,
        title: translationTitle,
        type: translationType,
        posterUrl,
        playerLink,
        seasons: [{ id: 'all-episodes', label: i18n.t('online.allEpisodes', { defaultValue: 'All Episodes' }), link: playerLink, episodes: uniqueEpisodes }]
      });
    }
  }

  // Return sorted translations (AniDub, StudioBand, etc. will all be here)
  return Array.from(translations.values()).sort((a, b) => a.title.localeCompare(b.title));
}

export async function fetchTrendingCatalog(includeHentai = false) {
  const url = `${SHIKIMORI_BASE_URL}/api/animes?limit=30&order=ranked${includeHentai ? '' : '&genre_exclude=12'}`;
  const payload = await requestJson<ShikimoriCatalogResponseItem[]>(url);

  return Array.isArray(payload) ? payload.map(mapCatalogAnime) : [];
}

export async function searchCatalog(query: string, includeHentai = false) {
  const trimmed = query.trim();

  if (!trimmed) {
    return fetchTrendingCatalog(includeHentai);
  }

  const url = `${SHIKIMORI_BASE_URL}/api/animes?search=${encodeURIComponent(trimmed)}&limit=20${includeHentai ? '' : '&genre_exclude=12'}`;
  const payload = await requestJson<ShikimoriCatalogResponseItem[]>(url);

  return Array.isArray(payload) ? payload.map(mapCatalogAnime) : [];
}

export async function fetchAnimeDetail(id: number) {
  const payload = await requestJson<ShikimoriDetailResponse>(
    `${SHIKIMORI_BASE_URL}/api/animes/${id}`
  );

  const base = mapCatalogAnime(payload);

  return {
    ...base,
    description: normalizeText(payload.description) || i18n.t('discover.descriptionFallback'),
    status: normalizeText(payload.status) || 'ongoing',
    genres: Array.isArray(payload.genres)
      ? payload.genres.map((genre) => genre.russian || genre.name).filter(Boolean)
      : [],
  } satisfies CatalogAnimeDetail;
}

export async function fetchKodikTranslations(shikimoriId: number, fallbackTitle?: string | string[] | null) {
  const titleVariants = [
    ...new Set(
      (Array.isArray(fallbackTitle) ? fallbackTitle : [fallbackTitle])
        .map((value) => String(value ?? '').trim())
        .filter(Boolean)
    ),
  ];

  try {
    const results: KodikSearchResult[] = [];
    let lastError: unknown = null;

    try {
      results.push(
        ...(await requestKodikResults({
          shikimori_id: String(shikimoriId),
        }))
      );
    } catch (error) {
      lastError = error;
    }

    for (const title of titleVariants) {
      try {
        results.push(
          ...(await requestKodikResults({
            title,
            strict: 'true',
            types: 'anime-serial,anime',
          }))
        );
      } catch (error) {
        lastError = error;
      }
    }

    if (results.length === 0) {
      throw lastError instanceof Error ? lastError : new Error(i18n.t('online.providerError'));
    }

    return mergeTranslations(results, String(shikimoriId));
  } catch (error) {
    console.error('Kodik Fetch Failed:', error);
    throw error;
  }
}
