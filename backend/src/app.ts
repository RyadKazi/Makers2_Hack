import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import { env, parseTrustProxy } from './config/env.js';
import { logger } from './lib/logger.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { apiRateLimit } from './middleware/rateLimit.js';
import { adminRouter } from './modules/admin/admin.router.js';
import { aiRouter } from './modules/ai/ai.router.js';
import { authRouter, meRouter } from './modules/auth/auth.router.js';
import { campusRouter } from './modules/campus/campus.router.js';
import { mobilityRouter } from './modules/mobility/mobility.router.js';
import { reservationsRouter } from './modules/reservations/reservations.router.js';
import { roomsRouter } from './modules/rooms/rooms.router.js';
import { routingRouter } from './modules/routing/routing.router.js';
import { speechRouter } from './modules/speech/speech.router.js';
import { buildOpenApiDocument } from './openapi/document.js';
import { registerRouteDoc } from './openapi/registry.js';
import { HealthSchema } from './openapi/schemas.js';

export type AppDeps = {
  /** Health probe for the database; injected so tests can run without Postgres. */
  checkDatabase: () => Promise<boolean>;
};

const startedAt = Date.now();

registerRouteDoc({
  method: 'get',
  path: '/health',
  tag: 'System',
  summary: 'Liveness and database check',
  description: 'Returns 503 with status "degraded" when the database does not answer.',
  response: HealthSchema,
});
registerRouteDoc({
  method: 'get',
  path: '/openapi.json',
  tag: 'System',
  summary: 'This OpenAPI 3.1 document',
  responseDescription: 'OpenAPI document (JSON)',
});

export function createApp(deps: AppDeps): Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', parseTrustProxy(env.TRUST_PROXY));

  app.use(
    helmet({
      // Keep plain-http LAN access working outside production (Docker, phones on the same Wi-Fi).
      contentSecurityPolicy: env.NODE_ENV === 'production' ? undefined : { directives: { upgradeInsecureRequests: null } },
    }),
  );
  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow no origin (native mobile apps / curl), matching CORS_ORIGINS, or any origin in non-production
        if (!origin || env.CORS_ORIGINS.includes(origin) || env.NODE_ENV !== 'production') {
          callback(null, true);
        } else {
          callback(null, false);
        }
      },
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/health' } }));

  app.get('/health', async (_req, res) => {
    const dbUp = await deps.checkDatabase();
    res.status(dbUp ? 200 : 503).json({
      status: dbUp ? 'ok' : 'degraded',
      service: 'campusway-server',
      uptimeS: Math.round((Date.now() - startedAt) / 1000),
      checks: { database: dbUp ? 'up' : 'down' },
      time: new Date().toISOString(),
    });
  });

  // OpenAPI: generated from the same Zod schemas that validate requests and shape responses.
  const openapi = buildOpenApiDocument();
  app.get('/openapi.json', (_req, res) => {
    res.json(openapi);
  });
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapi, { customSiteTitle: 'CampusWay API', swaggerOptions: { persistAuthorization: true } }));

  const api = express.Router();
  api.use(apiRateLimit);
  api.use('/auth', authRouter);
  api.use('/me', meRouter);
  api.use('/campus', campusRouter);
  api.use('/rooms', roomsRouter);
  api.use('/reservations', reservationsRouter);
  api.use('/routes', routingRouter);
  api.use('/mobility', mobilityRouter);
  api.use('/speech', speechRouter);
  api.use('/ai', aiRouter);
  api.use('/admin', adminRouter);
  app.use('/api', api);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
