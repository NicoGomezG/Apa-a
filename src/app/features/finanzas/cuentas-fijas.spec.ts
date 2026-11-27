import { describe, expect, it } from 'vitest';
import { sortForMonth } from './cuentas-fijas';
import type { Bill } from './finance.models';

const bill = (data: Partial<Bill>): Bill => ({
  id: 'b',
  name: 'Agua',
  kind: 'agua',
  company: null,
  amount: '20000',
  currency: 'CLP',
  dueDay: 10,
  everyMonths: 1,
  startMonth: '2026-01',
  accountId: null,
  autopay: false,
  active: true,
  notes: null,
  payments: [],
  estimate: '20000',
  dueDate: '2026-11-10',
  payment: null,
  status: 'pending',
  nextDue: null,
  ...data,
});

describe('sortForMonth', () => {
  it('vencidas primero, luego por pagar por fecha y pagadas al final; sin pausadas ni las que no vencen', () => {
    const list = sortForMonth([
      bill({ id: 'pagada', status: 'paid', dueDate: '2026-11-01' }),
      bill({ id: 'tarde', status: 'pending', dueDate: '2026-11-28' }),
      bill({ id: 'vencida', status: 'overdue', dueDate: '2026-11-05' }),
      bill({ id: 'pronto', status: 'pending', dueDate: '2026-11-20' }),
      bill({ id: 'pausada', active: false }),
      bill({ id: 'otro-mes', status: null, dueDate: null }),
    ]);
    expect(list.map((item) => item.id)).toEqual(['vencida', 'pronto', 'tarde', 'pagada']);
  });
});
