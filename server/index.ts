import cors from 'cors';
import express, { type ErrorRequestHandler, type Request, type Response } from 'express';
import { fileURLToPath } from 'node:url';
import { createDeepSeekProvider } from '../src/ai/deepseek.js';
import { explainRecommendation } from '../src/ai/recommendation.js';
import { createWynncraftClient } from '../src/data/wynncraft.js';
import type { ToolOutcome, ToolTrace, WynncraftClient } from '../src/data/types.js';
import type { DeepSeekProvider } from '../src/ai/types.js';
import type { RecommendationResult, VersionedDataset } from '../src/domain/contracts.js';

export type ServerMode = 'fixture' | 'live';

export type ServerConfig = {
  mode: ServerMode;
  port: number;
  baseUrl: string;
  providerModel: string;
};

export type ServerOptions = {
  mode?: ServerMode;
  /** Optional port override for embedding/tests; production defaults to env PORT. */
  port?: number;
  client?: WynncraftClient;
  provider?: DeepSeekProvider;
  dataset?: VersionedDataset;
  explain?: typeof explainRecommendation;
  /** Set false only for an intentionally isolated integration test. */
  enableCors?: boolean;
};

const DEFAULT_PORT = 4317;
const DEFAULT_BASE_URL = 'https://api.wynncraft.com/v3';
const DEFAULT_MODEL = 'deepseek-v4-flash';
const MINECRAFT_PLAYER_NAME_PATTERN = /^[A-Za-z0-9_]{1,16}$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const modeFromEnv = (value: string | undefined): ServerMode =>
  value?.toLowerCase() === 'live' ? 'live' : 'fixture';

export const readServerConfig = (): ServerConfig => {
  const parsedPort = Number.parseInt(process.env.PORT ?? '', 10);
  return {
    mode: modeFromEnv(process.env.DATA_MODE),
    port:
      Number.isFinite(parsedPort) && parsedPort > 0 && parsedPort <= 65_535
        ? parsedPort
        : DEFAULT_PORT,
    baseUrl: process.env.WYNNCRAFT_API_BASE_URL?.trim() || DEFAULT_BASE_URL,
    providerModel: process.env.DEEPSEEK_MODEL?.trim() || DEFAULT_MODEL,
  };
};

const localOrigin = (origin: string): boolean => {
  try {
    const parsed = new URL(origin);
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      ['localhost', '127.0.0.1', '[::1]', '::1'].includes(parsed.hostname)
    );
  } catch {
    return false;
  }
};

const normalizePlayerName = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return MINECRAFT_PLAYER_NAME_PATTERN.test(normalized) ? normalized : undefined;
};

const outcomeStatus = (error: string): number => {
  if (/\b403\b|restricted|denied/i.test(error)) return 403;
  if (/\b404\b|not found/i.test(error)) return 404;
  if (/\b300\b|multipleobjects/i.test(error)) return 409;
  if (/\b400\b|invalid|selector/i.test(error)) return 400;
  if (/\b429\b|rate limit/i.test(error)) return 429;
  if (/timed out|timeout/i.test(error)) return 504;
  return 502;
};

const sendOutcome = <T>(res: Response, mode: ServerMode, outcome: ToolOutcome<T>): void => {
  if (!outcome.ok) {
    res.status(outcomeStatus(outcome.error)).json({
      mode,
      error: outcome.error,
      trace: outcome.trace,
    });
    return;
  }
  res.status(200).json({ mode, data: outcome.data, trace: outcome.trace });
};

const fixtureProfileUnavailableTrace = (): ToolTrace => ({
  id: 'wynncraft-profile-fixture',
  tool: 'wynncraft.getPublicProfile',
  status: 'fallback',
  mode: 'fixture',
  startedAt: new Date().toISOString(),
  durationMs: 0,
  sourceIds: ['wynncraft-api'],
  message: 'live profile lookup is unavailable in fixture mode',
  cache: 'bypass',
});

