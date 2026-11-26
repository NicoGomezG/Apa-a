import type { PrismaClient } from '../../generated/prisma/client.js';
import type {
  AccountInput,
  AccountKind,
  AccountRecord,
  Category,
  Frequency,
  InstallmentPlanInput,
  InstallmentPlanRecord,
  StatementInput,
  StatementRecord,
  SubscriptionInput,
  SubscriptionRecord,
  TransactionChanges,
  TransactionInput,
  TransactionKind,
  TransactionRecord,
} from './finance.types.js';

export interface TransactionQuery {
  from: string;
  to: string;
  accountId?: string;
}

export interface ImportBatch {
  transactions: (TransactionInput & { dedupeKey: string })[];
  plans: (InstallmentPlanInput & { dedupeKey: string })[];
  statement: StatementInput | null;
}

export interface ImportResult {
  transactionsCreated: number;
  transactionsSkipped: number;
  plansCreated: number;
  plansSkipped: number;
  statement: 'created' | 'updated' | null;
}

export interface FinanceExport {
  accounts: AccountRecord[];
  transactions: TransactionRecord[];
  installmentPlans: InstallmentPlanRecord[];
  statements: StatementRecord[];
  subscriptions: SubscriptionRecord[];
}

/**
 * Todo método recibe `userId` y filtra por él: nunca se lee ni se modifica
 * un registro de otra persona, aunque se conozca su id.
 */
export interface FinanceRepository {
  listAccounts(userId: string): Promise<AccountRecord[]>;
  findAccount(userId: string, id: string): Promise<AccountRecord | null>;
  createAccount(userId: string, data: AccountInput): Promise<AccountRecord>;
  updateAccount(userId: string, id: string, changes: Partial<AccountInput>): Promise<AccountRecord | null>;
  /** Borra la cuenta con sus movimientos, cuotas y estados de cuenta. */
  deleteAccount(userId: string, id: string): Promise<boolean>;

  listTransactions(userId: string, query: TransactionQuery): Promise<TransactionRecord[]>;
  createTransaction(userId: string, data: TransactionInput): Promise<TransactionRecord>;
  updateTransaction(userId: string, id: string, changes: TransactionChanges): Promise<TransactionRecord | null>;
  deleteTransaction(userId: string, id: string): Promise<boolean>;

  listInstallmentPlans(userId: string): Promise<InstallmentPlanRecord[]>;
  updateInstallmentPlan(
    userId: string,
    id: string,
    changes: { description?: string; category?: Category | null },
  ): Promise<InstallmentPlanRecord | null>;
  deleteInstallmentPlan(userId: string, id: string): Promise<boolean>;

  listStatements(userId: string): Promise<StatementRecord[]>;

  listSubscriptions(userId: string): Promise<SubscriptionRecord[]>;
  createSubscription(userId: string, data: SubscriptionInput): Promise<SubscriptionRecord>;
  updateSubscription(userId: string, id: string, changes: Partial<SubscriptionInput>): Promise<SubscriptionRecord | null>;
  deleteSubscription(userId: string, id: string): Promise<boolean>;

  /** Guarda una importación completa; lo ya importado (misma huella) se omite. */
  importBatch(userId: string, accountId: string, batch: ImportBatch): Promise<ImportResult>;

  exportAll(userId: string): Promise<FinanceExport>;
}

// --- Conversión entre Prisma y los registros del dominio --------------------

const toDate = (day: string) => new Date(`${day}T00:00:00.000Z`);
const toDay = (date: Date) => date.toISOString().slice(0, 10);
const toMonth = (date: Date) => date.toISOString().slice(0, 7);
const monthToDate = (month: string) => toDate(`${month}-01`);

type AccountRow = {
  id: string;
  name: string;
  kind: string;
  institution: string | null;
  last4: string | null;
  currency: string;
  creditLimit: bigint | null;
  billingDay: number | null;
  paymentDay: number | null;
  createdAt: Date;
};

const accountFromRow = (row: AccountRow): AccountRecord => ({
  id: row.id,
  name: row.name,
  kind: row.kind as AccountKind,
  institution: row.institution,
  last4: row.last4,
  currency: row.currency,
  creditLimit: row.creditLimit,
  billingDay: row.billingDay,
  paymentDay: row.paymentDay,
  createdAt: row.createdAt,
});

type TransactionRow = {
  id: string;
  accountId: string;
  date: Date;
  description: string;
  amount: bigint;
  currency: string;
  kind: string;
  category: string | null;
  source: string;
  createdAt: Date;
};

const transactionFromRow = (row: TransactionRow): TransactionRecord => ({
  id: row.id,
  accountId: row.accountId,
  date: toDay(row.date),
  description: row.description,
  amount: row.amount,
  currency: row.currency,
  kind: row.kind as TransactionKind,
  category: row.category as Category | null,
  source: row.source === 'import' ? 'import' : 'manual',
  createdAt: row.createdAt,
});

