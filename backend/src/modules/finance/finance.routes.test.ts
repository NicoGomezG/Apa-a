import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { DELETE_CONFIRMATION } from '../account/account.routes.js';
import { ALICE, BOB, bearer, createFakeDeps, testEnv } from '../../test/fakes.js';
import { movementKeys } from './finance.routes.js';

let app: FastifyInstance;
let fakes: ReturnType<typeof createFakeDeps>;

// "Hoy" fijo: 25 de noviembre de 2026, 12:00 en Santiago.
const NOW = new Date('2026-11-25T15:00:00Z');

beforeEach(async () => {
  fakes = createFakeDeps(undefined, () => NOW);
  app = await buildApp(testEnv, fakes.deps);
});

afterEach(async () => {
  await app.close();
});

type User = typeof ALICE;

const call = (user: User, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
  app.inject({ method, url: `/api/finance${url}`, headers: bearer(user), ...(payload ? { payload } : {}) });

async function createAccount(user: User, payload: object = { name: 'Cuenta corriente', kind: 'checking' }) {
  const res = await call(user, 'POST', '/accounts', payload);
  expect(res.statusCode).toBe(201);
  return res.json() as { id: string; currency: string };
}

const cardPayload = { name: 'CMR Falabella', kind: 'credit_card', institution: 'Banco Falabella', last4: '8062', creditLimit: '780000' };

describe('cuentas', () => {
  it('crea, lista, edita y borra; el dinero viaja como string', async () => {
    const card = await createAccount(ALICE, cardPayload);
    const list = await call(ALICE, 'GET', '/accounts');
    expect(list.json()).toMatchObject([{ id: card.id, name: 'CMR Falabella', creditLimit: '780000', currency: 'CLP' }]);

    const updated = await call(ALICE, 'PATCH', `/accounts/${card.id}`, { billingDay: 19, paymentDay: 5 });
    expect(updated.json()).toMatchObject({ billingDay: 19, paymentDay: 5 });
    expect(fakes.auditLog.at(-1)).toMatchObject({ action: 'finance.account.updated', metadata: { fields: ['billingDay', 'paymentDay'] } });

    expect((await call(ALICE, 'DELETE', `/accounts/${card.id}`)).statusCode).toBe(204);
    expect((await call(ALICE, 'GET', '/accounts')).json()).toEqual([]);
  });

  it('rechaza números de tarjeta completos y montos con decimales', async () => {
    const full = await call(ALICE, 'POST', '/accounts', { ...cardPayload, last4: '5487420000008062' });
    expect(full.statusCode).toBe(400);
    const decimals = await call(ALICE, 'POST', '/accounts', { ...cardPayload, creditLimit: '780000.50' });
    expect(decimals.statusCode).toBe(400);
  });

  it('B no ve, no edita ni borra las cuentas de A', async () => {
    const card = await createAccount(ALICE, cardPayload);
    expect((await call(BOB, 'GET', '/accounts')).json()).toEqual([]);
    expect((await call(BOB, 'PATCH', `/accounts/${card.id}`, { name: 'Mía' })).statusCode).toBe(404);
    expect((await call(BOB, 'DELETE', `/accounts/${card.id}`)).statusCode).toBe(404);
    expect((await call(ALICE, 'GET', '/accounts')).json()).toHaveLength(1);
  });

  it('exige sesión', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/finance/accounts' });
    expect(res.statusCode).toBe(401);
  });
});