const safeErrorHandler: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
  void _next;
  const status =
    isRecord(error) && typeof error.status === 'number' && error.status === 413 ? 413 : 400;
  response.status(status).json({
    error: status === 413 ? 'Request body is too large.' : 'Request could not be processed safely.',
  });
};

export const createApp = (options: ServerOptions = {}): express.Express => {
  const envConfig = readServerConfig();
  const mode: ServerMode =
    options.mode === 'live' ? 'live' : options.mode === 'fixture' ? 'fixture' : envConfig.mode;
  const client = options.client ?? createWynncraftClient({ baseUrl: envConfig.baseUrl });
  const provider =
    options.provider ??
    createDeepSeekProvider({
      apiKey: process.env.DEEPSEEK_API_KEY,
      model: envConfig.providerModel,
    });
  const dataset = options.dataset;
  const explain = options.explain ?? explainRecommendation;
  const app = express();

  app.disable('x-powered-by');
  if (options.enableCors !== false) {
    app.use(
      cors({
        origin: (origin, callback) => {
          if (!origin || localOrigin(origin)) {
            callback(null, true);
          } else {
            callback(new Error('Origin is not allowed.'));
          }
        },
        credentials: false,
        methods: ['GET', 'POST', 'OPTIONS'],
      }),
    );
  }
  // Keep this limit deliberately small: recommendation payloads are compact,
  // and an oversized body must not become an accidental prompt relay.
  app.use(express.json({ limit: '64kb', strict: true }));

  app.get('/api/health', (_request, response) => {
    response.json({
      status: 'ok',
      service: 'loadout-atelier',
      mode,
      dataMode: mode,
      provider: mode === 'live' && provider.available ? 'available' : 'unavailable',
    });
  });

  app.get('/api/profile/:playerName', async (request: Request, response: Response) => {
    const playerName = normalizePlayerName(request.params.playerName);
    if (!playerName) {
      response.status(400).json({
        error:
          'Profile name must be a trimmed Minecraft username (1-16 letters, numbers, or underscores).',
      });
      return;
    }
    if (mode === 'fixture') {
      response.status(503).json({
        mode,
        error: 'Live profile lookup is unavailable in fixture mode.',
        trace: fixtureProfileUnavailableTrace(),
      });
      return;
    }
    try {
      const outcome = await client.getPublicProfile(playerName);
      sendOutcome(response, mode, outcome);
    } catch {
      response.status(502).json({ error: 'Profile service is temporarily unavailable.' });
    }
  });

  app.post('/api/recommend', async (request: Request, response: Response) => {
    if (
      !isRecord(request.body) ||
      !('build' in request.body) ||
      !('goals' in request.body) ||
      Object.keys(request.body).some((key) => key !== 'build' && key !== 'goals')
    ) {
      response.status(400).json({ error: 'Request must include build and goals.' });
      return;
    }
    let result: RecommendationResult;
    try {
      result = await explain({
        build: request.body.build,
        goals: request.body.goals,
        dataset,
        // Fixture mode is deliberately offline even when a test or process
        // happens to have a provider configured.
        ...(mode === 'live' ? { provider } : {}),
      });
    } catch {
      // Do not leak provider or request details through an exception path.
      response.status(502).json({ error: 'Recommendation service is temporarily unavailable.' });
      return;
    }
    response.json({ mode, ...result });
  });

  app.use((_request, response) => {
    response.status(404).json({ error: 'Route not found.' });
  });
  app.use(safeErrorHandler);
  return app;
};

export const startServer = (options: ServerOptions = {}): ReturnType<express.Express['listen']> => {
  const config = readServerConfig();
  const app = createApp(options);
  // The local service can proxy player data and hold a provider credential;
  // never expose it on every network interface by default.
  return app.listen(options.port ?? config.port, '127.0.0.1');
};

// Importing this module is side-effect free for tests and for Vite. Running
// `tsx server/index.ts` starts the local service.
const entryPath = process.argv[1] ? fileURLToPath(new URL(`file://${process.argv[1]}`)) : undefined;
if (entryPath && entryPath === fileURLToPath(import.meta.url)) {
  startServer();
}

export default createApp;
