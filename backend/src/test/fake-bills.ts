import type { BillRecord, BillsRepository } from '../modules/bills/bills.repository.js';

/** Cuentas fijas en memoria, con las mismas reglas de pertenencia que el repositorio real. */
export function createFakeBills(accountExists: (id: string) => boolean) {
  let sequence = 0;
  const nextId = () => `00000000-0000-7000-b111-${String((sequence += 1)).padStart(12, '0')}`;
  const created = new Date('2026-11-27T12:00:00Z');
  const bills: (BillRecord & { userId: string })[] = [];

  /** Como ON DELETE SET NULL: si la cuenta de pago ya no existe, queda sin ella. */
  const view = ({ userId: _userId, ...bill }: BillRecord & { userId: string }): BillRecord => ({
    ...bill,
    accountId: bill.accountId && accountExists(bill.accountId) ? bill.accountId : null,
    payments: [...bill.payments].sort((a, b) => b.period.localeCompare(a.period)),
  });
  const owned = (userId: string, id: string) => bills.find((bill) => bill.id === id && bill.userId === userId);

  const repo: BillsRepository = {
    async list(userId) {
      return bills
        .filter((bill) => bill.userId === userId)
        .sort((a, b) => a.dueDay - b.dueDay || a.name.localeCompare(b.name))
        .map(view);
    },
    async find(userId, id) {
      const bill = owned(userId, id);
      return bill ? view(bill) : null;
    },
    async create(userId, data) {
      const bill = { ...data, id: nextId(), userId, createdAt: created, payments: [] };
      bills.push(bill);
      return view(bill);
    },
    async update(userId, id, changes) {
      const bill = owned(userId, id);
      if (!bill) return null;
      for (const [key, value] of Object.entries(changes)) {
        if (value !== undefined) (bill as Record<string, unknown>)[key] = value;
      }
      return view(bill);
    },
    async delete(userId, id) {
      const index = bills.findIndex((bill) => bill.id === id && bill.userId === userId);
      if (index < 0) return false;
      bills.splice(index, 1);
      return true;
    },
    async setPayment(userId, billId, data) {
      const bill = owned(userId, billId)!;
      const existing = bill.payments.find((payment) => payment.period === data.period);
      if (existing) {
        existing.amount = data.amount;
        existing.paidOn = data.paidOn;
      } else {
        bill.payments.push({ id: nextId(), ...data, createdAt: created });
      }
    },
    async deletePayment(userId, billId, period) {
      const bill = owned(userId, billId);
      const index = bill?.payments.findIndex((payment) => payment.period === period) ?? -1;
      if (!bill || index < 0) return false;
      bill.payments.splice(index, 1);
      return true;
    },
  };

  return {
    repo,
    bills,
    clearUser(userId: string) {
      for (let i = bills.length - 1; i >= 0; i -= 1) if (bills[i]!.userId === userId) bills.splice(i, 1);
    },
  };
}
