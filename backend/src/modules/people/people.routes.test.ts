import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { DELETE_CONFIRMATION } from '../account/account.routes.js';
import { ALICE, BOB, bearer, createFakeDeps, testEnv } from '../../test/fakes.js';

let app: FastifyInstance;
let fakes: ReturnType<typeof createFakeDeps>;

const NOW = new Date('2026-11-25T15:00:00Z');

beforeEach(async () => {
  fakes = createFakeDeps(undefined, () => NOW);
  app = await buildApp(testEnv, fakes.deps);
});

afterEach(async () => {
  await app.close();
});

type User = typeof ALICE;

const call = (user: User, method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: object) =>
  app.inject({ method, url: `/api/people${url}`, headers: bearer(user), ...(payload ? { payload } : {}) });

const contactPayload = {
  name: 'Camila Rojas',
  nickname: 'Cami',
  birthDay: 3,
  birthMonth: 12,
  birthYear: 1994,
  phone: '+56 9 1234 5678',
  email: 'Cami@Correo.cl',
  relationship: 'amistad',
  notes: 'Le gusta el chocolate amargo',
};

async function createGroup(user: User, names = ['Ana', 'Beto']) {
  const res = await call(user, 'POST', '/groups', {
    name: 'Asado sábado',
    date: '2026-11-21',
    participants: names.map((name) => ({ name })),
  });
  expect(res.statusCode).toBe(201);
  return res.json() as {
    group: { id: string };
    participants: { id: string; name: string; isMe: boolean }[];
  };
}

describe('contactos', () => {
  it('crea, lista, edita y borra; el correo queda en minúsculas', async () => {
    const created = await call(ALICE, 'POST', '/contacts', contactPayload);
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ name: 'Camila Rojas', email: 'cami@correo.cl', birthDay: 3, birthMonth: 12 });
    const id = created.json().id as string;

    const updated = await call(ALICE, 'PATCH', `/contacts/${id}`, { nickname: '', birthYear: null });
    expect(updated.json()).toMatchObject({ nickname: null, birthYear: null });

    expect((await call(ALICE, 'GET', '/contacts')).json()).toHaveLength(1);
    expect((await call(ALICE, 'DELETE', `/contacts/${id}`)).statusCode).toBe(204);
    expect((await call(ALICE, 'GET', '/contacts')).json()).toEqual([]);
  });

  it('valida el cumpleaños', async () => {
    const bad = async (data: object) =>
      (await call(ALICE, 'POST', '/contacts', { name: 'X', ...data })).statusCode;
    expect(await bad({ birthDay: 31, birthMonth: 4 })).toBe(400); // 31 de abril
    expect(await bad({ birthDay: 10 })).toBe(400); // falta el mes
    expect(await bad({ birthYear: 1990 })).toBe(400); // año sin día
    expect(await bad({ birthDay: 29, birthMonth: 2, birthYear: 2023 })).toBe(400);
    expect(await bad({ birthDay: 1, birthMonth: 1, birthYear: 2030 })).toBe(400); // futuro
    expect(await bad({ birthDay: 29, birthMonth: 2 })).toBe(201); // sin año, 29-feb vale
  });

  it('la bitácora no guarda nombres, fechas ni datos de contacto', async () => {
    const created = await call(ALICE, 'POST', '/contacts', contactPayload);
    await call(ALICE, 'PATCH', `/contacts/${created.json().id}`, { phone: '+56 9 8765 4321' });
    const log = JSON.stringify(fakes.auditLog);
    for (const secret of ['Camila', 'Cami', 'correo.cl', '1234', '8765', '1994', 'chocolate']) {
      expect(log).not.toContain(secret);
    }
    expect(fakes.auditLog.at(-1)).toMatchObject({ action: 'people.contact.updated', metadata: { fields: ['phone'] } });
  });

  it('B no ve, no edita ni borra los contactos de A', async () => {
    const id = (await call(ALICE, 'POST', '/contacts', contactPayload)).json().id as string;
    expect((await call(BOB, 'GET', '/contacts')).json()).toEqual([]);
    expect((await call(BOB, 'PATCH', `/contacts/${id}`, { name: 'Mío' })).statusCode).toBe(404);
    expect((await call(BOB, 'DELETE', `/contacts/${id}`)).statusCode).toBe(404);
    expect((await call(ALICE, 'GET', '/contacts')).json()[0].name).toBe('Camila Rojas');
  });

  it('exige sesión', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/people/contacts' })).statusCode).toBe(401);
  });
});

