import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import type { AuthUser } from '../../lib/auth/token-verifier.js';
import { DELETE_CONFIRMATION } from '../account/account.routes.js';
import { ALICE, BOB, bearer, createFakeDeps, testEnv } from '../../test/fakes.js';
import { billDueIn, billEstimate, nextUnpaidDue } from './bills.math.js';
import type { BillRecord } from './bills.repository.js';

let app: FastifyInstance;
let fakes: ReturnType<typeof createFakeDeps>;

beforeEach(async () => {
  // Hoy: 27 de noviembre de 2026 en Santiago.
  fakes = createFakeDeps([ALICE, BOB], () => new Date('2026-11-27T15:00:00Z'));
  app = await buildApp(testEnv, fakes.deps);
});

afterEach(async () => {
  await app.close();
});

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
const call = (user: AuthUser, method: Method, url: string, payload?: object) =>
  app.inject({ method, url: `/api/finance${url}`, headers: bearer(user), ...(payload ? { payload } : {}) });

const createBill = async (user: AuthUser, payload: object = {}) => {
  const res = await call(user, 'POST', '/bills', {
    name: 'Luz',
    kind: 'luz',
    company: 'Enel',
    amount: '30000',
    dueDay: 20,
    ...payload,
  });
  expect(res.statusCode).toBe(201);
  return res.json() as { id: string };
};

const bill = (data: Partial<BillRecord>): BillRecord => ({
  id: 'b1',
  name: 'Agua',
  kind: 'agua',
  company: null,
  amount: 20000n,
  currency: 'CLP',
  dueDay: 31,
  everyMonths: 1,
  startMonth: '2026-01',
  accountId: null,
  autopay: false,
  active: true,
  notes: null,
  createdAt: new Date(),
  payments: [],
  ...data,
});

describe('cálculos de una cuenta fija', () => {
  it('vence según el día y la frecuencia, ajustando meses cortos', () => {
    expect(billDueIn(bill({}), '2026-02')).toBe('2026-02-28');
    expect(billDueIn(bill({}), '2025-12')).toBeNull();
    const bimonthly = bill({ everyMonths: 2, dueDay: 10, startMonth: '2026-11' });
    expect(billDueIn(bimonthly, '2026-12')).toBeNull();
    expect(billDueIn(bimonthly, '2027-01')).toBe('2027-01-10');
    expect(billDueIn(bill({ everyMonths: 12, dueDay: 15, startMonth: '2026-03' }), '2027-03')).toBe('2027-03-15');
  });

  it('estimado = promedio redondeado de los últimos 3 pagos, o el monto anotado si no hay pagos', () => {
    expect(billEstimate(bill({}))).toBe(20000n);
    const payments = [
      { period: '2026-08', amount: 99999n },
      { period: '2026-09', amount: 10000n },
      { period: '2026-10', amount: 20000n },
      { period: '2026-11', amount: 20001n },
    ].map((item, index) => ({ ...item, id: String(index), paidOn: `${item.period}-05`, createdAt: new Date() }));
    expect(billEstimate(bill({ payments }))).toBe(16667n);
  });

  it('próximo vencimiento sin pagar: el vencido de este mes primero, si no el siguiente', () => {
    const water = bill({ dueDay: 10 });
    expect(nextUnpaidDue(water, '2026-11-27')).toEqual({ period: '2026-11', date: '2026-11-10' });
    const paid = bill({ dueDay: 10, payments: [{ id: 'p', period: '2026-11', amount: 1n, paidOn: '2026-11-09', createdAt: new Date() }] });
    expect(nextUnpaidDue(paid, '2026-11-27')).toEqual({ period: '2026-12', date: '2026-12-10' });
    expect(nextUnpaidDue(bill({ active: false }), '2026-11-27')).toBeNull();
  });
});

