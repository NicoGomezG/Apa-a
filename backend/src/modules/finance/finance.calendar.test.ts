import { describe, expect, it } from 'vitest';
import { computeCalendar } from './finance.calendar.js';
import type { SubscriptionRecord, TransactionRecord } from './finance.types.js';

const created = new Date('2026-11-01T00:00:00Z');

const sub = (data: Partial<SubscriptionRecord>): SubscriptionRecord => ({
  id: `sub-${Math.random()}`,
  name: 'App',
  amount: 5_000n,
  currency: 'CLP',
  frequency: 'monthly',
  startDate: '2026-01-10',
  accountId: null,
  category: 'suscripciones',
  active: true,
  email: null,
  notes: null,
  createdAt: created,
  ...data,
});

const tx = (data: Partial<TransactionRecord>): TransactionRecord => ({
  id: `tx-${Math.random()}`,
  accountId: 'cuenta',
  date: '2026-11-10',
  description: 'Cargo',
  amount: -5_000n,
  currency: 'CLP',
  kind: 'expense',
  category: null,
  source: 'import',
  createdAt: created,
  ...data,
});

const base = { month: '2026-11', today: '2026-11-25', accounts: [], plans: [], statements: [] };

describe('agenda: cruce de pagos con movimientos', () => {
  it('un mismo cargo no marca dos suscripciones del mismo monto', () => {
    const payments = computeCalendar({
      ...base,
      subscriptions: [sub({ name: 'A' }), sub({ name: 'B' })],
      transactions: [tx({ date: '2026-11-11' })],
    });
    expect(payments.map((item) => item.status).sort()).toEqual(['paid', 'unconfirmed']);
  });

  it('solo busca el cargo cerca del día de cobro y en la cuenta indicada', () => {
    const lejos = computeCalendar({ ...base, subscriptions: [sub({})], transactions: [tx({ date: '2026-11-25' })] });
    expect(lejos[0]?.status).toBe('unconfirmed');

    const otraCuenta = computeCalendar({
      ...base,
      subscriptions: [sub({ accountId: 'tarjeta' })],
      transactions: [tx({ accountId: 'cuenta' })],
    });
    expect(otraCuenta[0]?.status).toBe('unconfirmed');
  });

  it('las anuales solo aparecen en su mes y las pausadas no aparecen', () => {
    const subs = [sub({ frequency: 'yearly', startDate: '2025-11-03' }), sub({ active: false })];
    expect(computeCalendar({ ...base, subscriptions: subs, transactions: [] })).toHaveLength(1);
    expect(computeCalendar({ ...base, month: '2026-12', subscriptions: subs, transactions: [] })).toHaveLength(0);
  });

  it('un cobro futuro queda pendiente', () => {
    const payments = computeCalendar({ ...base, subscriptions: [sub({ startDate: '2026-01-28' })], transactions: [] });
    expect(payments[0]).toMatchObject({ date: '2026-11-28', status: 'pending' });
  });
});
