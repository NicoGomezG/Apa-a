import type { DebtPaymentRecord, DebtRecord, DebtsRepository } from '../modules/debts/debts.repository.js';
import type { createFakePeople } from './fake-people.js';

/** Deudas en memoria, con las mismas reglas de pertenencia que el repositorio real. */
export function createFakeDebts(people: ReturnType<typeof createFakePeople>) {
  let sequence = 0;
  const nextId = () => `00000000-0000-7000-bd00-${String((sequence += 1)).padStart(12, '0')}`;
  const created = new Date('2026-11-27T12:00:00Z');
  const debts: (DebtRecord & { userId: string })[] = [];

  /** Como ON DELETE SET NULL: si el contacto ya no existe, la deuda queda sin él. */
  const view = ({ userId: _userId, ...debt }: DebtRecord & { userId: string }): DebtRecord => ({
    ...debt,
    contactId: debt.contactId && people.contacts.some((contact) => contact.id === debt.contactId) ? debt.contactId : null,
    payments: [...debt.payments].sort((a, b) => a.date.localeCompare(b.date)),
  });
  const owned = (userId: string, id: string) => debts.find((debt) => debt.id === id && debt.userId === userId);

  const repo: DebtsRepository = {
    async list(userId) {
      return debts
        .filter((debt) => debt.userId === userId)
        .sort((a, b) => b.date.localeCompare(a.date))
        .map(view);
    },
    async find(userId, id) {
      const debt = owned(userId, id);
      return debt ? view(debt) : null;
    },
    async create(userId, data) {
      const debt = { ...data, id: nextId(), userId, createdAt: created, payments: [] };
      debts.push(debt);
      return view(debt);
    },
    async update(userId, id, changes) {
      const debt = owned(userId, id);
      if (!debt) return null;
      for (const [key, value] of Object.entries(changes)) {
        if (value !== undefined) (debt as Record<string, unknown>)[key] = value;
      }
      return view(debt);
    },
    async delete(userId, id) {
      const index = debts.findIndex((debt) => debt.id === id && debt.userId === userId);
      if (index < 0) return false;
      debts.splice(index, 1);
      return true;
    },
    async addPayment(userId, debtId, data) {
      const debt = owned(userId, debtId)!;
      const payment: DebtPaymentRecord = { id: nextId(), amount: data.amount, date: data.date, createdAt: created };
      debt.payments.push(payment);
      return payment;
    },
    async deletePayment(userId, debtId, paymentId) {
      const debt = owned(userId, debtId);
      const index = debt?.payments.findIndex((payment) => payment.id === paymentId) ?? -1;
      if (!debt || index < 0) return false;
      debt.payments.splice(index, 1);
      return true;
    },
  };

  return {
    repo,
    debts,
    clearUser(userId: string) {
      for (let i = debts.length - 1; i >= 0; i -= 1) if (debts[i]!.userId === userId) debts.splice(i, 1);
    },
  };
}
