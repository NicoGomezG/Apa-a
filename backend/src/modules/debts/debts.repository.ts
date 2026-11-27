import type { PrismaClient } from '../../generated/prisma/client.js';

// Deudas personales (me deben / debo) con abonos. Todo filtra por el userId dueño.

export const DEBT_DIRECTIONS = ['owed_to_me', 'i_owe'] as const;
export type DebtDirection = (typeof DEBT_DIRECTIONS)[number];

export interface DebtPaymentRecord {
  id: string;
  amount: bigint;
  /** 'YYYY-MM-DD' */
  date: string;
  createdAt: Date;
}

export interface DebtRecord {
  id: string;
  direction: DebtDirection;
  contactId: string | null;
  personName: string;
  description: string | null;
  amount: bigint;
  currency: string;
  /** Desde cuándo se debe ('YYYY-MM-DD'). */
  date: string;
  createdAt: Date;
  /** Abonos en orden de fecha. */
  payments: DebtPaymentRecord[];
}

export type DebtInput = Pick<DebtRecord, 'direction' | 'contactId' | 'personName' | 'description' | 'amount' | 'currency' | 'date'>;
export type DebtChanges = Partial<Omit<DebtInput, 'direction'>>;

export interface DebtsRepository {
  list(userId: string): Promise<DebtRecord[]>;
  find(userId: string, id: string): Promise<DebtRecord | null>;
  create(userId: string, data: DebtInput): Promise<DebtRecord>;
  update(userId: string, id: string, changes: DebtChanges): Promise<DebtRecord | null>;
  delete(userId: string, id: string): Promise<boolean>;
  addPayment(userId: string, debtId: string, data: { amount: bigint; date: string }): Promise<DebtPaymentRecord>;
  deletePayment(userId: string, debtId: string, paymentId: string): Promise<boolean>;
}

const toDate = (day: string) => new Date(`${day}T00:00:00.000Z`);
const toDay = (date: Date) => date.toISOString().slice(0, 10);

export function createPrismaDebtsRepository(prisma: PrismaClient): DebtsRepository {
  const include = { payments: { orderBy: [{ date: 'asc' as const }, { createdAt: 'asc' as const }] } };

  type Row = Awaited<ReturnType<typeof prisma.debt.findFirstOrThrow<{ include: typeof include }>>>;
  const fromRow = (row: Row): DebtRecord => ({
    id: row.id,
    direction: row.direction as DebtDirection,
    contactId: row.contactId,
    personName: row.personName,
    description: row.description,
    amount: row.amount,
    currency: row.currency,
    date: toDay(row.date),
    createdAt: row.createdAt,
    payments: row.payments.map((payment) => ({
      id: payment.id,
      amount: payment.amount,
      date: toDay(payment.date),
      createdAt: payment.createdAt,
    })),
  });

  const find = async (userId: string, id: string) => {
    const row = await prisma.debt.findFirst({ where: { id, userId }, include });
    return row ? fromRow(row) : null;
  };

  return {
    async list(userId) {
      const rows = await prisma.debt.findMany({ where: { userId }, include, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }] });
      return rows.map(fromRow);
    },

    find,

    async create(userId, data) {
      const row = await prisma.debt.create({ data: { ...data, userId, date: toDate(data.date) }, include });
      return fromRow(row);
    },

    async update(userId, id, changes) {
      const { date, ...rest } = changes;
      const { count } = await prisma.debt.updateMany({
        where: { id, userId },
        data: { ...rest, ...(date ? { date: toDate(date) } : {}) },
      });
      return count > 0 ? find(userId, id) : null;
    },

    async delete(userId, id) {
      const { count } = await prisma.debt.deleteMany({ where: { id, userId } });
      return count > 0;
    },

    async addPayment(userId, debtId, data) {
      const payment = await prisma.debtPayment.create({ data: { debtId, userId, amount: data.amount, date: toDate(data.date) } });
      return { id: payment.id, amount: payment.amount, date: toDay(payment.date), createdAt: payment.createdAt };
    },

    async deletePayment(userId, debtId, paymentId) {
      const { count } = await prisma.debtPayment.deleteMany({ where: { id: paymentId, debtId, userId } });
      return count > 0;
    },
  };
}
