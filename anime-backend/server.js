require('dotenv').config();

const http = require('http');
const https = require('https');
const dns = require('dns');
const { URLSearchParams } = require('url');
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { Server } = require('socket.io');
const youtubedl = require('youtube-dl-exec');

const PORT = Number(process.env.PORT || 3000);
const KODIK_TOKEN = process.env.KODIK_TOKEN || '8b72506e7c10b6510834316dcb989601';
const KODIK_TIMEOUT_MS = Number(process.env.KODIK_TIMEOUT_MS || 25000);
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const KODIK_MIRRORS = [
  {
    name: 'kodikapi',
    searchUrl: 'https://kodikapi.com/search',
    origin: 'https://kodikapi.com',
  },
  {
    name: 'kodik-info',
    searchUrl: 'https://kodik.info/search',
    origin: 'https://kodik.info',
  },
  {
    name: 'kodik-biz',
    searchUrl: 'https://kodik.biz/search',
    origin: 'https://kodik.biz',
  },
];
const KODIK_HEADER_PROFILES = [
  {
    name: 'chrome',
    accept: 'application/json, text/plain, */*',
    acceptLanguage: 'uk-UA,uk;q=0.9,ru;q=0.8,en-US;q=0.7,en;q=0.6',
  },
  {
    name: 'fallback',
    accept: 'text/plain,application/json;q=0.9,*/*;q=0.8',
    acceptLanguage: 'ru-RU,ru;q=0.9,uk-UA;q=0.8,en-US;q=0.7,en;q=0.6',
  },
];
const KODIK_PROXY_FALLBACKS = [
  {
    name: 'allorigins',
    buildRequest(targetUrl) {
      return {
        url: 'https://api.allorigins.win/raw',
        params: {
          url: targetUrl,
        },
        origin: 'https://api.allorigins.win',
      };
    },
  },
  {
    name: 'codetabs',
    buildRequest(targetUrl) {
      return {
        url: 'https://api.codetabs.com/v1/proxy',
        params: {
          quest: targetUrl,
        },
        origin: 'https://api.codetabs.com',
      };
    },
  },
];
const dnsResolver = new dns.Resolver();
dnsResolver.setServers(['1.1.1.1', '8.8.8.8']);

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

const httpClient = axios.create({
  timeout: KODIK_TIMEOUT_MS,
  maxRedirects: 5,
  responseType: 'text',
  transformResponse: [(data) => data],
  httpAgent: new http.Agent({
    keepAlive: true,
  }),
  httpsAgent: new https.Agent({
    keepAlive: true,
    lookup(hostname, options, callback) {
      dnsResolver.resolve4(hostname, (error, addresses) => {
        if (!error && addresses && addresses.length > 0) {
          callback(null, addresses[0], 4);
          return;
        }

        dns.lookup(hostname, options, callback);
      });
    },
  }),
  headers: {
    'User-Agent': USER_AGENT,
    Accept: 'application/json, text/plain, */*',
  },
});

app.use(cors());
app.use(express.json({ limit: '1mb' }));

function sanitizeFilename(filename) {
  const normalized = String(filename || '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (!normalized) {
    return `youtube-${Date.now()}.mp4`;
  }

  return /\.(mp4|m4v|mov|webm)$/i.test(normalized) ? normalized : `${normalized}.mp4`;
}

