import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { loadEnv } from './config/env.js';
import { createSupabaseAuthAdmin } from './lib/auth/auth-admin.js';
import { createSupabaseTokenVerifier } from './lib/auth/token-verifier.js';
import { createPrisma } from './lib/prisma.js';
import { createPrismaAccountRepository } from './modules/account/account.repository.js';
import { createMindicadorRates } from './lib/exchange-rates.js';
import { createPrismaDebtsRepository } from './modules/debts/debts.repository.js';
import { createPrismaChatRepository } from './modules/chat/chat.repository.js';
import { createPrismaAuditRepository } from './modules/audit/audit.repository.js';
import { createPrismaFinanceRepository } from './modules/finance/finance.repository.js';
import { createPrismaFriendsRepository } from './modules/friends/friends.repository.js';
import { createPrismaPeopleRepository } from './modules/people/people.repository.js';
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
    finance: createPrismaFinanceRepository(prisma),
    people: createPrismaPeopleRepository(prisma),
    friends: createPrismaFriendsRepository(prisma),
    chat: createPrismaChatRepository(prisma),
    debts: createPrismaDebtsRepository(prisma),
    rates: createMindicadorRates(),
  });
  app.addHook('onClose', async () => prisma.$disconnect());
  return app;
}