describe('movimientos', () => {
  it('crea un gasto manual con la moneda de la cuenta y lo lista por mes', async () => {
    const account = await createAccount(ALICE);
    const created = await call(ALICE, 'POST', '/transactions', {
      accountId: account.id,
      date: '2026-11-10',
      description: 'Feria',
      amount: '-12500',
      kind: 'expense',
      category: 'supermercado',
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ amount: '-12500', currency: 'CLP', source: 'manual' });

    const november = await call(ALICE, 'GET', '/transactions?month=2026-11');
    expect(november.json().transactions).toHaveLength(1);
    const october = await call(ALICE, 'GET', '/transactions?month=2026-10');
    expect(october.json().transactions).toHaveLength(0);

    // Sin mes: el mes actual en la zona del usuario.
    expect((await call(ALICE, 'GET', '/transactions')).json().month).toBe('2026-11');
  });

  it('la bitácora no guarda montos ni descripciones', async () => {
    const account = await createAccount(ALICE);
    await call(ALICE, 'POST', '/transactions', {
      accountId: account.id,
      date: '2026-11-10',
      description: 'Consulta psicóloga',
      amount: -45000,
      kind: 'expense',
    });
    const log = JSON.stringify(fakes.auditLog);
    expect(log).not.toContain('45000');
    expect(log).not.toContain('psicóloga');
  });

  it('valida fecha, monto y categoría', async () => {
    const account = await createAccount(ALICE);
    const base = { accountId: account.id, date: '2026-11-10', description: 'X', amount: '-1', kind: 'expense' };
    for (const payload of [
      { ...base, date: '2026-02-30' },
      { ...base, amount: '0' },
      { ...base, amount: 1.5 },
      { ...base, category: 'lujo' },
      { ...base, kind: 'regalo' },
    ]) {
      expect((await call(ALICE, 'POST', '/transactions', payload)).statusCode, JSON.stringify(payload)).toBe(400);
    }
  });

  it('B no puede crear movimientos en la cuenta de A ni ver, editar o borrar los de A', async () => {
    const account = await createAccount(ALICE);
    const payload = { accountId: account.id, date: '2026-11-10', description: 'X', amount: '-1000', kind: 'expense' };
    expect((await call(BOB, 'POST', '/transactions', payload)).statusCode).toBe(404);

    const tx = (await call(ALICE, 'POST', '/transactions', payload)).json() as { id: string };
    expect((await call(BOB, 'GET', '/transactions?month=2026-11')).json().transactions).toEqual([]);
    expect((await call(BOB, 'PATCH', `/transactions/${tx.id}`, { category: 'otros' })).statusCode).toBe(404);
    expect((await call(BOB, 'DELETE', `/transactions/${tx.id}`)).statusCode).toBe(404);
    expect((await call(ALICE, 'PATCH', `/transactions/${tx.id}`, { kind: 'transfer' })).json().kind).toBe('transfer');
    expect((await call(ALICE, 'DELETE', `/transactions/${tx.id}`)).statusCode).toBe(204);
  });
});

describe('suscripciones', () => {
  it('crea con categoría por defecto, edita y borra', async () => {
    const created = await call(ALICE, 'POST', '/subscriptions', {
      name: 'Spotify',
      amount: '6990',
      frequency: 'monthly',
      startDate: '2026-03-12',
    });
    expect(created.statusCode).toBe(201);
    const sub = created.json() as { id: string };
    expect(created.json()).toMatchObject({ category: 'suscripciones', active: true, currency: 'CLP' });

    expect((await call(ALICE, 'PATCH', `/subscriptions/${sub.id}`, { active: false })).json().active).toBe(false);
    expect((await call(ALICE, 'DELETE', `/subscriptions/${sub.id}`)).statusCode).toBe(204);
  });

  it('guarda el correo y las notas, pero no los manda a la bitácora', async () => {
    const card = await createAccount(ALICE, cardPayload);
    const created = await call(ALICE, 'POST', '/subscriptions', {
      name: 'Netflix',
      amount: '9990',
      frequency: 'monthly',
      startDate: '2026-01-20',
      accountId: card.id,
      email: '  Persona@Correo.CL ',
      notes: 'Plan estándar, compartido',
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ email: 'persona@correo.cl', notes: 'Plan estándar, compartido', accountId: card.id });

    const id = created.json().id as string;
    const cleared = await call(ALICE, 'PATCH', `/subscriptions/${id}`, { email: '', notes: '' });
    expect(cleared.json()).toMatchObject({ email: null, notes: null });

    expect(JSON.stringify(fakes.auditLog)).not.toContain('correo.cl');
    expect(JSON.stringify(fakes.auditLog)).not.toContain('Plan estándar');

    const export_ = await app.inject({ method: 'GET', url: '/api/me/export', headers: bearer(ALICE) });
    expect(export_.json().finance.subscriptions[0]).toHaveProperty('email');
  });

  it('rechaza correos inválidos', async () => {
    const res = await call(ALICE, 'POST', '/subscriptions', {
      name: 'X',
      amount: '1000',
      frequency: 'monthly',
      startDate: '2026-03-12',
      email: 'no-es-correo',
    });
    expect(res.statusCode).toBe(400);
  });

  it('rechaza montos no positivos', async () => {
    const res = await call(ALICE, 'POST', '/subscriptions', { name: 'X', amount: '0', frequency: 'monthly', startDate: '2026-03-12' });
    expect(res.statusCode).toBe(400);
  });

  it('B no ve ni toca las suscripciones de A, ni puede asociarlas a cuentas ajenas', async () => {
    const aliceAccount = await createAccount(ALICE);
    const sub = (
      await call(ALICE, 'POST', '/subscriptions', { name: 'Netflix', amount: '7990', frequency: 'monthly', startDate: '2026-01-01' })
    ).json() as { id: string };

    expect((await call(BOB, 'GET', '/subscriptions')).json()).toEqual([]);
    expect((await call(BOB, 'PATCH', `/subscriptions/${sub.id}`, { active: false })).statusCode).toBe(404);
    expect((await call(BOB, 'DELETE', `/subscriptions/${sub.id}`)).statusCode).toBe(404);
    const foreign = await call(BOB, 'POST', '/subscriptions', {
      name: 'X',
      amount: '100',
      frequency: 'monthly',
      startDate: '2026-01-01',
      accountId: aliceAccount.id,
    });
    expect(foreign.statusCode).toBe(404);
  });
});