describe('cuentas fijas', () => {
  it('crea, lista con el estado del mes y totales, edita y borra', async () => {
    const light = await createBill(ALICE);
    await createBill(ALICE, { name: 'Internet', kind: 'internet', company: null, amount: '25990', dueDay: 30, autopay: true });

    const list = (await call(ALICE, 'GET', '/bills')).json();
    expect(list.month).toBe('2026-11');
    expect(list.totals).toEqual({ expected: '55990', paid: '0', pending: '55990' });
    expect(list.bills.map((item: { name: string; status: string; dueDate: string }) => [item.name, item.status, item.dueDate])).toEqual([
      ['Luz', 'overdue', '2026-11-20'],
      ['Internet', 'pending', '2026-11-30'],
    ]);
    expect(list.bills[0]).toMatchObject({ startMonth: '2026-11', everyMonths: 1, estimate: '30000', company: 'Enel' });

    const updated = await call(ALICE, 'PATCH', `/bills/${light.id}`, { amount: '32000', company: '' });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ amount: '32000', company: null });

    expect((await call(ALICE, 'DELETE', `/bills/${light.id}`)).statusCode).toBe(204);
    expect((await call(ALICE, 'GET', '/bills')).json().bills).toHaveLength(1);
  });

  it('valida frecuencia, día y que el medio de pago sea propio', async () => {
    expect((await call(ALICE, 'POST', '/bills', { name: 'X', kind: 'agua', amount: '1', dueDay: 20, everyMonths: 3 })).statusCode).toBe(400);
    expect((await call(ALICE, 'POST', '/bills', { name: 'X', kind: 'agua', amount: '1', dueDay: 32 })).statusCode).toBe(400);
    expect((await call(ALICE, 'POST', '/bills', { name: 'X', kind: 'agua', amount: '0', dueDay: 5 })).statusCode).toBe(400);
    const bobAccount = (await call(BOB, 'POST', '/accounts', { name: 'Cuenta de Bob', kind: 'checking' })).json();
    const res = await call(ALICE, 'POST', '/bills', { name: 'X', kind: 'agua', amount: '1', dueDay: 5, accountId: bobAccount.id });
    expect(res.statusCode).toBe(404);
  });

  it('anotar el pago del mes: queda pagada, se puede corregir y quitar; solo en meses que vence', async () => {
    const light = await createBill(ALICE);
    const paid = await call(ALICE, 'PUT', `/bills/${light.id}/payments/2026-11`, { amount: '28450', paidOn: '2026-11-18' });
    expect(paid.statusCode).toBe(200);
    expect(paid.json()).toMatchObject({ status: 'paid', payment: { period: '2026-11', amount: '28450', paidOn: '2026-11-18' } });
    expect(paid.json().nextDue).toEqual({ period: '2026-12', date: '2026-12-20' });

    const fixed = await call(ALICE, 'PUT', `/bills/${light.id}/payments/2026-11`, { amount: '28500', paidOn: '2026-11-19' });
    expect(fixed.json().payments).toHaveLength(1);
    expect(fixed.json().estimate).toBe('28500');

    const totals = (await call(ALICE, 'GET', '/bills')).json().totals;
    expect(totals).toEqual({ expected: '28500', paid: '28500', pending: '0' });

    expect((await call(ALICE, 'PUT', `/bills/${light.id}/payments/2026-10`, { amount: '1', paidOn: '2026-10-01' })).statusCode).toBe(400);
    expect((await call(ALICE, 'DELETE', `/bills/${light.id}/payments/2026-11`)).json()).toMatchObject({ status: 'overdue', payment: null });
    expect((await call(ALICE, 'DELETE', `/bills/${light.id}/payments/2026-11`)).statusCode).toBe(404);
  });

  it('el usuario B no ve, no edita, no paga ni borra las cuentas del A', async () => {
    const light = await createBill(ALICE);
    expect((await call(BOB, 'GET', '/bills')).json().bills).toEqual([]);
    expect((await call(BOB, 'PATCH', `/bills/${light.id}`, { amount: '1' })).statusCode).toBe(404);
    expect((await call(BOB, 'PUT', `/bills/${light.id}/payments/2026-11`, { amount: '1', paidOn: '2026-11-20' })).statusCode).toBe(404);
    expect((await call(BOB, 'DELETE', `/bills/${light.id}/payments/2026-11`)).statusCode).toBe(404);
    expect((await call(BOB, 'DELETE', `/bills/${light.id}`)).statusCode).toBe(404);
    expect((await call(ALICE, 'GET', '/bills')).json().bills[0].amount).toBe('30000');
  });

  it('la bitácora no guarda montos, nombres ni empresas', async () => {
    const light = await createBill(ALICE);
    await call(ALICE, 'PATCH', `/bills/${light.id}`, { amount: '31000', company: 'CGE' });
    await call(ALICE, 'PUT', `/bills/${light.id}/payments/2026-11`, { amount: '28450', paidOn: '2026-11-18' });
    const entries = fakes.auditLog.filter((entry) => entry.action.startsWith('finance.bill'));
    expect(entries.map((entry) => entry.action)).toEqual(['finance.bill.created', 'finance.bill.updated', 'finance.bill.payment.recorded']);
    const text = JSON.stringify(entries);
    for (const secret of ['31000', '28450', '30000', 'CGE', 'Enel', 'Luz']) expect(text).not.toContain(secret);
    expect(entries[1]!.metadata).toEqual({ fields: ['amount', 'company'] });
  });

  it('entran al gasto base (pagado o estimado), a próximos pagos y a la Agenda', async () => {
    const light = await createBill(ALICE);
    await createBill(ALICE, { name: 'Agua', kind: 'agua', amount: '15000', dueDay: 5, everyMonths: 2, startMonth: '2026-12' });
    await call(ALICE, 'PUT', `/bills/${light.id}/payments/2026-11`, { amount: '28000', paidOn: '2026-11-18' });

    const summary = (await call(ALICE, 'GET', '/summary')).json();
    expect(summary.base.map((row: { month: string; bills: string; total: string }) => [row.month, row.bills, row.total])).toEqual([
      ['2026-11', '28000', '28000'],
      ['2026-12', '43000', '43000'],
      ['2027-01', '28000', '28000'],
      ['2027-02', '43000', '43000'],
    ]);
    expect(summary.spent.total).toBe('0');
    expect(summary.upcoming.map((item: { type: string; label: string; date: string }) => [item.type, item.label, item.date])).toEqual([
      ['bill', 'Agua', '2026-12-05'],
      ['bill', 'Luz', '2026-12-20'],
    ]);

    const calendar = (await call(ALICE, 'GET', '/calendar')).json();
    expect(calendar.payments).toEqual([
      expect.objectContaining({ type: 'bill', label: 'Luz', date: '2026-11-20', amount: '28000', status: 'paid', estimated: false, billId: light.id }),
    ]);
    const december = (await call(ALICE, 'GET', '/calendar?month=2026-12')).json();
    expect(december.payments.map((item: { label: string; status: string; estimated: boolean }) => [item.label, item.status, item.estimated])).toEqual([
      ['Agua', 'pending', true],
      ['Luz', 'pending', true],
    ]);

    // Una cuenta pausada no suma.
    await call(ALICE, 'PATCH', `/bills/${light.id}`, { active: false });
    expect((await call(ALICE, 'GET', '/summary')).json().base[0].bills).toBe('0');
  });

  it('se exporta y se borra con la cuenta', async () => {
    await createBill(ALICE);
    await createBill(BOB);
    const exported = (await app.inject({ method: 'GET', url: '/api/me/export', headers: bearer(ALICE) })).json();
    expect(exported.finance.bills).toHaveLength(1);

    const deleted = await app.inject({
      method: 'DELETE',
      url: '/api/me',
      headers: bearer(ALICE),
      payload: { confirmation: DELETE_CONFIRMATION },
    });
    expect(deleted.statusCode).toBe(204);
    expect(fakes.bills.bills.map((item) => item.userId)).toEqual([BOB.id]);
  });
});
