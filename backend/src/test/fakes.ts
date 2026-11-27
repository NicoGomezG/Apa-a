import type { AppDeps } from '../app.js';
import type { Env } from '../config/env.js';
import type { ExchangeRate } from '../lib/exchange-rates.js';
import type { AuthUser } from '../lib/auth/token-verifier.js';
import type { AuditEntry } from '../modules/audit/audit.repository.js';
import type { FinanceRepository } from '../modules/finance/finance.repository.js';
import type {
  AccountRecord,
  InstallmentPlanRecord,
  StatementRecord,
  SubscriptionRecord,
  TransactionRecord,
} from '../modules/finance/finance.types.js';
import type { Preferences, ProfileRecord } from '../modules/profile/profile.repository.js';
import { createFakeChat } from './fake-chat.js';
import { createFakeDebts } from './fake-debts.js';
import { createFakeHealth } from './fake-health.js';
import { createFakeBills } from './fake-bills.js';
import { createFakeFriends, createFakePeople } from './fake-people.js';

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

type Owned<T> = T & { userId: string };

/** Repositorio de finanzas en memoria, con las mismas reglas de pertenencia que el real. */
export function createFakeFinance() {
  let sequence = 0;
  const nextId = () => `00000000-0000-7000-8000-${String((sequence += 1)).padStart(12, '0')}`;
  const accounts: Owned<AccountRecord>[] = [];
  const transactions: Owned<TransactionRecord & { dedupeKey: string | null }>[] = [];
  const plans: Owned<InstallmentPlanRecord & { dedupeKey: string }>[] = [];
  const statements: Owned<StatementRecord>[] = [];
  const subscriptions: Owned<SubscriptionRecord>[] = [];

  const strip = <T extends { userId: string }>(item: T) => {
    const { userId: _userId, dedupeKey: _key, ...rest } = item as T & { dedupeKey?: unknown };
    return rest as unknown as Omit<T, 'userId' | 'dedupeKey'>;
  };
  const find = <T extends { id: string; userId: string }>(list: T[], userId: string, id: string) =>
    list.find((item) => item.id === id && item.userId === userId);
  const remove = <T extends { id: string; userId: string }>(list: T[], userId: string, id: string) => {
    const index = list.findIndex((item) => item.id === id && item.userId === userId);
    if (index < 0) return false;
    list.splice(index, 1);
    return true;
  };
  const removeWhere = <T>(list: T[], predicate: (item: T) => boolean) => {
    for (let i = list.length - 1; i >= 0; i -= 1) if (predicate(list[i]!)) list.splice(i, 1);
  };
  const update = <T extends { id: string; userId: string }>(list: T[], userId: string, id: string, changes: object) => {
    const item = find(list, userId, id);
    if (!item) return null;
    for (const [key, value] of Object.entries(changes)) {
      if (value !== undefined) (item as Record<string, unknown>)[key] = value;
    }
    return strip(item);
  };
  const created = new Date('2026-11-01T12:00:00Z');

  const repo: FinanceRepository = {
    async listAccounts(userId) {
      return accounts.filter((a) => a.userId === userId).map(strip);
    },
    async findAccount(userId, id) {
      const account = find(accounts, userId, id);
      return account ? strip(account) : null;
    },
    async createAccount(userId, data) {
      const account = { ...data, id: nextId(), userId, createdAt: created };
      accounts.push(account);
      return strip(account);
    },
    async updateAccount(userId, id, changes) {
      return update(accounts, userId, id, changes);
    },
    async deleteAccount(userId, id) {
      const deleted = remove(accounts, userId, id);
      if (deleted) {
        removeWhere(transactions, (t) => t.accountId === id);
        removeWhere(plans, (p) => p.accountId === id);
        removeWhere(statements, (s) => s.accountId === id);
        for (const sub of subscriptions) if (sub.accountId === id) sub.accountId = null;
      }
      return deleted;
    },
    async listTransactions(userId, query) {
      return transactions
        .filter(
          (t) =>
            t.userId === userId &&
            t.date >= query.from &&
            t.date <= query.to &&
            (!query.accountId || t.accountId === query.accountId),
        )
        .sort((a, b) => b.date.localeCompare(a.date))
        .map(strip);
    },
    async createTransaction(userId, data) {
      const transaction = { ...data, id: nextId(), userId, source: 'manual' as const, createdAt: created, dedupeKey: null };
      transactions.push(transaction);
      return strip(transaction);
    },
    async updateTransaction(userId, id, changes) {
      return update(transactions, userId, id, changes);
    },
    async deleteTransaction(userId, id) {
      return remove(transactions, userId, id);
    },
    async listInstallmentPlans(userId) {
      return plans.filter((p) => p.userId === userId).map(strip);
    },
    async updateInstallmentPlan(userId, id, changes) {
      return update(plans, userId, id, changes);
    },
    async deleteInstallmentPlan(userId, id) {
      return remove(plans, userId, id);
    },
    async listStatements(userId) {
      return statements.filter((s) => s.userId === userId).map(strip);
    },
    async listSubscriptions(userId) {
      return subscriptions.filter((s) => s.userId === userId).map(strip);
    },
    async createSubscription(userId, data) {
      const subscription = { ...data, id: nextId(), userId, createdAt: created };
      subscriptions.push(subscription);
      return strip(subscription);
    },
    async updateSubscription(userId, id, changes) {
      return update(subscriptions, userId, id, changes);
    },
    async deleteSubscription(userId, id) {
      return remove(subscriptions, userId, id);
    },
    async importBatch(userId, accountId, batch) {
      let transactionsCreated = 0;
      for (const item of batch.transactions) {
        if (transactions.some((t) => t.accountId === accountId && t.dedupeKey === item.dedupeKey)) continue;
        transactions.push({ ...item, id: nextId(), userId, accountId, source: 'import', createdAt: created });
        transactionsCreated += 1;
      }
      let plansCreated = 0;
      for (const item of batch.plans) {
        const existing = plans.find((p) => p.accountId === accountId && p.dedupeKey === item.dedupeKey);
        if (existing) {
          if (existing.lastInstallmentAmount === null) existing.lastInstallmentAmount = item.lastInstallmentAmount;
          continue;
        }
        plans.push({ ...item, id: nextId(), userId, accountId, createdAt: created });
        plansCreated += 1;
      }
      let statement: 'created' | 'updated' | null = null;
      const incoming = batch.statement;
      if (incoming) {
        const existing = statements.find((s) => s.accountId === accountId && s.periodEnd === incoming.periodEnd);
        if (existing) {
          Object.assign(existing, incoming);
          statement = 'updated';
        } else {
          statements.push({ ...incoming, id: nextId(), userId, accountId });
          statement = 'created';
        }
      }
      return {
        transactionsCreated,
        transactionsSkipped: batch.transactions.length - transactionsCreated,
        plansCreated,
        plansSkipped: batch.plans.length - plansCreated,
        statement,
      };
    },
    async exportAll(userId) {
      return {
        accounts: await repo.listAccounts(userId),
        transactions: transactions.filter((t) => t.userId === userId).map(strip),
        installmentPlans: await repo.listInstallmentPlans(userId),
        statements: await repo.listStatements(userId),
        subscriptions: await repo.listSubscriptions(userId),
      };
    },
  };

  const clearUser = (userId: string) => {
    removeWhere(accounts, (item) => item.userId === userId);
    removeWhere(transactions, (item) => item.userId === userId);
    removeWhere(plans, (item) => item.userId === userId);
    removeWhere(statements, (item) => item.userId === userId);
    removeWhere(subscriptions, (item) => item.userId === userId);
  };

  return { repo, accounts, transactions, plans, statements, subscriptions, clearUser };
}

