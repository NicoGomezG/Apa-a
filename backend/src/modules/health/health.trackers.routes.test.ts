import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import type { AuthUser } from '../../lib/auth/token-verifier.js';
import { DELETE_CONFIRMATION } from '../account/account.routes.js';
import { ALICE, BOB, bearer, createFakeDeps, testEnv } from '../../test/fakes.js';
import { lastDoseNumber } from './health.trackers.routes.js';

let app: FastifyInstance;
let fakes: ReturnType<typeof createFakeDeps>;

beforeEach(async () => {
  fakes = createFakeDeps([ALICE, BOB], () => new Date('2026-12-01T15:00:00Z'));
  app = await buildApp(testEnv, fakes.deps);
});

afterEach(async () => {
  await app.close();
});

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
const call = (user: AuthUser, method: Method, url: string, payload?: object) =>
  app.inject({ method, url: `/api/health${url}`, headers: bearer(user), ...(payload ? { payload } : {}) });

const lenses = (user: AuthUser, payload: object = {}) =>
  call(user, 'POST', '/trackers', {
    kind: 'replacement',
    name: 'Lentes de contacto',
    everyDays: 30,
    startDate: '2026-11-15',
    notes: 'Acuvue -2.25',
    ...payload,
  });

const medicine = (user: AuthUser, payload: object = {}) =>
  call(user, 'POST', '/trackers', {
    kind: 'medication',
    name: 'Amoxicilina 500 mg',
    everyHours: 8,
    startTime: '08:00',
    startDate: '2026-12-01',
    endDate: '2026-12-07',
    notes: 'Con comida',
    ...payload,
  });

describe('lastDoseNumber', () => {
  it('cuenta las tomas hasta el fin del último día', () => {
    // 7 días cada 8 h desde las 08:00: 08, 16, 00… la última es el 7 a las 16:00 (n.º 19).
    expect(lastDoseNumber({ everyHours: 8, startTime: '08:00', startDate: '2026-12-01', endDate: '2026-12-07' })).toBe(19);
    expect(lastDoseNumber({ everyHours: 24, startTime: '22:00', startDate: '2026-12-01', endDate: '2026-12-01' })).toBe(0);
    expect(lastDoseNumber({ everyHours: 12, startTime: '09:30', startDate: '2026-12-01', endDate: null })).toBeNull();
  });
});

describe('recambios', () => {
  it('crea un recambio y registra "Los cambié" sin duplicar el mismo día', async () => {
    const created = await lenses(ALICE);
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      kind: 'replacement',
      name: 'Lentes de contacto',
      everyDays: 30,
      everyHours: null,
      startTime: null,
      startDate: '2026-11-15',
      events: [],
    });

    const { id } = created.json();
    const changed = await call(ALICE, 'POST', `/trackers/${id}/changes`, { day: '2026-12-01' });
    expect(changed.statusCode).toBe(201);
    expect(changed.json().events).toMatchObject([{ kind: 'changed', day: '2026-12-01', doseNumber: null }]);
    expect((await call(ALICE, 'POST', `/trackers/${id}/changes`, { day: '2026-12-01' })).json().events).toHaveLength(1);

    // Deshacer.
    const eventId = changed.json().events[0].id;
    expect((await call(ALICE, 'DELETE', `/trackers/${id}/events/${eventId}`)).json().events).toEqual([]);
  });

  it('valida días, nombre y que el cambio no sea antes del inicio', async () => {
    expect((await lenses(ALICE, { everyDays: 0 })).statusCode).toBe(400);
    expect((await lenses(ALICE, { everyDays: 1.5 })).statusCode).toBe(400);
    expect((await lenses(ALICE, { name: '' })).statusCode).toBe(400);
    expect((await lenses(ALICE, { startDate: '2026-02-30' })).statusCode).toBe(400);

    const { id } = (await lenses(ALICE)).json();
    expect((await call(ALICE, 'POST', `/trackers/${id}/changes`, { day: '2026-11-01' })).statusCode).toBe(400);
    expect((await call(ALICE, 'PUT', `/trackers/${id}/doses/0`, { status: 'taken' })).statusCode).toBe(400);
    expect((await call(ALICE, 'PATCH', `/trackers/${id}`, { everyHours: 8 })).statusCode).toBe(400);
    expect((await call(ALICE, 'PATCH', `/trackers/${id}`, { everyDays: 14 })).json().everyDays).toBe(14);
  });
});