type PlanRow = {
  id: string;
  accountId: string;
  description: string;
  purchaseDate: Date;
  originalAmount: bigint;
  totalAmount: bigint;
  installmentCount: number;
  installmentAmount: bigint;
  lastInstallmentAmount: bigint | null;
  firstDueMonth: Date;
  currency: string;
  category: string | null;
  createdAt: Date;
};

const planFromRow = (row: PlanRow): InstallmentPlanRecord => ({
  id: row.id,
  accountId: row.accountId,
  description: row.description,
  purchaseDate: toDay(row.purchaseDate),
  originalAmount: row.originalAmount,
  totalAmount: row.totalAmount,
  installmentCount: row.installmentCount,
  installmentAmount: row.installmentAmount,
  lastInstallmentAmount: row.lastInstallmentAmount,
  firstDueMonth: toMonth(row.firstDueMonth),
  currency: row.currency,
  category: row.category as Category | null,
  createdAt: row.createdAt,
});

type StatementRow = {
  id: string;
  accountId: string;
  periodStart: Date;
  periodEnd: Date;
  dueDate: Date;
  totalBilled: bigint;
  minimumPayment: bigint;
  currency: string;
};

const statementFromRow = (row: StatementRow): StatementRecord => ({
  id: row.id,
  accountId: row.accountId,
  periodStart: toDay(row.periodStart),
  periodEnd: toDay(row.periodEnd),
  dueDate: toDay(row.dueDate),
  totalBilled: row.totalBilled,
  minimumPayment: row.minimumPayment,
  currency: row.currency,
});

type SubscriptionRow = {
  id: string;
  name: string;
  amount: bigint;
  currency: string;
  frequency: string;
  startDate: Date;
  accountId: string | null;
  category: string | null;
  active: boolean;
  email: string | null;
  notes: string | null;
  createdAt: Date;
};

const subscriptionFromRow = (row: SubscriptionRow): SubscriptionRecord => ({
  id: row.id,
  name: row.name,
  amount: row.amount,
  currency: row.currency,
  frequency: row.frequency as Frequency,
  startDate: toDay(row.startDate),
  accountId: row.accountId,
  category: row.category as Category | null,
  active: row.active,
  email: row.email,
  notes: row.notes,
  createdAt: row.createdAt,
});

function withDates<T extends Record<string, unknown>>(changes: T, dayFields: string[], monthFields: string[] = []) {
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) continue;
    if (dayFields.includes(key)) data[key] = toDate(value as string);
    else if (monthFields.includes(key)) data[key] = monthToDate(value as string);
    else data[key] = value;
  }
  return data;
}

