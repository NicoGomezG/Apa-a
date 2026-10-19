import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import type { Env } from './config/env.js';
import type { AuthAdmin } from './lib/auth/auth-admin.js';
import type { TokenVerifier } from './lib/auth/token-verifier.js';
import { registerErrorHandler } from './lib/errors.js';
import type { AccountRepository } from './modules/account/account.repository.js';
import { accountRoutes } from './modules/account/account.routes.js';
import type { AuditRepository } from './modules/audit/audit.repository.js';
import type { ProfileRepository } from './modules/profile/profile.repository.js';
import { profileRoutes } from './modules/profile/profile.routes.js';
import { authPlugin } from './plugins/auth.js';

export interface AppDeps {
  verifyToken: TokenVerifier;
  authAdmin: AuthAdmin;
  profiles: ProfileRepository;
  audit: AuditRepository;
  account: AccountRepository;
}

export const API_PREFIX = '/api';

export async function buildApp(env: Env, deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL,
      // Nunca loguear credenciales ni cookies.
      redact: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-api-key"]'],
    },
    // Detrás del proxy de Vercel: la IP real viene en X-Forwarded-For (rate limit).
    trustProxy: true,
    bodyLimit: 1024 * 1024,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandler(app);

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: env.CORS_ORIGINS.length > 0 ? env.CORS_ORIGINS : false,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
  });
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });
  await app.register(authPlugin, { verifyToken: deps.verifyToken });

  if (env.NODE_ENV === 'development') {
    const { default: swagger } = await import('@fastify/swagger');
    const { default: swaggerUi } = await import('@fastify/swagger-ui');
    const { jsonSchemaTransform } = await import('fastify-type-provider-zod');
    await app.register(swagger, {
      openapi: { info: { title: 'Apaña API', version: '0.1.0' } },
      transform: jsonSchemaTransform,
    });
    await app.register(swaggerUi, { routePrefix: '/documentation' });
  }

  await app.register(
    async (api) => {
      api.get('/health', async () => ({ status: 'ok' }));
      await api.register(profileRoutes, deps);
      await api.register(accountRoutes, deps);
    },
    { prefix: API_PREFIX },
  );

  return app;
}