describe('medicamentos', () => {
  it('crea un medicamento y marca tomas como tomadas u omitidas', async () => {
    const created = await medicine(ALICE);
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ kind: 'medication', everyHours: 8, startTime: '08:00', endDate: '2026-12-07', everyDays: null });

    const { id } = created.json();
    expect((await call(ALICE, 'PUT', `/trackers/${id}/doses/0`, { status: 'taken' })).statusCode).toBe(200);
    const skipped = (await call(ALICE, 'PUT', `/trackers/${id}/doses/1`, { status: 'skipped' })).json();
    expect(skipped.events.map((event: { doseNumber: number; kind: string }) => [event.doseNumber, event.kind]).sort()).toEqual([
      [0, 'taken'],
      [1, 'skipped'],
    ]);
    // Cambiar de idea reemplaza la marca.
    const retaken = (await call(ALICE, 'PUT', `/trackers/${id}/doses/1`, { status: 'taken' })).json();
    expect(retaken.events).toHaveLength(2);
    expect(retaken.events.every((event: { kind: string }) => event.kind === 'taken')).toBe(true);

    // Después del término (la última es la n.º 19) no se puede.
    expect((await call(ALICE, 'PUT', `/trackers/${id}/doses/19`, { status: 'taken' })).statusCode).toBe(200);
    expect((await call(ALICE, 'PUT', `/trackers/${id}/doses/20`, { status: 'taken' })).statusCode).toBe(400);
    expect((await call(ALICE, 'PUT', `/trackers/${id}/doses/-1`, { status: 'taken' })).statusCode).toBe(400);
    expect((await call(ALICE, 'PUT', `/trackers/${id}/doses/2`, { status: 'otro' })).statusCode).toBe(400);
    expect((await call(ALICE, 'POST', `/trackers/${id}/changes`, { day: '2026-12-02' })).statusCode).toBe(400);
  });

  it('valida hora, horas y término', async () => {
    expect((await medicine(ALICE, { startTime: '24:00' })).statusCode).toBe(400);
    expect((await medicine(ALICE, { startTime: '8:00' })).statusCode).toBe(400);
    expect((await medicine(ALICE, { everyHours: 0 })).statusCode).toBe(400);
    expect((await medicine(ALICE, { everyHours: 169 })).statusCode).toBe(400);
    expect((await medicine(ALICE, { endDate: '2026-11-30' })).statusCode).toBe(400);
    expect((await medicine(ALICE, { endDate: null })).json().endDate).toBeNull();
    expect((await medicine(ALICE, { kind: 'otro' })).statusCode).toBe(400);
  });

  it('cambiar el horario borra las tomas marcadas; cambiar el nombre no', async () => {
    const { id } = (await medicine(ALICE)).json();
    await call(ALICE, 'PUT', `/trackers/${id}/doses/0`, { status: 'taken' });

    const renamed = (await call(ALICE, 'PATCH', `/trackers/${id}`, { name: 'Amoxicilina', endDate: '2026-12-10' })).json();
    expect(renamed.events).toHaveLength(1);
    expect(renamed.endDate).toBe('2026-12-10');

    const moved = (await call(ALICE, 'PATCH', `/trackers/${id}`, { startTime: '09:00' })).json();
    expect(moved).toMatchObject({ startTime: '09:00', events: [] });

    expect((await call(ALICE, 'PATCH', `/trackers/${id}`, { endDate: '2026-11-01' })).statusCode).toBe(400);
    expect((await call(ALICE, 'PATCH', `/trackers/${id}`, { everyDays: 3 })).statusCode).toBe(400);
    expect((await call(ALICE, 'PATCH', `/trackers/${id}`, {})).statusCode).toBe(400);
    expect((await call(ALICE, 'DELETE', `/trackers/${id}`)).statusCode).toBe(204);
    expect((await call(ALICE, 'GET', '/trackers')).json()).toEqual([]);
  });
});

