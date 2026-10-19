import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { loadEnv } from './config/env.js';
import { createSupabaseAuthAdmin } from './lib/auth/auth-admin.js';
import { createSupabaseTokenVerifier } from './lib/auth/token-verifier.js';
import { createPrisma } from './lib/prisma.js';
import { createPrismaAccountRepository } from './modules/account/account.repository.js';
import { createPrismaAuditRepository } from './modules/audit/audit.repository.js';
import { createPrismaProfileRepository } from './modules/profile/profile.repository.js';

/** Arma la app con sus dependencias reales (Supabase + Postgres). */
export async function createApp(): Promise<FastifyInstance> {
  const env = loadEnv();
  const prisma = createPrisma(env);

  const app = await buildApp(env, {
    verifyToken: createSupabaseTokenVerifier(env),
    authAdmin: createSupabaseAuthAdmin(env),
    profiles: createPrismaProfileRepository(prisma),
    audit: createPrismaAuditRepository(prisma),
    account: createPrismaAccountRepository(prisma),
  });
  app.addHook('onClose', async () => prisma.$disconnect());
  return app;
}