function pickFirstPlayableUrl(output) {
  return String(output || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0 && /^https?:\/\//i.test(line)) || null;
}

function serializeAxiosError(error) {
  const message = error instanceof Error ? error.message : String(error ?? 'Unknown error');
  const response = error && typeof error === 'object' ? error.response : null;

  if (response) {
    return {
      message,
      status: response.status,
      data:
        typeof response.data === 'string'
          ? response.data.slice(0, 500)
          : response.data,
      headers: response.headers,
    };
  }

  return {
    message,
  };
}

function isKodikPayload(data) {
  return Boolean(data) && typeof data === 'object' && !Array.isArray(data);
}

function classifyKodikFailure(serializedError) {
  const message = String(serializedError?.message || '').toLowerCase();
  const data = String(serializedError?.data || '').toLowerCase();
  const status = Number(serializedError?.status || 0);

  if (
    message.includes('timeout') ||
    message.includes('aborted') ||
    message.includes('econnreset') ||
    message.includes('enotfound') ||
    status >= 500 ||
    status === 429 ||
    data.includes('error 520') ||
    data.includes('error 521') ||
    data.includes('error 522') ||
    data.includes('error 524') ||
    data.includes('cloudflare')
  ) {
    return 'KODIK_TIMEOUT';
  }

  return 'KODIK_BLOCKED';
}

function parseKodikPayload(data) {
  if (isKodikPayload(data)) {
    return data;
  }

  if (typeof data === 'string') {
    try {
      const parsed = JSON.parse(data);
      if (isKodikPayload(parsed)) {
        return parsed;
      }
    } catch {
      return null;
    }
  }

  return null;
}

function normalizeKodikQueryParams(query) {
  return Object.fromEntries(
    Object.entries(query || {})
      .map(([key, value]) => {
        const normalizedValue = Array.isArray(value) ? value[0] : value;
        return [key, String(normalizedValue ?? '').trim()];
      })
      .filter(([, value]) => value.length > 0)
  );
}

function buildKodikHeaders(origin, profile) {
  const { host } = new URL(origin);

  return {
    'User-Agent': USER_AGENT,
    Accept: profile.accept,
    'Accept-Language': profile.acceptLanguage,
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache',
    DNT: '1',
    Referer: `${origin}/`,
    Origin: origin,
    Host: host,
    Connection: 'keep-alive',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-site',
    'Sec-CH-UA': '"Chromium";v="120", "Not_A Brand";v="24", "Google Chrome";v="120"',
    'Sec-CH-UA-Mobile': '?0',
    'Sec-CH-UA-Platform': '"Windows"',
  };
}

async function executeKodikRequest(candidate) {
  const response = await httpClient.get(candidate.url, {
    params: candidate.params,
    headers: buildKodikHeaders(candidate.origin, candidate.profile),
    timeout: candidate.timeoutMs,
  });

  const payload = parseKodikPayload(response.data);
  if (!payload) {
    throw new Error(`Unexpected Kodik payload from ${candidate.label}`);
  }

  return payload;
}

async function runKodikStage(stageName, candidates) {
  const failures = [];

  try {
    return await Promise.any(
      candidates.map(async (candidate) => {
        try {
          return await executeKodikRequest(candidate);
        } catch (error) {
          const serialized = serializeAxiosError(error);
          failures.push({
            stage: stageName,
            label: candidate.label,
            serialized,
          });
          console.error(`Kodik ${stageName} failed: ${candidate.label}`, serialized);
          throw error;
        }
      })
    );
  } catch {
    const stageError = new Error(`Kodik ${stageName} failed.`);
    stageError.details = failures[failures.length - 1]?.serialized ?? null;
    stageError.failures = failures;
    throw stageError;
  }
}

async function fetchKodikPayload(queryParams) {
  const params = {
    token: KODIK_TOKEN,
    with_material_data: 'true',
    with_episodes_data: 'true',
    not_blocked_for_me: 'true',
    ...queryParams,
  };

  const serializedParams = new URLSearchParams(params).toString();
  const directStages = KODIK_HEADER_PROFILES.map((profile) => ({
    name: `direct-${profile.name}`,
    candidates: KODIK_MIRRORS.map((mirror) => ({
      label: `${mirror.name}:${profile.name}`,
      url: mirror.searchUrl,
      origin: mirror.origin,
      profile,
      params,
      timeoutMs: KODIK_TIMEOUT_MS,
    })),
  }));
  const proxyStages = KODIK_PROXY_FALLBACKS.map((fallback) => ({
    name: `proxy-${fallback.name}`,
    candidates: KODIK_MIRRORS.map((mirror) => {
      const targetUrl = `${mirror.searchUrl}?${serializedParams}`;
      const proxyRequest = fallback.buildRequest(targetUrl);

      return {
        label: `${fallback.name}:${mirror.name}`,
        url: proxyRequest.url,
        origin: proxyRequest.origin,
        profile: KODIK_HEADER_PROFILES[0],
        params: proxyRequest.params,
        timeoutMs: KODIK_TIMEOUT_MS,
      };
    }),
  }));

  let lastError = null;

  for (const stage of [...directStages, ...proxyStages]) {
    try {
      return await runKodikStage(stage.name, stage.candidates);
    } catch (error) {
      lastError = error?.details ?? serializeAxiosError(error);
    }
  }

  const finalError = new Error('All Kodik mirrors failed.');
  finalError.details = lastError;
  finalError.code = classifyKodikFailure(lastError);
  throw finalError;
}

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'anime-backend',
    timestamp: new Date().toISOString(),
  });
});