describe('importación', () => {
  const cmrImport = (accountId: string) => ({
    accountId,
    movements: [
      { date: '2026-11-13', description: 'Red movilidad santiago', amount: '-1710', kind: 'expense', category: 'transporte' },
      { date: '2026-11-13', description: 'Red movilidad santiago', amount: '-1710', kind: 'expense', category: 'transporte' },
      { date: '2026-11-02', description: 'Pago tarjeta cmr', amount: '443630', kind: 'card_payment' },
    ],
    installments: [
      {
        description: 'Op schilling local',
        purchaseDate: '2026-09-08',
        originalAmount: '169500',
        totalAmount: '169500',
        installmentCount: 6,
        installmentAmount: '28250',
        currentNumber: 3,
        currentDueMonth: '2026-12',
        category: 'compras',
      },
    ],
    statement: {
      periodStart: '2026-10-20',
      periodEnd: '2026-11-19',
      dueDate: '2026-12-05',
      totalBilled: '375160',
      minimumPayment: '38850',
    },
  });

  it('importa movimientos, cuotas y estado de cuenta; reimportar no duplica', async () => {
    const card = await createAccount(ALICE, cardPayload);
    const first = await call(ALICE, 'POST', '/imports', cmrImport(card.id));
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({
      transactionsCreated: 3,
      transactionsSkipped: 0,
      plansCreated: 1,
      plansSkipped: 0,
      statement: 'created',
    });

    const again = await call(ALICE, 'POST', '/imports', cmrImport(card.id));
    expect(again.json()).toEqual({
      transactionsCreated: 0,
      transactionsSkipped: 3,
      plansCreated: 0,
      plansSkipped: 1,
      statement: 'updated',
    });

    // La cuota 3 se paga en dic-2026 → la cuota 1 fue en oct-2026.
    expect(fakes.finance.plans[0]?.firstDueMonth).toBe('2026-10');
    expect(fakes.finance.plans[0]?.lastInstallmentAmount).toBeNull();

    // El estado de cuenta enseña el ciclo de la tarjeta.
    const account = (await call(ALICE, 'GET', '/accounts')).json()[0];
    expect(account).toMatchObject({ billingDay: 19, paymentDay: 5 });

    // En la bitácora, solo conteos.
    const entry = fakes.auditLog.find((item) => item.action === 'finance.import.completed');
    expect(entry?.metadata).toEqual({ transactionsCreated: 3, transactionsSkipped: 0, plansCreated: 1, statement: 'created' });
  });

  it('lista las compras en cuotas con lo pagado y lo que falta', async () => {
    const card = await createAccount(ALICE, cardPayload);
    await call(ALICE, 'POST', '/imports', cmrImport(card.id));
    const [plan] = (await call(ALICE, 'GET', '/installments')).json();
    // Hoy es noviembre: pagadas oct (1); nov es la 2 y está pendiente.
    expect(plan.status).toEqual({
      paidCount: 1,
      remaining: String(28_250 * 5),
      next: { number: 2, month: '2026-11', amount: '28250' },
      lastMonth: '2027-03',
      finished: false,
    });
  });

  it('no acepta estados de cuenta en una cuenta corriente', async () => {
    const account = await createAccount(ALICE);
    const res = await call(ALICE, 'POST', '/imports', cmrImport(account.id));
    expect(res.statusCode).toBe(400);
  });

  it('B no puede importar en la cuenta de A ni ver sus cuotas', async () => {
    const card = await createAccount(ALICE, cardPayload);
    expect((await call(BOB, 'POST', '/imports', cmrImport(card.id))).statusCode).toBe(404);
    await call(ALICE, 'POST', '/imports', cmrImport(card.id));
    expect((await call(BOB, 'GET', '/installments')).json()).toEqual([]);
    const planId = fakes.finance.plans[0]!.id;
    expect((await call(BOB, 'PATCH', `/installments/${planId}`, { category: 'otros' })).statusCode).toBe(404);
    expect((await call(BOB, 'DELETE', `/installments/${planId}`)).statusCode).toBe(404);
    expect((await call(ALICE, 'PATCH', `/installments/${planId}`, { category: 'hogar' })).json().category).toBe('hogar');
  });

  it('distingue movimientos idénticos del mismo día por su orden en el archivo', () => {
    const metro = { date: '2026-11-13', amount: -1710n, description: 'Red  Movilidad Santiago' };
    const keys = movementKeys([metro, { ...metro, description: 'red movilidad santiago' }]);
    expect(keys[0]).not.toBe(keys[1]);
    expect(movementKeys([metro])[0]).toBe(keys[0]);
  });
});