/** Dependencias en memoria. Los tokens válidos son `token-<id>`. */
export function createFakeDeps(users: AuthUser[] = [ALICE, BOB], now?: () => Date) {
  const finance = createFakeFinance();
  const people = createFakePeople();
  const profiles = new Map<string, ProfileRecord>();
  const friends = createFakeFriends(people, profiles);
  /** Tipos de cambio de prueba: USD a 950 pesos; otras monedas sin valor. */
  const rates = new Map<string, ExchangeRate>([['USD', { currency: 'USD', micros: 950_000_000n, date: '2026-11-25' }]]);
  const debts = createFakeDebts(people);
  const health = createFakeHealth();
  const bills = createFakeBills((id) => finance.accounts.some((account) => account.id === id));
  const chat = createFakeChat(people, () => (now ? now() : new Date()));
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
          birthDay: null,
          birthMonth: null,
          birthYear: null,
          phone: null,
          sharePhone: false,
          createdAt: new Date('2026-10-18T12:00:00Z'),
          preferences: { timezone: 'America/Santiago', locale: 'es-CL', currency: 'CLP' },
        };
        profiles.set(userId, profile);
        return { profile, created: true };
      },
      async update(userId, changes) {
        const profile = { ...profiles.get(userId)!, ...changes };
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
        finance.clearUser(userId);
        friends.clearUser(userId);
        chat.clearUser(userId);
        debts.clearUser(userId);
        health.clearUser(userId);
        bills.clearUser(userId);
        people.clearUser(userId);
      },
    },
    finance: finance.repo,
    people: people.repo,
    friends: friends.repo,
    chat: chat.repo,
    debts: debts.repo,
    health: health.repo,
    bills: bills.repo,
    rates: {
      async toClp(currency) {
        return rates.get(currency) ?? null;
      },
    },
    now,
  };

  return {
    deps,
    finance,
    people,
    friends,
    chat,
    debts,
    health,
    bills,
    rates,
    profiles,
    auditLog,
    deletedAuthUsers,
    setFailAuthDelete(value: boolean) {
      failAuthDelete = value;
    },
  };
}

export const bearer = (user: AuthUser) => ({ authorization: `Bearer token-${user.id}` });
