import type { PrismaClient } from '../../generated/prisma/client.js';

// Cuentas fijas (agua, luz, internet…) y el pago de cada mes. Todo filtra por el userId dueño.

export const BILL_KINDS = [
  'agua',
  'luz',
  'gas',
  'internet',
  'celular',
  'gastos_comunes',
  'arriendo',
  'seguro',
  'educacion',
  'tag',
  'salud',
  'otra',
] as const;
export type BillKind = (typeof BILL_KINDS)[number];

export const BILL_EVERY_MONTHS = [1, 2, 12] as const;
export type BillEveryMonths = (typeof BILL_EVERY_MONTHS)[number];

export interface BillPaymentRecord {
  id: string;
  /** Mes que se paga ('YYYY-MM'). */
  period: string;
  amount: bigint;
  /** Día en que se pagó ('YYYY-MM-DD'). */
  paidOn: string;
  createdAt: Date;
}

export interface BillRecord {
  id: string;
  name: string;
  kind: BillKind;
  company: string | null;
  /** Monto estimado. */
  amount: bigint;
  currency: string;
  dueDay: number;
  everyMonths: BillEveryMonths;
  /** Primer mes en que vence ('YYYY-MM'). */
  startMonth: string;
  accountId: string | null;
  autopay: boolean;
  active: boolean;
  notes: string | null;
  createdAt: Date;
  /** Pagos, del mes más reciente al más antiguo. */
  payments: BillPaymentRecord[];
}

export type BillInput = Omit<BillRecord, 'id' | 'createdAt' | 'payments'>;
export type BillChanges = Partial<BillInput>;

export interface BillsRepository {
  list(userId: string): Promise<BillRecord[]>;
  find(userId: string, id: string): Promise<BillRecord | null>;
  create(userId: string, data: BillInput): Promise<BillRecord>;
  update(userId: string, id: string, changes: BillChanges): Promise<BillRecord | null>;
  delete(userId: string, id: string): Promise<boolean>;
  /** Anota (o corrige) el pago de un mes. La cuenta ya debe estar verificada como propia. */
  setPayment(userId: string, billId: string, data: { period: string; amount: bigint; paidOn: string }): Promise<void>;
  deletePayment(userId: string, billId: string, period: string): Promise<boolean>;
}

const toDate = (day: string) => new Date(`${day}T00:00:00.000Z`);
const toDay = (date: Date) => date.toISOString().slice(0, 10);
const monthToDate = (month: string) => toDate(`${month}-01`);

export function createPrismaBillsRepository(prisma: PrismaClient): BillsRepository {
  const include = { payments: { orderBy: { period: 'desc' as const } } };

  type Row = Awaited<ReturnType<typeof prisma.bill.findFirstOrThrow<{ include: typeof include }>>>;
  const fromRow = (row: Row): BillRecord => ({
    id: row.id,
    name: row.name,
    kind: row.kind as BillKind,
    company: row.company,
    amount: row.amount,
    currency: row.currency,
    dueDay: row.dueDay,
    everyMonths: row.everyMonths as BillEveryMonths,
    startMonth: toDay(row.startMonth).slice(0, 7),
    accountId: row.accountId,
    autopay: row.autopay,
    active: row.active,
    notes: row.notes,
    createdAt: row.createdAt,
    payments: row.payments.map((payment) => ({
      id: payment.id,
      period: toDay(payment.period).slice(0, 7),
      amount: payment.amount,
      paidOn: toDay(payment.paidOn),
      createdAt: payment.createdAt,
    })),
  });

  const find = async (userId: string, id: string) => {
    const row = await prisma.bill.findFirst({ where: { id, userId }, include });
    return row ? fromRow(row) : null;
  };

  return {
    async list(userId) {
      const rows = await prisma.bill.findMany({ where: { userId }, include, orderBy: [{ dueDay: 'asc' }, { name: 'asc' }] });
      return rows.map(fromRow);
    },

    find,

    async create(userId, data) {
      const row = await prisma.bill.create({
        data: { ...data, userId, startMonth: monthToDate(data.startMonth) },
        include,
      });
      return fromRow(row);
    },

    async update(userId, id, changes) {
      const { startMonth, ...rest } = changes;
      const { count } = await prisma.bill.updateMany({
        where: { id, userId },
        data: { ...rest, ...(startMonth ? { startMonth: monthToDate(startMonth) } : {}) },
      });
      return count > 0 ? find(userId, id) : null;
    },

    async delete(userId, id) {
      const { count } = await prisma.bill.deleteMany({ where: { id, userId } });
      return count > 0;
    },

    async setPayment(userId, billId, data) {
      const period = monthToDate(data.period);
      await prisma.billPayment.upsert({
        where: { billId_period: { billId, period } },
        create: { billId, userId, period, amount: data.amount, paidOn: toDate(data.paidOn) },
        update: { amount: data.amount, paidOn: toDate(data.paidOn) },
      });
    },

    async deletePayment(userId, billId, period) {
      const { count } = await prisma.billPayment.deleteMany({ where: { billId, userId, period: monthToDate(period) } });
      return count > 0;
    },
  };
}