describe('resumen', () => {
  it('devuelve el gasto del mes, gasto base, tarjetas y próximos pagos', async () => {
    const card = await createAccount(ALICE, cardPayload);
    await call(ALICE, 'POST', '/imports', cmrImport2(card.id));
    await call(ALICE, 'POST', '/subscriptions', { name: 'Spotify', amount: '6990', frequency: 'monthly', startDate: '2026-03-12' });

    const res = await call(ALICE, 'GET', '/summary');
    expect(res.statusCode).toBe(200);
    const summary = res.json();
    expect(summary.month).toBe('2026-11');
    expect(summary.today).toBe('2026-11-25');
    // Gasto de noviembre: metro + cuota 2 de Schilling (28.250). El pago de la tarjeta no cuenta.
    expect(summary.spent.total).toBe(String(1_710 + 28_250));
    expect(summary.base[0]).toEqual({ month: '2026-11', subscriptions: '6990', converted: '0', installments: '28250', total: '35240' });
    expect(summary.cards[0].lastStatement.totalBilled).toBe('375160');
    expect(summary.upcoming.map((item: { label: string }) => item.label)).toEqual(['CMR Falabella', 'Spotify']);
  });

  it('suma al gasto base las suscripciones en USD convertidas a pesos', async () => {
    await call(ALICE, 'POST', '/subscriptions', { name: 'Spotify', amount: '6990', frequency: 'monthly', startDate: '2026-03-12' });
    await call(ALICE, 'POST', '/subscriptions', { name: 'ChatGPT', amount: '2000', currency: 'USD', frequency: 'monthly', startDate: '2026-03-05' });
    const summary = (await call(ALICE, 'GET', '/summary')).json();
    // US$20 × 950 (dólar de prueba) = 19.000.
    expect(summary.base[0]).toMatchObject({ subscriptions: String(6_990 + 19_000), converted: '19000' });
    expect(summary.foreignSubscriptions).toEqual([
      { currency: 'USD', amount: '2000', converted: '19000', rate: { micros: '950000000', date: '2026-11-25' } },
    ]);
  });

  it('muestra el dólar observado (y omite las monedas sin valor)', async () => {
    const res = await call(ALICE, 'GET', '/exchange-rates');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ rates: [{ currency: 'USD', micros: '950000000', date: '2026-11-25' }] });
    const anonymous = await app.inject({ method: 'GET', url: '/api/finance/exchange-rates' });
    expect(anonymous.statusCode).toBe(401);
  });

  it('B ve un resumen vacío aunque A tenga datos', async () => {
    const card = await createAccount(ALICE, cardPayload);
    await call(ALICE, 'POST', '/imports', cmrImport2(card.id));
    const summary = (await call(BOB, 'GET', '/summary?month=2026-11')).json();
    expect(summary.spent.total).toBe('0');
    expect(summary.cards).toEqual([]);
    expect(summary.upcoming).toEqual([]);
  });

  it('rechaza meses inválidos', async () => {
    expect((await call(ALICE, 'GET', '/summary?month=2026-13')).statusCode).toBe(400);
  });
});