describe('seguimientos de salud', () => {
  it('el usuario B no ve, no edita, no marca ni borra los de A', async () => {
    const lens = (await lenses(ALICE)).json();
    const med = (await medicine(ALICE)).json();
    const changed = (await call(ALICE, 'POST', `/trackers/${lens.id}/changes`, { day: '2026-12-01' })).json();
    const eventId = changed.events[0].id;

    expect((await call(BOB, 'GET', '/trackers')).json()).toEqual([]);
    expect((await call(BOB, 'PATCH', `/trackers/${lens.id}`, { name: 'Mío' })).statusCode).toBe(404);
    expect((await call(BOB, 'POST', `/trackers/${lens.id}/changes`, { day: '2026-12-02' })).statusCode).toBe(404);
    expect((await call(BOB, 'PUT', `/trackers/${med.id}/doses/0`, { status: 'taken' })).statusCode).toBe(404);
    expect((await call(BOB, 'DELETE', `/trackers/${lens.id}/events/${eventId}`)).statusCode).toBe(404);
    expect((await call(BOB, 'DELETE', `/trackers/${lens.id}`)).statusCode).toBe(404);

    // Un evento solo se borra desde su propio seguimiento.
    const otherLens = (await lenses(ALICE, { name: 'Cepillo de dientes' })).json();
    expect((await call(ALICE, 'DELETE', `/trackers/${otherLens.id}/events/${eventId}`)).statusCode).toBe(404);

    const list = (await call(ALICE, 'GET', '/trackers')).json();
    expect(list).toHaveLength(3);
    expect(list[0]).toMatchObject({ name: 'Lentes de contacto', events: [{ day: '2026-12-01' }] });
    expect(fakes.health.events.filter((event) => event.doseNumber !== null)).toHaveLength(0);
  });

  it('pide sesión', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/health/trackers' })).statusCode).toBe(401);
  });

  it('la bitácora no guarda datos médicos', async () => {
    const lens = (await lenses(ALICE)).json();
    const med = (await medicine(ALICE)).json();
    await call(ALICE, 'POST', `/trackers/${lens.id}/changes`, { day: '2026-12-01' });
    await call(ALICE, 'PUT', `/trackers/${med.id}/doses/0`, { status: 'skipped' });
    await call(ALICE, 'PATCH', `/trackers/${med.id}`, { name: 'Ibuprofeno', notes: 'Dolor de muela' });
    await call(ALICE, 'DELETE', `/trackers/${med.id}`);

    const log = JSON.stringify(fakes.auditLog);
    for (const secret of ['Lentes', 'Acuvue', 'Amoxicilina', 'Ibuprofeno', 'muela', 'comida', '08:00', 'skipped', '2026-12-01']) {
      expect(log).not.toContain(secret);
    }
    expect(fakes.auditLog.find((entry) => entry.action === 'health.tracker.updated')?.metadata).toEqual({
      fields: ['name', 'notes'],
    });
  });

  it('se exporta (con todos los eventos) y se borra con la cuenta', async () => {
    const med = (await medicine(ALICE, { endDate: null, everyHours: 1 })).json();
    for (let dose = 0; dose < 70; dose += 1) await call(ALICE, 'PUT', `/trackers/${med.id}/doses/${dose}`, { status: 'taken' });
    await lenses(BOB);

    // La lista trae los recientes; la exportación, todo.
    expect((await call(ALICE, 'GET', '/trackers')).json()[0].events).toHaveLength(60);
    const exported = (await app.inject({ method: 'GET', url: '/api/me/export', headers: bearer(ALICE) })).json();
    expect(exported.health.trackers).toHaveLength(1);
    expect(exported.health.trackers[0].events).toHaveLength(70);

    const deleted = await app.inject({
      method: 'DELETE',
      url: '/api/me',
      headers: bearer(ALICE),
      payload: { confirmation: DELETE_CONFIRMATION },
    });
    expect(deleted.statusCode).toBe(204);
    expect(fakes.health.trackers.map((item) => item.userId)).toEqual([BOB.id]);
    expect(fakes.health.events).toHaveLength(0);
  });
});
