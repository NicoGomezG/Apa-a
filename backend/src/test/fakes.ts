import type { AppDeps } from '../app.js';
import type { Env } from '../config/env.js';
import type { AuthUser } from '../lib/auth/token-verifier.js';
import type { AuditEntry } from '../modules/audit/audit.repository.js';
import type { Preferences, ProfileRecord } from '../modules/profile/profile.repository.js';

export const testEnv: Env = {
  NODE_ENV: 'test',
  PORT: 0,
  LOG_LEVEL: 'silent',
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_SECRET_KEY: undefined,
  SUPABASE_JWT_SECRET: undefined,
  CORS_ORIGINS: ['http://localhost:4200'],
};

export const ALICE: AuthUser = {
  id: '0192f0a4-1c2b-7d3e-8f40-5a6b7c8d9e01',
  email: 'alice@example.com',
  suggestedName: 'Alice',
};
export const BOB: AuthUser = {
  id: '0192f0a4-1c2b-7d3e-8f40-5a6b7c8d9e02',
  email: 'bob@example.com',
  suggestedName: null,
};

/** Dependencias en memoria. Los tokens válidos son `token-<id>`. */
export function createFakeDeps(users: AuthUser[] = [ALICE, BOB]) {
  const profiles = new Map<string, ProfileRecord>();
  const auditLog: AuditEntry[] = [];
  const deletedAuthUsers: string[] = [];
  let failAuthDelete = false;

  const deps: AppDeps = {
    async verifyToken(token) {
      const user = users.find((candidate) => token === `token-${candidate.id}`);
      if (!user) throw new Error('invalid token');
      return user;
    },
    authAdmin: {
      async deleteUser(userId) {
        if (failAuthDelete) throw new Error('auth down');
        deletedAuthUsers.push(userId);
      },
    },
    profiles: {
      async find(userId) {
        return profiles.get(userId) ?? null;
      },
      async create(userId, displayName) {
        const existing = profiles.get(userId);
        if (existing) return { profile: existing, created: false };
        const profile: ProfileRecord = {
          id: userId,
          displayName,
          createdAt: new Date('2026-10-18T12:00:00Z'),
          preferences: { timezone: 'America/Santiago', locale: 'es-CL', currency: 'CLP' },
        };
        profiles.set(userId, profile);
        return { profile, created: true };
      },
      async updateDisplayName(userId, displayName) {
        const profile = { ...profiles.get(userId)!, displayName };
        profiles.set(userId, profile);
        return profile;
      },
      async updatePreferences(userId, changes: Partial<Preferences>) {
        const current = profiles.get(userId)!;
        const profile = { ...current, preferences: { ...current.preferences, ...changes } };
        profiles.set(userId, profile);
        return profile;
      },
    },
    audit: {
      async record(entry) {
        auditLog.push(entry);
      },
      async listForUser(userId, limit) {
        return auditLog
          .filter((entry) => entry.userId === userId)
          .slice(-limit)
          .reverse()
          .map((entry) => ({ action: entry.action, entityType: entry.entityType ?? null, createdAt: new Date() }));
      },
    },
    account: {
      async deleteAllData(userId) {
        profiles.delete(userId);
      },
    },
  };

  return {
    deps,
    profiles,
    auditLog,
    deletedAuthUsers,
    setFailAuthDelete(value: boolean) {
      failAuthDelete = value;
    },
  };
}

export const bearer = (user: AuthUser) => ({ authorization: `Bearer token-${user.id}` });