describe('exportación y eliminación de cuenta', () => {
  it('la exportación incluye las finanzas propias y no las ajenas', async () => {
    const card = await createAccount(ALICE, cardPayload);
    await call(ALICE, 'POST', '/imports', cmrImport2(card.id));
    await createAccount(BOB);

    const res = await app.inject({ method: 'GET', url: '/api/me/export', headers: bearer(ALICE) });
    const body = res.json();
    expect(body.finance.accounts).toHaveLength(1);
    expect(body.finance.accounts[0].name).toBe('CMR Falabella');
    expect(body.finance.transactions).toHaveLength(1);
    expect(body.finance.installmentPlans[0].totalAmount).toBe('169500');
    expect(body.finance.statements).toHaveLength(1);
  });

  it('eliminar la cuenta borra las finanzas de esa persona y solo las suyas', async () => {
    const card = await createAccount(ALICE, cardPayload);
    await call(ALICE, 'POST', '/imports', cmrImport2(card.id));
    await call(ALICE, 'POST', '/subscriptions', { name: 'X', amount: '100', frequency: 'monthly', startDate: '2026-01-01' });
    await createAccount(BOB);

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/me',
      headers: bearer(ALICE),
      payload: { confirmation: DELETE_CONFIRMATION },
    });
    expect(res.statusCode).toBe(204);
    expect(fakes.finance.accounts.map((a) => a.userId)).toEqual([BOB.id]);
    expect(fakes.finance.transactions).toHaveLength(0);
    expect(fakes.finance.plans).toHaveLength(0);
    expect(fakes.finance.statements).toHaveLength(0);
    expect(fakes.finance.subscriptions).toHaveLength(0);
  });
});

function cmrImport2(accountId: string) {
  return {
    accountId,
    movements: [{ date: '2026-11-13', description: 'Red movilidad santiago', amount: '-1710', kind: 'expense' }],
    installments: [
      {
        description: 'Op schilling local',
        purchaseDate: '2026-09-08',
        originalAmount: '169500',
        totalAmount: '169500',
        installmentCount: 6,
        installmentAmount: '28250',
        currentNumber: 3,
        currentDueMonth: '2026-12',
      },
    ],
    statement: {
      periodStart: '2026-10-20',
      periodEnd: '2026-11-19',
      dueDate: '2026-12-05',
      totalBilled: '375160',
      minimumPayment: '38850',
    },
  };
}

describe('última cuota informada por el banco', () => {
  it('se guarda al importar la cuota N/N, también si la compra ya existía', async () => {
    const card = (await call(ALICE, 'POST', '/accounts', cardPayload)).json() as { id: string };
    const plan = (number: number) => ({
      accountId: card.id,
      installments: [
        {
          description: 'H&m mall plaza egana',
          purchaseDate: '2026-09-05',
          originalAmount: '53980',
          totalAmount: '57746',
          installmentCount: 3,
          installmentAmount: '19250',
          currentNumber: number,
          currentDueMonth: `2026-${String(9 + number).padStart(2, '0')}`,
        },
      ],
    });
    await call(ALICE, 'POST', '/imports', plan(2));
    expect(fakes.finance.plans[0]?.lastInstallmentAmount).toBeNull();
    const again = await call(ALICE, 'POST', '/imports', plan(3));
    expect(again.json().plansCreated).toBe(0);
    expect(fakes.finance.plans[0]?.lastInstallmentAmount).toBe(19_250n);
  });
});

