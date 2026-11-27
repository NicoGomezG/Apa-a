import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import type { AuthUser } from '../../lib/auth/token-verifier.js';
import { DELETE_CONFIRMATION } from '../account/account.routes.js';
import { ALICE, BOB, bearer, createFakeDeps, testEnv } from '../../test/fakes.js';

let app: FastifyInstance;
let fakes: ReturnType<typeof createFakeDeps>;

beforeEach(async () => {
  fakes = createFakeDeps([ALICE, BOB], () => new Date('2026-11-27T15:00:00Z'));
  app = await buildApp(testEnv, fakes.deps);
});

afterEach(async () => {
  await app.close();
});

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';
const call = (user: AuthUser, method: Method, url: string, payload?: object) =>
  app.inject({ method, url: `/api/finance/debts${url}`, headers: bearer(user), ...(payload ? { payload } : {}) });

const lend = (user: AuthUser, payload: object = {}) =>
  call(user, 'POST', '', {
    direction: 'owed_to_me',
    personName: 'Pedro',
    description: 'Entradas del concierto',
    amount: '45000',
    date: '2026-10-01',
    ...payload,
  });

describe('deudas', () => {
  it('registra quién te debe y a quién le debes, con saldo y estado', async () => {
    const owed = await lend(ALICE);
    expect(owed.statusCode).toBe(201);
    expect(owed.json()).toMatchObject({
      direction: 'owed_to_me',
      personName: 'Pedro',
      description: 'Entradas del concierto',
      amount: '45000',
      currency: 'CLP',
      date: '2026-10-01',
      paid: '0',
      pending: '45000',
      status: 'pending',
      lastPaymentDate: null,
      paidAt: null,
    });

    const mine = await call(ALICE, 'POST', '', { direction: 'i_owe', personName: 'Mamá', amount: '100000', date: '2026-11-10' });
    expect(mine.statusCode).toBe(201);
    const list = (await call(ALICE, 'GET', '')).json();
    expect(list.map((debt: { direction: string }) => debt.direction)).toEqual(['i_owe', 'owed_to_me']);
  });

  it('abonos: bajan el saldo, no pueden pasarse y al llegar a cero queda pagada con su fecha', async () => {
    const { id } = (await lend(ALICE)).json();
    const first = await call(ALICE, 'POST', `/${id}/payments`, { amount: '20000', date: '2026-10-15' });
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({ paid: '20000', pending: '25000', status: 'pending', lastPaymentDate: '2026-10-15' });

    expect((await call(ALICE, 'POST', `/${id}/payments`, { amount: '25001', date: '2026-11-01' })).statusCode).toBe(400);
    expect((await call(ALICE, 'POST', `/${id}/payments`, { amount: '1000', date: '2026-09-30' })).statusCode).toBe(400);

    const last = await call(ALICE, 'POST', `/${id}/payments`, { amount: '25000', date: '2026-11-20' });
    expect(last.json()).toMatchObject({ pending: '0', status: 'paid', paidAt: '2026-11-20' });
    expect((await call(ALICE, 'POST', `/${id}/payments`, { amount: '1', date: '2026-11-21' })).statusCode).toBe(400);

    // Borrar un abono la reabre.
    const paymentId = last.json().payments.at(-1).id;
    const reopened = await call(ALICE, 'DELETE', `/${id}/payments/${paymentId}`);
    expect(reopened.statusCode).toBe(200);
    expect(reopened.json()).toMatchObject({ pending: '25000', status: 'pending', paidAt: null });
  });

  it('valida los datos', async () => {
    expect((await lend(ALICE, { personName: '' })).statusCode).toBe(400);
    expect((await lend(ALICE, { amount: '0' })).statusCode).toBe(400);
    expect((await lend(ALICE, { amount: 10.5 })).statusCode).toBe(400);
    expect((await lend(ALICE, { direction: 'regalo' })).statusCode).toBe(400);
    expect((await lend(ALICE, { date: '2026-02-30' })).statusCode).toBe(400);

    const { id } = (await lend(ALICE)).json();
    await call(ALICE, 'POST', `/${id}/payments`, { amount: '20000', date: '2026-10-15' });
    expect((await call(ALICE, 'PATCH', `/${id}`, { amount: '19999' })).statusCode).toBe(400);
    expect((await call(ALICE, 'PATCH', `/${id}`, { date: '2026-10-20' })).statusCode).toBe(400);
    const edited = await call(ALICE, 'PATCH', `/${id}`, { amount: '50000', description: null });
    expect(edited.statusCode).toBe(200);
    expect(edited.json()).toMatchObject({ amount: '50000', pending: '30000', description: null });
  });

  it('usa un contacto propio (su nombre si no escribes otro) y lo suelta si se borra', async () => {
    const contact = (await app.inject({
      method: 'POST',
      url: '/api/people/contacts',
      headers: bearer(ALICE),
      payload: { name: 'Pedro Soto' },
    })).json();
    const debt = await lend(ALICE, { contactId: contact.id, personName: '' });
    expect(debt.json()).toMatchObject({ contactId: contact.id, personName: 'Pedro Soto' });

    // El contacto de otra persona no sirve.
    const bobContact = (await app.inject({
      method: 'POST',
      url: '/api/people/contacts',
      headers: bearer(BOB),
      payload: { name: 'Ajeno' },
    })).json();
    expect((await lend(ALICE, { contactId: bobContact.id })).statusCode).toBe(404);

    await app.inject({ method: 'DELETE', url: `/api/people/contacts/${contact.id}`, headers: bearer(ALICE) });
    const [after] = (await call(ALICE, 'GET', '')).json();
    expect(after).toMatchObject({ contactId: null, personName: 'Pedro Soto' });
  });

  it('B no ve, edita, abona ni borra las deudas de A', async () => {
    const { id } = (await lend(ALICE)).json();
    expect((await call(BOB, 'GET', '')).json()).toEqual([]);
    expect((await call(BOB, 'PATCH', `/${id}`, { amount: '1' })).statusCode).toBe(404);
    expect((await call(BOB, 'POST', `/${id}/payments`, { amount: '1', date: '2026-11-01' })).statusCode).toBe(404);
    expect((await call(BOB, 'DELETE', `/${id}`)).statusCode).toBe(404);
    const payment = (await call(ALICE, 'POST', `/${id}/payments`, { amount: '1000', date: '2026-11-01' })).json().payments[0];
    expect((await call(BOB, 'DELETE', `/${id}/payments/${payment.id}`)).statusCode).toBe(404);
    expect((await call(ALICE, 'GET', '')).json()[0].pending).toBe('44000');
  });

  it('la bitácora no guarda montos, nombres ni motivos', async () => {
    const { id } = (await lend(ALICE)).json();
    await call(ALICE, 'POST', `/${id}/payments`, { amount: '12345', date: '2026-11-01' });
    await call(ALICE, 'PATCH', `/${id}`, { personName: 'Pedro Pérez' });
    const raw = JSON.stringify(fakes.auditLog);
    for (const secret of ['45000', '12345', 'Pedro', 'concierto']) expect(raw).not.toContain(secret);
    expect(fakes.auditLog.find((entry) => entry.action === 'finance.debt.updated')?.metadata).toEqual({ fields: ['personName'] });
  });

  it('se exportan y se borran con la cuenta', async () => {
    await lend(ALICE);
    await lend(BOB);
    const exported = (await app.inject({ method: 'GET', url: '/api/me/export', headers: bearer(ALICE) })).json();
    expect(exported.finance.debts).toHaveLength(1);
    expect(exported.finance.debts[0]).toMatchObject({ personName: 'Pedro', amount: '45000' });

    const deleted = await app.inject({
      method: 'DELETE',
      url: '/api/me',
      headers: bearer(ALICE),
      payload: { confirmation: DELETE_CONFIRMATION },
    });
    expect(deleted.statusCode).toBe(204);
    expect(fakes.debts.debts).toHaveLength(1);
    expect((await call(BOB, 'GET', '')).json()).toHaveLength(1);
  });
});
