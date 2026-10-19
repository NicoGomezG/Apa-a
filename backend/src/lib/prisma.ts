import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import type { Env } from '../config/env.js';

export function createPrisma(env: Env): PrismaClient {
  // En serverless cada instancia abre pocas conexiones: el pooler de Supabase
  // (Supavisor, modo transacción) es quien multiplexa.
  const adapter = new PrismaPg({ connectionString: env.DATABASE_URL, max: 3 });
  return new PrismaClient({ adapter, log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'] });
}