describe('reparto de gastos', () => {
  it('crea el grupo con la persona dueña primero', async () => {
    const detail = await createGroup(ALICE);
    expect(detail.participants.map((p) => [p.name, p.isMe])).toEqual([
      ['Alice', true],
      ['Ana', false],
      ['Beto', false],
    ]);
  });

  it('boleta con ítems y propina 10 %: saldos y quién le debe a quién', async () => {
    const detail = await createGroup(ALICE);
    const [me, ana, beto] = detail.participants.map((p) => p.id) as [string, string, string];

    const res = await call(ALICE, 'POST', `/groups/${detail.group.id}/expenses`, {
      description: 'Restorán',
      date: '2026-11-21',
      payerId: me,
      mode: 'items',
      tipPercent: 10,
      items: [
        { description: 'Lomo a lo pobre', unitPrice: '12990', participantIds: [me] },
        { description: 'Ensalada', unitPrice: '9990', participantIds: [ana] },
        { description: 'Tabla', unitPrice: '15000', participantIds: [me, ana, beto] },
        { description: 'Bebida', quantity: 2, unitPrice: '1750', participantIds: [beto] },
      ],
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ subtotal: '41480', tip: '4148', total: '45628' });
    expect(res.json().items[3]).toMatchObject({ quantity: 2, amount: '3500' });

    const group = (await call(ALICE, 'GET', `/groups/${detail.group.id}`)).json();
    // Ana: 9.990 + 5.000 = 14.990 + 10 % (1.499) = 16.489 · Beto: 3.500 + 5.000 = 8.500 + 850 = 9.350.
    expect(group.transfers).toEqual([
      { fromId: ana, toId: me, amount: '16489' },
      { fromId: beto, toId: me, amount: '9350' },
    ]);
    expect(group.totalSpent).toBe('45628');

    // Ana paga: queda solo la deuda de Beto.
    const paid = await call(ALICE, 'POST', `/groups/${detail.group.id}/settlements`, {
      fromId: ana,
      toId: me,
      amount: '16489',
      date: '2026-11-22',
    });
    expect(paid.statusCode).toBe(201);
    const after = (await call(ALICE, 'GET', `/groups/${detail.group.id}`)).json();
    expect(after.transfers).toEqual([{ fromId: beto, toId: me, amount: '9350' }]);

    const list = (await call(ALICE, 'GET', '/groups')).json();
    expect(list[0]).toMatchObject({ name: 'Asado sábado', expenseCount: 1, myBalance: '9350', settled: false, shared: false });
    expect(list[0]).not.toHaveProperty('shareToken');
  });

  it('edita un gasto recalculando el reparto y lo borra', async () => {
    const detail = await createGroup(ALICE);
    const ids = detail.participants.map((p) => p.id);
    const created = (
      await call(ALICE, 'POST', `/groups/${detail.group.id}/expenses`, {
        description: 'Uber',
        date: '2026-11-21',
        payerId: ids[1],
        mode: 'equal',
        amount: '9000',
        participantIds: ids,
      })
    ).json();
    expect(created.shares.map((s: { consumption: string }) => s.consumption)).toEqual(['3000', '3000', '3000']);

    const replaced = await call(ALICE, 'PUT', `/groups/${detail.group.id}/expenses/${created.id}`, {
      description: 'Uber',
      date: '2026-11-21',
      payerId: ids[1],
      mode: 'equal',
      amount: '10000',
      participantIds: ids,
    });
    expect(replaced.json().shares.map((s: { consumption: string }) => s.consumption)).toEqual(['3334', '3333', '3333']);

    expect((await call(ALICE, 'DELETE', `/groups/${detail.group.id}/expenses/${created.id}`)).statusCode).toBe(204);
  });

  it('rechaza personas que no son del grupo', async () => {
    const mine = await createGroup(ALICE);
    const other = await createGroup(ALICE, ['Caro']);
    const res = await call(ALICE, 'POST', `/groups/${mine.group.id}/expenses`, {
      description: 'X',
      date: '2026-11-21',
      payerId: mine.participants[0]!.id,
      mode: 'equal',
      amount: '1000',
      participantIds: [other.participants[1]!.id],
    });
    expect(res.statusCode).toBe(400);
  });

  it('no deja quitar a alguien con gastos ni a uno mismo; sí a quien no tiene nada', async () => {
    const detail = await createGroup(ALICE, ['Ana', 'Beto', 'Caro']);
    const [me, ana, , caro] = detail.participants.map((p) => p.id) as [string, string, string, string];
    await call(ALICE, 'POST', `/groups/${detail.group.id}/expenses`, {
      description: 'Pan',
      date: '2026-11-21',
      payerId: me,
      mode: 'equal',
      amount: '2000',
      participantIds: [me, ana],
    });
    expect((await call(ALICE, 'DELETE', `/groups/${detail.group.id}/participants/${ana}`)).statusCode).toBe(409);
    expect((await call(ALICE, 'DELETE', `/groups/${detail.group.id}/participants/${me}`)).statusCode).toBe(409);
    expect((await call(ALICE, 'DELETE', `/groups/${detail.group.id}/participants/${caro}`)).statusCode).toBe(204);
  });

  it('asocia participantes a contactos propios, nunca ajenos', async () => {
    const bobContact = (await call(BOB, 'POST', '/contacts', { name: 'Secreto' })).json().id as string;
    const res = await call(ALICE, 'POST', '/groups', { name: 'G', participants: [{ name: 'X', contactId: bobContact }] });
    expect(res.statusCode).toBe(404);
  });

  it('B no ve ni toca los grupos de A', async () => {
    const detail = await createGroup(ALICE);
    const gid = detail.group.id;
    const me = detail.participants[0]!.id;
    expect((await call(BOB, 'GET', '/groups')).json()).toEqual([]);
    expect((await call(BOB, 'GET', `/groups/${gid}`)).statusCode).toBe(404);
    expect((await call(BOB, 'PATCH', `/groups/${gid}`, { name: 'Mío' })).statusCode).toBe(404);
    expect((await call(BOB, 'POST', `/groups/${gid}/participants`, { name: 'Intruso' })).statusCode).toBe(404);
    expect(
      (
        await call(BOB, 'POST', `/groups/${gid}/expenses`, {
          description: 'X',
          date: '2026-11-21',
          payerId: me,
          mode: 'equal',
          amount: '1000',
          participantIds: [me],
        })
      ).statusCode,
    ).toBe(404);
    expect((await call(BOB, 'POST', `/groups/${gid}/share`)).statusCode).toBe(404);
    expect((await call(BOB, 'DELETE', `/groups/${gid}`)).statusCode).toBe(404);
    expect((await call(ALICE, 'GET', `/groups/${gid}`)).statusCode).toBe(200);
  });
});