async function handleKodikSearch(req, res) {
  const queryParams = normalizeKodikQueryParams(req.query);
  const shikimoriId = String(queryParams.shikimori_id || '').trim();
  const title = String(queryParams.title || '').trim();

  if (!shikimoriId && !title) {
    return res.status(400).json({
      ok: false,
      error: 'Either shikimori_id or title is required.',
    });
  }

  try {
    const payload = await fetchKodikPayload(queryParams);
    return res.json(payload);
  } catch (error) {
    const serialized = serializeAxiosError(error);
    console.error('Kodik proxy error:', serialized);

    if (error?.code === 'KODIK_TIMEOUT' || classifyKodikFailure(serialized) === 'KODIK_TIMEOUT') {
      return res.status(502).json({ error: 'Kodik timeout' });
    }

    return res.status(502).json({ error: 'Kodik blocked' });
  }
}

app.get('/api/kodik/search', handleKodikSearch);
app.get('/api/media/kodik/search', handleKodikSearch);

async function handleYouTubeExtract(req, res) {
  const url = String(req.body?.url || '').trim();

  if (!url) {
    return res.status(400).json({
      ok: false,
      error: 'url is required.',
    });
  }

  try {
    const [rawUrlOutput, metadata] = await Promise.all([
      youtubedl(url, {
        getUrl: true,
        noWarnings: true,
        noCheckCertificates: true,
        noPlaylist: true,
        format: 'best[ext=mp4]/best',
      }),
      youtubedl(url, {
        dumpSingleJson: true,
        noWarnings: true,
        noCheckCertificates: true,
        noPlaylist: true,
        skipDownload: true,
      }),
    ]);

    const directUrl = pickFirstPlayableUrl(rawUrlOutput);

    if (!directUrl) {
      return res.status(502).json({
        ok: false,
        error: 'yt-dlp did not return a direct playable URL.',
      });
    }

    const title = metadata?.title || metadata?.fulltitle || 'YouTube';
    const filename = sanitizeFilename(metadata?._filename || title);

    return res.json({
      ok: true,
      url: directUrl,
      title,
      filename,
    });
  } catch (error) {
    console.error('YouTube extract error:', error);
    return res.status(502).json({
      ok: false,
      error: 'Failed to extract YouTube media URL.',
      details: {
        message: error instanceof Error ? error.message : 'Unknown error',
      },
    });
  }
}

app.post('/api/youtube/extract', handleYouTubeExtract);
app.post('/api/media/youtube/extract', handleYouTubeExtract);

async function handleDownloadExtract(req, res) {
  const kodikLink = String(req.body?.kodik_link || '').trim();
  if (!kodikLink) {
    return res.status(400).json({ ok: false, error: 'kodik_link is required' });
  }

  try {
    // In a real scenario, this would use puppeteer or a specialized extractor.
    // For now, we attempt to find the direct stream from the kodik page.
    const response = await axios.get(kodikLink, {
       headers: { 'User-Agent': USER_AGENT }
    });

    // Simple regex attempt to find .m3u8 or .mp4 links in the page source
    const m3u8Match = response.data.match(/https?:\/\/[^"']+\.m3u8[^"']*/i);
    const mp4Match = response.data.match(/https?:\/\/[^"']+\.mp4[^"']*/i);

    const directUrl = (m3u8Match && m3u8Match[0]) || (mp4Match && mp4Match[0]);

    if (!directUrl) {
       // Fallback: return the link itself if it might be a direct stream already
       // or if we can't extract (frontend will try to use it)
       return res.json({ ok: true, direct_url: kodikLink });
    }

    return res.json({ ok: true, direct_url: directUrl });
  } catch (error) {
    console.error('Download extract error:', error);
    return res.status(502).json({ ok: false, error: 'Extraction failed' });
  }
}

app.post('/api/download/extract', handleDownloadExtract);
app.post('/api/media/download/extract', handleDownloadExtract);

io.on('connection', (socket) => {
  socket.on('join_room', (roomId) => {
    const room = String(roomId || '').trim();
    if (!room) {
      return;
    }

    socket.join(room);
    socket.to(room).emit('room_event', {
      type: 'join_room',
      socketId: socket.id,
      room,
    });
  });

  socket.on('leave_room', (roomId) => {
    const room = String(roomId || '').trim();
    if (!room) {
      return;
    }

    socket.leave(room);
    socket.to(room).emit('room_event', {
      type: 'leave_room',
      socketId: socket.id,
      room,
    });
  });

  socket.on('sync_player', (payload) => {
    const room = String(payload?.room || '').trim();
    if (!room) {
      return;
    }

    socket.to(room).emit('sync_player', {
      ...payload,
      socketId: socket.id,
    });
  });
});

app.use((error, _req, res, _next) => {
  console.error('Unhandled backend error:', error);
  res.status(500).json({
    ok: false,
    error: 'Internal server error.',
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`anime-backend listening on port ${PORT}`);
});