describe('agenda de pagos', () => {
  async function seed(user: User) {
    const checking = await createAccount(user);
    const card = await createAccount(user, cardPayload);
    await call(user, 'POST', '/subscriptions', { name: 'Spotify', amount: '6990', frequency: 'monthly', startDate: '2026-03-12' });
    await call(user, 'POST', '/subscriptions', { name: 'Netflix', amount: '9990', frequency: 'monthly', startDate: '2026-01-20' });
    await call(user, 'POST', '/transactions', {
      accountId: checking.id,
      date: '2026-11-13',
      description: 'Spotify',
      amount: '-6990',
      kind: 'expense',
    });
    await call(user, 'POST', '/imports', {
      accountId: card.id,
      movements: [],
      installments: [
        {
          description: 'Op schilling local',
          purchaseDate: '2026-09-08',
          originalAmount: '169500',
          totalAmount: '169500',
          installmentCount: 6,
          installmentAmount: '28250',
          currentNumber: 3,
          currentDueMonth: '2026-12',
          category: 'compras',
        },
      ],
      statement: { periodStart: '2026-10-20', periodEnd: '2026-11-19', dueDate: '2026-12-05', totalBilled: '375160', minimumPayment: '38850' },
    });
    await call(user, 'POST', '/transactions', {
      accountId: checking.id,
      date: '2026-12-02',
      description: 'Traspaso a tarjeta',
      amount: '-375160',
      kind: 'card_payment',
    });
    return { checking, card };
  }

  it('marca como pagadas las suscripciones que aparecen en los movimientos', async () => {
    await seed(ALICE);
    const res = await call(ALICE, 'GET', '/calendar');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.month).toBe('2026-11');
    expect(body.payments).toMatchObject([
      { date: '2026-11-12', type: 'subscription', label: 'Spotify', amount: '6990', status: 'paid', matchedTransaction: { date: '2026-11-13' } },
      { date: '2026-11-20', type: 'subscription', label: 'Netflix', amount: '9990', status: 'unconfirmed', matchedTransaction: null },
    ]);
  });

  it('muestra el vencimiento de la tarjeta con sus cuotas y lo cruza con el pago', async () => {
    await seed(ALICE);
    const december = (await call(ALICE, 'GET', '/calendar?month=2026-12')).json();
    const card = december.payments.find((item: { type: string }) => item.type === 'card');
    expect(card).toMatchObject({
      date: '2026-12-05',
      amount: '375160',
      estimated: false,
      status: 'paid',
      installments: [{ description: 'Op schilling local', number: 3, count: 6, amount: '28250' }],
    });
    const subs = december.payments.filter((item: { type: string }) => item.type === 'subscription');
    expect(subs.map((item: { status: string }) => item.status)).toEqual(['pending', 'pending']);

    // Enero aún no tiene estado de cuenta: se estima con el ciclo abierto (sin compras) + cuota 4.
    const january = (await call(ALICE, 'GET', '/calendar?month=2027-01')).json();
    expect(january.payments.find((item: { type: string }) => item.type === 'card')).toMatchObject({
      date: '2027-01-05',
      amount: '28250',
      estimated: true,
      status: 'pending',
    });
  });

  it('B no ve los pagos de A', async () => {
    await seed(ALICE);
    expect((await call(BOB, 'GET', '/calendar?month=2026-11')).json().payments).toEqual([]);
    expect((await call(BOB, 'GET', '/calendar?month=2026-12')).json().payments).toEqual([]);
  });

  it('rechaza meses inválidos y exige sesión', async () => {
    expect((await call(ALICE, 'GET', '/calendar?month=2026-13')).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/finance/calendar' })).statusCode).toBe(401);
  });
});
