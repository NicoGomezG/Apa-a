import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import type { AuthUser } from '../../lib/auth/token-verifier.js';
import { DELETE_CONFIRMATION } from '../account/account.routes.js';
import { ALICE, BOB, bearer, createFakeDeps, testEnv } from '../../test/fakes.js';
import { addMonths } from './health.routes.js';

let app: FastifyInstance;
let fakes: ReturnType<typeof createFakeDeps>;

beforeEach(async () => {
  fakes = createFakeDeps([ALICE, BOB], () => new Date('2026-12-01T15:00:00Z'));
  app = await buildApp(testEnv, fakes.deps);
});

afterEach(async () => {
  await app.close();
});

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';
const call = (user: AuthUser, method: Method, url: string, payload?: object) =>
  app.inject({ method, url: `/api/health${url}`, headers: bearer(user), ...(payload ? { payload } : {}) });

const visit = (user: AuthUser, payload: object = {}) =>
  call(user, 'POST', '/visits', {
    specialty: 'Oftalmología',
    professional: 'Dra. Rojas',
    place: 'Clínica Visión',
    visitDate: '2026-06-10',
    repeatMonths: 6,
    notes: 'Miopía estable, lentes -2.25',
    ...payload,
  });

describe('addMonths', () => {
  it('suma meses y ajusta al último día cuando el mes es más corto', () => {
    expect(addMonths('2026-06-10', 6)).toBe('2026-12-10');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-11-15', 12)).toBe('2027-11-15');
  });
});

describe('consultas de salud', () => {
  it('registra una consulta y calcula el próximo control con "repetir en"', async () => {
    const created = await visit(ALICE);
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      specialty: 'Oftalmología',
      professional: 'Dra. Rojas',
      visitDate: '2026-06-10',
      repeatMonths: 6,
      nextDate: '2026-12-10',
      nextDone: false,
    });

    const yearly = (await visit(ALICE, { specialty: 'Medicina general', visitDate: '2026-03-01', repeatMonths: 12 })).json();
    expect(yearly.nextDate).toBe('2027-03-01');
    const noRepeat = (await visit(ALICE, { specialty: 'Pediatría', repeatMonths: null })).json();
    expect(noRepeat.nextDate).toBeNull();
    const manual = (await visit(ALICE, { repeatMonths: null, nextDate: '2026-08-01' })).json();
    expect(manual.nextDate).toBe('2026-08-01');

    expect((await call(ALICE, 'GET', '/visits')).json()).toHaveLength(4);
  });

  it('valida "repetir en", fechas y textos', async () => {
    expect((await visit(ALICE, { repeatMonths: 3 })).statusCode).toBe(400);
    expect((await visit(ALICE, { nextDate: '2026-01-01' })).statusCode).toBe(400);
    expect((await visit(ALICE, { visitDate: '2026-02-30' })).statusCode).toBe(400);
    expect((await visit(ALICE, { specialty: '' })).statusCode).toBe(400);
    expect((await visit(ALICE, { notes: 'x'.repeat(1001) })).statusCode).toBe(400);
  });

  it('"Ya fui": la consulta nueva cierra el control de la anterior', async () => {
    const first = (await visit(ALICE)).json();
    const second = await visit(ALICE, { visitDate: '2026-12-12', completesVisitId: first.id });
    expect(second.statusCode).toBe(201);
    expect(second.json().nextDate).toBe('2027-06-12');
    const list = (await call(ALICE, 'GET', '/visits')).json();
    expect(list.find((item: { id: string }) => item.id === first.id).nextDone).toBe(true);
  });

  it('editar recalcula el control, y uno nuevo vuelve a quedar pendiente', async () => {
    const { id } = (await visit(ALICE)).json();
    await call(ALICE, 'PATCH', `/visits/${id}`, { nextDone: true });

    const moved = (await call(ALICE, 'PATCH', `/visits/${id}`, { visitDate: '2026-07-01' })).json();
    expect(moved).toMatchObject({ visitDate: '2026-07-01', nextDate: '2027-01-01', nextDone: false });

    const yearly = (await call(ALICE, 'PATCH', `/visits/${id}`, { repeatMonths: 12 })).json();
    expect(yearly.nextDate).toBe('2027-07-01');

    const manual = (await call(ALICE, 'PATCH', `/visits/${id}`, { nextDate: '2026-09-15' })).json();
    expect(manual.nextDate).toBe('2026-09-15');
    const cleared = (await call(ALICE, 'PATCH', `/visits/${id}`, { repeatMonths: null, nextDate: null })).json();
    expect(cleared).toMatchObject({ repeatMonths: null, nextDate: null });

    expect((await call(ALICE, 'PATCH', `/visits/${id}`, { nextDate: '2026-01-01' })).statusCode).toBe(400);
    expect((await call(ALICE, 'PATCH', `/visits/${id}`, {})).statusCode).toBe(400);
    expect((await call(ALICE, 'DELETE', `/visits/${id}`)).statusCode).toBe(204);
    expect((await call(ALICE, 'GET', '/visits')).json()).toEqual([]);
  });

  it('el usuario B no ve, no edita, no borra ni cierra las consultas de A', async () => {
    const { id } = (await visit(ALICE)).json();
    expect((await call(BOB, 'GET', '/visits')).json()).toEqual([]);
    expect((await call(BOB, 'PATCH', `/visits/${id}`, { notes: 'hola' })).statusCode).toBe(404);
    expect((await call(BOB, 'DELETE', `/visits/${id}`)).statusCode).toBe(404);
    expect((await visit(BOB, { completesVisitId: id })).statusCode).toBe(404);
    expect((await call(ALICE, 'GET', '/visits')).json()[0]).toMatchObject({ notes: 'Miopía estable, lentes -2.25', nextDone: false });
    expect((await call(ALICE, 'GET', '/visits')).statusCode).toBe(200);
  });

  it('pide sesión', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/health/visits' })).statusCode).toBe(401);
  });

  it('la bitácora no guarda datos médicos', async () => {
    const { id } = (await visit(ALICE)).json();
    await call(ALICE, 'PATCH', `/visits/${id}`, { notes: 'Presión alta', specialty: 'Cardiología' });
    await call(ALICE, 'DELETE', `/visits/${id}`);
    const log = JSON.stringify(fakes.auditLog);
    for (const secret of ['Oftalmología', 'Cardiología', 'Rojas', 'Visión', 'Miopía', 'Presión', '2026-06-10', '2026-12-10']) {
      expect(log).not.toContain(secret);
    }
    expect(fakes.auditLog.find((entry) => entry.action === 'health.visit.updated')?.metadata).toEqual({
      fields: ['notes', 'specialty'],
    });
  });

  it('se exporta y se borra con la cuenta', async () => {
    await visit(ALICE);
    await visit(BOB);
    const exported = (await app.inject({ method: 'GET', url: '/api/me/export', headers: bearer(ALICE) })).json();
    expect(exported.health.visits).toHaveLength(1);
    expect(exported.health.visits[0].specialty).toBe('Oftalmología');

    const deleted = await app.inject({
      method: 'DELETE',
      url: '/api/me',
      headers: bearer(ALICE),
      payload: { confirmation: DELETE_CONFIRMATION },
    });
    expect(deleted.statusCode).toBe(204);
    expect(fakes.health.visits.every((item) => item.userId === BOB.id)).toBe(true);
    expect(fakes.health.visits).toHaveLength(1);
  });
});