describe('enlace para invitados', () => {
  it('muestra el grupo sin sesión, sin datos de contacto, y se puede revocar', async () => {
    const contact = (await call(ALICE, 'POST', '/contacts', contactPayload)).json().id as string;
    const res = await call(ALICE, 'POST', '/groups', { name: 'Once', participants: [{ name: 'Cami', contactId: contact }] });
    const detail = res.json();
    const gid = detail.group.id as string;
    const [me, cami] = detail.participants.map((p: { id: string }) => p.id);
    await call(ALICE, 'POST', `/groups/${gid}/expenses`, {
      description: 'Pasteles',
      date: '2026-11-21',
      payerId: me,
      mode: 'equal',
      amount: '8000',
      participantIds: [me, cami],
      tipPercent: 10,
    });

    const { token } = (await call(ALICE, 'POST', `/groups/${gid}/share`)).json();
    expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/);

    const guest = await app.inject({ method: 'GET', url: `/api/public/splits/${token}` });
    expect(guest.statusCode).toBe(200);
    expect(guest.headers['cache-control']).toBe('no-store');
    const body = guest.json();
    expect(body.group).toEqual({ name: 'Once', date: null, currency: 'CLP' });
    expect(body.transfers).toEqual([{ fromId: cami, toId: me, amount: '4400' }]);
    const text = guest.body;
    expect(text).not.toContain(token);
    expect(text).not.toContain(contact);
    expect(text).not.toContain('correo.cl');

    // Generar uno nuevo invalida el anterior; desactivarlo corta el acceso.
    const second = (await call(ALICE, 'POST', `/groups/${gid}/share`)).json().token;
    expect((await app.inject({ method: 'GET', url: `/api/public/splits/${token}` })).statusCode).toBe(404);
    expect((await call(ALICE, 'DELETE', `/groups/${gid}/share`)).statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: `/api/public/splits/${second}` })).statusCode).toBe(404);
  });

  it('códigos inventados o mal formados no muestran nada', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/public/splits/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/public/splits/corto' })).statusCode).toBe(404);
  });
});

describe('exportación y eliminación de cuenta', () => {
  it('exporta contactos y grupos propios (sin el código del enlace) y los borra al eliminar la cuenta', async () => {
    await call(ALICE, 'POST', '/contacts', contactPayload);
    const detail = await createGroup(ALICE);
    await call(ALICE, 'POST', `/groups/${detail.group.id}/share`);
    await call(BOB, 'POST', '/contacts', { name: 'De Bob' });

    const exported = (await app.inject({ method: 'GET', url: '/api/me/export', headers: bearer(ALICE) })).json();
    expect(exported.people.contacts.map((c: { name: string }) => c.name)).toEqual(['Camila Rojas']);
    expect(exported.people.groups).toHaveLength(1);
    expect(exported.people.groups[0].group.shareToken).toBeNull();

    const deleted = await app.inject({
      method: 'DELETE',
      url: '/api/me',
      headers: bearer(ALICE),
      payload: { confirmation: DELETE_CONFIRMATION },
    });
    expect(deleted.statusCode).toBe(204);
    expect(fakes.people.contacts.map((c) => c.name)).toEqual(['De Bob']);
    expect(fakes.people.groups).toEqual([]);
  });
});