export function createPrismaFinanceRepository(prisma: PrismaClient): FinanceRepository {
  return {
    // --- Cuentas --------------------------------------------------------------
    async listAccounts(userId) {
      const rows = await prisma.financialAccount.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
      return rows.map(accountFromRow);
    },

    async findAccount(userId, id) {
      const row = await prisma.financialAccount.findFirst({ where: { id, userId } });
      return row ? accountFromRow(row) : null;
    },

    async createAccount(userId, data) {
      return accountFromRow(await prisma.financialAccount.create({ data: { ...data, userId } }));
    },

    async updateAccount(userId, id, changes) {
      const { count } = await prisma.financialAccount.updateMany({ where: { id, userId }, data: changes });
      if (count === 0) return null;
      return accountFromRow(await prisma.financialAccount.findFirstOrThrow({ where: { id, userId } }));
    },

    async deleteAccount(userId, id) {
      const { count } = await prisma.financialAccount.deleteMany({ where: { id, userId } });
      return count > 0;
    },

    // --- Movimientos ----------------------------------------------------------
    async listTransactions(userId, query) {
      const rows = await prisma.transaction.findMany({
        where: {
          userId,
          date: { gte: toDate(query.from), lte: toDate(query.to) },
          ...(query.accountId ? { accountId: query.accountId } : {}),
        },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      });
      return rows.map(transactionFromRow);
    },

    async createTransaction(userId, data) {
      const row = await prisma.transaction.create({
        data: { ...data, userId, date: toDate(data.date), source: 'manual' },
      });
      return transactionFromRow(row);
    },

    async updateTransaction(userId, id, changes) {
      const { count } = await prisma.transaction.updateMany({
        where: { id, userId },
        data: withDates(changes, ['date']),
      });
      if (count === 0) return null;
      return transactionFromRow(await prisma.transaction.findFirstOrThrow({ where: { id, userId } }));
    },

    async deleteTransaction(userId, id) {
      const { count } = await prisma.transaction.deleteMany({ where: { id, userId } });
      return count > 0;
    },

    // --- Cuotas ---------------------------------------------------------------
    async listInstallmentPlans(userId) {
      const rows = await prisma.installmentPlan.findMany({ where: { userId }, orderBy: { purchaseDate: 'desc' } });
      return rows.map(planFromRow);
    },

    async updateInstallmentPlan(userId, id, changes) {
      const { count } = await prisma.installmentPlan.updateMany({ where: { id, userId }, data: changes });
      if (count === 0) return null;
      return planFromRow(await prisma.installmentPlan.findFirstOrThrow({ where: { id, userId } }));
    },

    async deleteInstallmentPlan(userId, id) {
      const { count } = await prisma.installmentPlan.deleteMany({ where: { id, userId } });
      return count > 0;
    },

    // --- Estados de cuenta ----------------------------------------------------
    async listStatements(userId) {
      const rows = await prisma.cardStatement.findMany({ where: { userId }, orderBy: { periodEnd: 'desc' } });
      return rows.map(statementFromRow);
    },

    // --- Suscripciones --------------------------------------------------------
    async listSubscriptions(userId) {
      const rows = await prisma.subscription.findMany({ where: { userId }, orderBy: { name: 'asc' } });
      return rows.map(subscriptionFromRow);
    },

    async createSubscription(userId, data) {
      const row = await prisma.subscription.create({
        data: { ...data, userId, startDate: toDate(data.startDate) },
      });
      return subscriptionFromRow(row);
    },

    async updateSubscription(userId, id, changes) {
      const { count } = await prisma.subscription.updateMany({
        where: { id, userId },
        data: withDates(changes, ['startDate']),
      });
      if (count === 0) return null;
      return subscriptionFromRow(await prisma.subscription.findFirstOrThrow({ where: { id, userId } }));
    },

    async deleteSubscription(userId, id) {
      const { count } = await prisma.subscription.deleteMany({ where: { id, userId } });
      return count > 0;
    },

    // --- Importación ----------------------------------------------------------
    async importBatch(userId, accountId, batch) {
      return prisma.$transaction(async (tx) => {
        const transactions = batch.transactions.length
          ? await tx.transaction.createMany({
              data: batch.transactions.map((item) => ({
                ...item,
                userId,
                accountId,
                date: toDate(item.date),
                source: 'import',
              })),
              skipDuplicates: true,
            })
          : { count: 0 };

        const plans = batch.plans.length
          ? await tx.installmentPlan.createMany({
              data: batch.plans.map((item) => ({
                ...item,
                userId,
                accountId,
                purchaseDate: toDate(item.purchaseDate),
                firstDueMonth: monthToDate(item.firstDueMonth),
              })),
              skipDuplicates: true,
            })
          : { count: 0 };

        // Si la compra ya existía (importada en un estado anterior) y ahora vemos su
        // última cuota, se guarda el valor real que cobró el banco.
        for (const item of batch.plans) {
          if (item.lastInstallmentAmount === null) continue;
          await tx.installmentPlan.updateMany({
            where: { userId, accountId, dedupeKey: item.dedupeKey, lastInstallmentAmount: null },
            data: { lastInstallmentAmount: item.lastInstallmentAmount },
          });
        }

        let statement: ImportResult['statement'] = null;
        if (batch.statement) {
          const data = {
            periodStart: toDate(batch.statement.periodStart),
            periodEnd: toDate(batch.statement.periodEnd),
            dueDate: toDate(batch.statement.dueDate),
            totalBilled: batch.statement.totalBilled,
            minimumPayment: batch.statement.minimumPayment,
            currency: batch.statement.currency,
          };
          const existing = await tx.cardStatement.findUnique({
            where: { accountId_periodEnd: { accountId, periodEnd: data.periodEnd } },
            select: { id: true },
          });
          if (existing) {
            await tx.cardStatement.update({ where: { id: existing.id }, data });
            statement = 'updated';
          } else {
            await tx.cardStatement.create({ data: { ...data, userId, accountId } });
            statement = 'created';
          }
        }

        return {
          transactionsCreated: transactions.count,
          transactionsSkipped: batch.transactions.length - transactions.count,
          plansCreated: plans.count,
          plansSkipped: batch.plans.length - plans.count,
          statement,
        };
      });
    },

    async exportAll(userId) {
      const [accounts, transactions, plans, statements, subscriptions] = await Promise.all([
        prisma.financialAccount.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
        prisma.transaction.findMany({ where: { userId }, orderBy: { date: 'asc' } }),
        prisma.installmentPlan.findMany({ where: { userId }, orderBy: { purchaseDate: 'asc' } }),
        prisma.cardStatement.findMany({ where: { userId }, orderBy: { periodEnd: 'asc' } }),
        prisma.subscription.findMany({ where: { userId }, orderBy: { name: 'asc' } }),
      ]);
      return {
        accounts: accounts.map(accountFromRow),
        transactions: transactions.map(transactionFromRow),
        installmentPlans: plans.map(planFromRow),
        statements: statements.map(statementFromRow),
        subscriptions: subscriptions.map(subscriptionFromRow),
      };
    },
  };
}
