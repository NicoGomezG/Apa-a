import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import type { AuthUser } from '../../lib/auth/token-verifier.js';
import { DELETE_CONFIRMATION } from '../account/account.routes.js';
import { ALICE, BOB, bearer, createFakeDeps, testEnv } from '../../test/fakes.js';
import { INVITE_TTL_DAYS, MAX_ACTIVE_INVITES } from './friends.routes.js';

const CAROL: AuthUser = { id: '0192f0a4-1c2b-7d3e-8f40-5a6b7c8d9e03', email: 'carol@example.com', suggestedName: 'Carol' };

let app: FastifyInstance;
let fakes: ReturnType<typeof createFakeDeps>;
let now: Date;

beforeEach(async () => {
  now = new Date('2026-11-25T15:00:00Z');
  fakes = createFakeDeps([ALICE, BOB, CAROL], () => now);
  app = await buildApp(testEnv, fakes.deps);
});

afterEach(async () => {
  await app.close();
});

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
const call = (user: AuthUser, method: Method, url: string, payload?: object) =>
  app.inject({ method, url: `/api${url}`, headers: bearer(user), ...(payload ? { payload } : {}) });

/** A invita y B acepta. */
async function befriend(a: AuthUser, b: AuthUser) {
  const invite = await call(a, 'POST', '/friends/invites');
  expect(invite.statusCode).toBe(201);
  const accepted = await call(b, 'POST', '/friends/accept', { code: invite.json().code });
  expect(accepted.statusCode).toBe(201);
}

describe('invitaciones y amistad', () => {
  it('A invita, B ve quién lo invita, acepta y quedan como amigos', async () => {
    await call(ALICE, 'PATCH', '/me', { displayName: 'Alice Pérez' });
    const invite = await call(ALICE, 'POST', '/friends/invites');
    expect(invite.statusCode).toBe(201);
    const { code, expiresAt } = invite.json();
    expect(code).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(new Date(expiresAt).getTime() - now.getTime()).toBe(INVITE_TTL_DAYS * 86_400_000);

    const preview = await call(BOB, 'GET', `/friends/invites/${code}/preview`);
    expect(preview.json()).toEqual({ inviterName: 'Alice Pérez', own: false, alreadyFriends: false });

    const accepted = await call(BOB, 'POST', '/friends/accept', { code });
    expect(accepted.statusCode).toBe(201);
    expect(accepted.json()).toMatchObject({ alreadyFriends: false, friend: { userId: ALICE.id, displayName: 'Alice Pérez' } });

    expect((await call(ALICE, 'GET', '/friends')).json().map((f: { userId: string }) => f.userId)).toEqual([BOB.id]);
    expect((await call(BOB, 'GET', '/friends')).json().map((f: { userId: string }) => f.userId)).toEqual([ALICE.id]);
    // La invitación es de un solo uso.
    expect((await call(CAROL, 'POST', '/friends/accept', { code })).statusCode).toBe(404);
    expect((await call(ALICE, 'GET', '/friends/invites')).json()).toEqual([]);
  });

  it('no puedes aceptar tu propia invitación ni una vencida, anulada o inventada', async () => {
    const { code, id } = (await call(ALICE, 'POST', '/friends/invites')).json();
    expect((await call(ALICE, 'POST', '/friends/accept', { code })).statusCode).toBe(400);
    expect((await call(ALICE, 'GET', `/friends/invites/${code}/preview`)).json().own).toBe(true);

    expect((await call(BOB, 'POST', '/friends/accept', { code: 'x'.repeat(32) })).statusCode).toBe(404);
    expect((await call(BOB, 'POST', '/friends/accept', { code: 'corto' })).statusCode).toBe(404);

    // Bob no puede anular la invitación de Alice; Alice sí.
    expect((await call(BOB, 'DELETE', `/friends/invites/${id}`)).statusCode).toBe(404);
    expect((await call(ALICE, 'DELETE', `/friends/invites/${id}`)).statusCode).toBe(204);
    expect((await call(BOB, 'POST', '/friends/accept', { code })).statusCode).toBe(404);

    const late = (await call(ALICE, 'POST', '/friends/invites')).json();
    now = new Date(now.getTime() + (INVITE_TTL_DAYS * 86_400_000 + 1000));
    expect((await call(BOB, 'GET', `/friends/invites/${late.code}/preview`)).statusCode).toBe(404);
    expect((await call(BOB, 'POST', '/friends/accept', { code: late.code })).statusCode).toBe(404);
    expect(fakes.friends.friendships).toHaveLength(0);
  });

  it('aceptar siendo ya amigos no duplica la amistad', async () => {
    await befriend(ALICE, BOB);
    const { code } = (await call(BOB, 'POST', '/friends/invites')).json();
    expect((await call(ALICE, 'GET', `/friends/invites/${code}/preview`)).json().alreadyFriends).toBe(true);
    const again = await call(ALICE, 'POST', '/friends/accept', { code });
    expect(again.statusCode).toBe(200);
    expect(again.json().alreadyFriends).toBe(true);
    expect(fakes.friends.friendships).toHaveLength(1);
  });

  it('limita las invitaciones sin usar', async () => {
    for (let i = 0; i < MAX_ACTIVE_INVITES; i += 1) expect((await call(ALICE, 'POST', '/friends/invites')).statusCode).toBe(201);
    expect((await call(ALICE, 'POST', '/friends/invites')).statusCode).toBe(409);
    // Las de Alice no se ven desde otra cuenta.
    expect((await call(BOB, 'GET', '/friends/invites')).json()).toEqual([]);
  });

  it('el amigo ve tu nombre y cumpleaños (día y mes), nunca el año ni el correo', async () => {
    await call(ALICE, 'PATCH', '/me', { displayName: 'Alice', birthDay: 14, birthMonth: 2, birthYear: 1992 });
    await befriend(ALICE, BOB);
    const [friend] = (await call(BOB, 'GET', '/friends')).json();
    expect(friend).toMatchObject({ userId: ALICE.id, displayName: 'Alice', birthDay: 14, birthMonth: 2 });
    const raw = JSON.stringify(friend);
    expect(raw).not.toContain('1992');
    expect(raw).not.toContain('birthYear');
    expect(raw).not.toContain(ALICE.email!);
    // Un tercero no ve a nadie.
    expect((await call(CAROL, 'GET', '/friends')).json()).toEqual([]);
  });

  it('enlaza un contacto propio con un amigo, solo con contactos tuyos y amigos tuyos', async () => {
    await befriend(ALICE, BOB);
    const aliceContact = (await call(ALICE, 'POST', '/people/contacts', { name: 'Bob' })).json();
    const carolContact = (await call(CAROL, 'POST', '/people/contacts', { name: 'Alguien' })).json();

    const linked = await call(ALICE, 'PATCH', `/friends/${BOB.id}`, { contactId: aliceContact.id });
    expect(linked.statusCode).toBe(200);
    expect(linked.json().contactId).toBe(aliceContact.id);
    expect((await call(ALICE, 'GET', '/people/contacts')).json()[0].friendUserId).toBe(BOB.id);

    expect((await call(ALICE, 'PATCH', `/friends/${BOB.id}`, { contactId: carolContact.id })).statusCode).toBe(404);
    expect((await call(ALICE, 'PATCH', `/friends/${CAROL.id}`, { contactId: aliceContact.id })).statusCode).toBe(404);

    expect((await call(ALICE, 'PATCH', `/friends/${BOB.id}`, { contactId: null })).json().contactId).toBeNull();
  });

  it('eliminar la amistad la borra para ambos', async () => {
    await befriend(ALICE, BOB);
    expect((await call(CAROL, 'DELETE', `/friends/${ALICE.id}`)).statusCode).toBe(404);
    expect((await call(BOB, 'DELETE', `/friends/${ALICE.id}`)).statusCode).toBe(204);
    expect((await call(ALICE, 'GET', '/friends')).json()).toEqual([]);
  });
});

describe('cumpleaños propio', () => {
  it('se guarda en el perfil y se valida', async () => {
    const ok = await call(ALICE, 'PATCH', '/me', { birthDay: 29, birthMonth: 2 });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ birthDay: 29, birthMonth: 2, birthYear: null, displayName: 'Alice' });
    expect((await call(ALICE, 'PATCH', '/me', { birthYear: 1993 })).statusCode).toBe(400); // 1993 no fue bisiesto
    expect((await call(ALICE, 'PATCH', '/me', { birthDay: 31, birthMonth: 4 })).statusCode).toBe(400);
    expect((await call(ALICE, 'PATCH', '/me', { birthMonth: null })).statusCode).toBe(400); // queda el día sin mes
    expect((await call(ALICE, 'PATCH', '/me', {})).statusCode).toBe(400);
  });

  it('la bitácora guarda qué campos cambiaron, no la fecha', async () => {
    await call(ALICE, 'PATCH', '/me', { birthDay: 14, birthMonth: 2, birthYear: 1992 });
    const entry = fakes.auditLog.find((item) => item.action === 'profile.updated');
    expect(entry?.metadata).toEqual({ fields: ['birthDay', 'birthMonth', 'birthYear'] });
    expect(JSON.stringify(fakes.auditLog)).not.toContain('1992');
  });
});

describe('teléfono compartido', () => {
  it('el amigo ve tu teléfono solo si eliges compartirlo; un tercero nunca', async () => {
    const saved = await call(ALICE, 'PATCH', '/me', { phone: '+56 9 1234 5678' });
    expect(saved.json()).toMatchObject({ phone: '+56 9 1234 5678', sharePhone: false });
    await befriend(ALICE, BOB);
    expect((await call(BOB, 'GET', '/friends')).json()[0].phone).toBeNull();

    await call(ALICE, 'PATCH', '/me', { sharePhone: true });
    expect((await call(BOB, 'GET', '/friends')).json()[0].phone).toBe('+56 9 1234 5678');
    expect(JSON.stringify((await call(CAROL, 'GET', '/friends')).json())).not.toContain('1234');

    // Al terminar la amistad deja de verlo.
    await call(BOB, 'DELETE', `/friends/${ALICE.id}`);
    expect(JSON.stringify((await call(BOB, 'GET', '/friends')).json())).not.toContain('1234');
  });

  it('valida el formato, se borra con texto vacío y la bitácora no guarda el número', async () => {
    expect((await call(ALICE, 'PATCH', '/me', { phone: 'llámame' })).statusCode).toBe(400);
    await call(ALICE, 'PATCH', '/me', { phone: '+56 9 1234 5678', sharePhone: true });
    expect((await call(ALICE, 'PATCH', '/me', { phone: '' })).json().phone).toBeNull();
    expect(JSON.stringify(fakes.auditLog)).not.toContain('1234');
  });
});

describe('apodo de un amigo', () => {
  it('lo pone uno, crea el contacto enlazado si falta, y el amigo no lo ve', async () => {
    await call(BOB, 'PATCH', '/me', { displayName: 'Roberto' });
    await befriend(ALICE, BOB);

    const set = await call(ALICE, 'PUT', `/friends/${BOB.id}/nickname`, { nickname: 'Tito' });
    expect(set.statusCode).toBe(200);
    expect(set.json()).toMatchObject({ nickname: 'Tito', displayName: 'Roberto' });
    const [contact] = (await call(ALICE, 'GET', '/people/contacts')).json();
    expect(contact).toMatchObject({ name: 'Roberto', nickname: 'Tito', friendUserId: BOB.id });
    expect(set.json().contactId).toBe(contact.id);

    // Cambiarlo reusa el mismo contacto; vacío lo borra.
    await call(ALICE, 'PUT', `/friends/${BOB.id}/nickname`, { nickname: 'Robe' });
    expect((await call(ALICE, 'GET', '/people/contacts')).json()).toHaveLength(1);
    expect((await call(ALICE, 'PUT', `/friends/${BOB.id}/nickname`, { nickname: '' })).json().nickname).toBeNull();
    await call(ALICE, 'PUT', `/friends/${BOB.id}/nickname`, { nickname: 'Robe' });

    // Bob no ve cómo le dice Alice, y la bitácora no guarda el apodo.
    expect(JSON.stringify((await call(BOB, 'GET', '/friends')).json())).not.toContain('Robe');
    expect(JSON.stringify(fakes.auditLog)).not.toContain('Robe');
  });

  it('solo para amigos propios', async () => {
    expect((await call(ALICE, 'PUT', `/friends/${BOB.id}/nickname`, { nickname: 'X' })).statusCode).toBe(404);
    await befriend(ALICE, BOB);
    expect((await call(CAROL, 'PUT', `/friends/${BOB.id}/nickname`, { nickname: 'X' })).statusCode).toBe(404);
    expect((await call(CAROL, 'GET', '/people/contacts')).json()).toEqual([]);
    expect((await call(ALICE, 'PUT', `/friends/${BOB.id}/nickname`, { nickname: 'x'.repeat(41) })).statusCode).toBe(400);
  });
});

describe('grupos compartidos con amigos', () => {
  /** Grupo de Alice con Bob enlazado y un gasto de 30.000 pagado por Alice, en partes iguales entre 3. */
  async function aliceGroupWithBob() {
    await befriend(ALICE, BOB);
    const created = await call(ALICE, 'POST', '/people/groups', {
      name: 'Asado',
      participants: [{ name: 'Bob', friendId: BOB.id }, { name: 'Dani' }],
    });
    expect(created.statusCode).toBe(201);
    const group = created.json();
    const [me, bob, dani] = group.participants as { id: string; linkedUserId: string | null }[];
    expect(bob!.linkedUserId).toBe(BOB.id);
    const expense = await call(ALICE, 'POST', `/people/groups/${group.group.id}/expenses`, {
      description: 'Carne',
      date: '2026-11-21',
      payerId: me!.id,
      mode: 'equal',
      amount: '30000',
      participantIds: [me!.id, bob!.id, dani!.id],
    });
    expect(expense.statusCode).toBe(201);
    return { groupId: group.group.id as string, me: me!.id, bob: bob!.id, dani: dani!.id };
  }

  it('el amigo ve el grupo y lo que debe, sin datos privados del dueño', async () => {
    const { groupId, bob, me } = await aliceGroupWithBob();
    await call(ALICE, 'POST', `/people/groups/${groupId}/share`);

    const list = (await call(BOB, 'GET', '/people/shared')).json();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: groupId, name: 'Asado', ownerName: 'Alice', myBalance: '-10000' });
    expect(list[0].youOwe).toEqual([{ fromId: bob, toId: me, amount: '10000' }]);

    const detail = await call(BOB, 'GET', `/people/shared/${groupId}`);
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({ youId: bob, ownerName: 'Alice' });
    const raw = detail.body;
    for (const secret of ['shareToken', 'contactId', 'linkedUserId', ALICE.id]) expect(raw).not.toContain(secret);

    // Bob no es dueño: las rutas del dueño no le sirven.
    expect((await call(BOB, 'GET', `/people/groups/${groupId}`)).statusCode).toBe(404);
  });

  it('un tercero no ve el grupo ni puede informar pagos', async () => {
    const { groupId, me } = await aliceGroupWithBob();
    expect((await call(CAROL, 'GET', '/people/shared')).json()).toEqual([]);
    expect((await call(CAROL, 'GET', `/people/shared/${groupId}`)).statusCode).toBe(404);
    const report = await call(CAROL, 'POST', `/people/shared/${groupId}/settlements`, { toId: me, amount: '1', date: '2026-11-25' });
    expect(report.statusCode).toBe(404);
  });

  it('solo se enlaza a amigos, una vez por grupo', async () => {
    const { groupId, dani } = await aliceGroupWithBob();
    const stranger = await call(ALICE, 'POST', `/people/groups/${groupId}/participants`, { name: 'Carol', friendId: CAROL.id });
    expect(stranger.statusCode).toBe(404);
    const twice = await call(ALICE, 'POST', `/people/groups/${groupId}/participants`, { name: 'Bob 2', friendId: BOB.id });
    expect(twice.statusCode).toBe(409);
    expect((await call(ALICE, 'PATCH', `/people/groups/${groupId}/participants/${dani}`, { friendId: BOB.id })).statusCode).toBe(409);
    const create = await call(ALICE, 'POST', '/people/groups', { name: 'X', participants: [{ name: 'C', friendId: CAROL.id }] });
    expect(create.statusCode).toBe(404);
  });

  it('el amigo informa un pago; no cuenta hasta que el dueño lo confirma', async () => {
    const { groupId, me, bob } = await aliceGroupWithBob();
    const report = await call(BOB, 'POST', `/people/shared/${groupId}/settlements`, { toId: me, amount: '10000', date: '2026-11-25' });
    expect(report.statusCode).toBe(201);
    expect(report.json()).toMatchObject({ fromId: bob, toId: me, confirmed: false, reportedByYou: true });
    const settlementId = report.json().id;

    const before = (await call(ALICE, 'GET', `/people/groups/${groupId}`)).json();
    expect(before.balances.find((b: { participantId: string }) => b.participantId === bob).balance).toBe('-10000');
    expect(before.settlements[0]).toMatchObject({ confirmed: false, reportedBy: BOB.id });
    expect((await call(ALICE, 'GET', '/people/groups')).json()[0].pendingPayments).toBe(1);

    // Bob no puede confirmarse a sí mismo; Alice sí.
    expect((await call(BOB, 'POST', `/people/groups/${groupId}/settlements/${settlementId}/confirm`)).statusCode).toBe(404);
    expect((await call(ALICE, 'POST', `/people/groups/${groupId}/settlements/${settlementId}/confirm`)).statusCode).toBe(200);

    const after = (await call(BOB, 'GET', `/people/shared/${groupId}`)).json();
    expect(after.balances.find((b: { participantId: string }) => b.participantId === bob).balance).toBe('0');
    // Ya confirmado, Bob no puede retirarlo.
    expect((await call(BOB, 'DELETE', `/people/shared/${groupId}/settlements/${settlementId}`)).statusCode).toBe(404);
  });

  it('el amigo puede retirar un pago aún sin confirmar, y no puede pagarse a sí mismo', async () => {
    const { groupId, me, bob } = await aliceGroupWithBob();
    expect((await call(BOB, 'POST', `/people/shared/${groupId}/settlements`, { toId: bob, amount: '1', date: '2026-11-25' })).statusCode).toBe(400);
    const { id } = (await call(BOB, 'POST', `/people/shared/${groupId}/settlements`, { toId: me, amount: '500', date: '2026-11-25' })).json();
    expect((await call(BOB, 'DELETE', `/people/shared/${groupId}/settlements/${id}`)).statusCode).toBe(204);
    expect((await call(ALICE, 'GET', `/people/groups/${groupId}`)).json().settlements).toEqual([]);
  });

  it('el enlace de invitados no muestra pagos sin confirmar', async () => {
    const { groupId, me } = await aliceGroupWithBob();
    const { token } = (await call(ALICE, 'POST', `/people/groups/${groupId}/share`)).json();
    await call(BOB, 'POST', `/people/shared/${groupId}/settlements`, { toId: me, amount: '10000', date: '2026-11-25' });
    const pub = await app.inject({ method: 'GET', url: `/api/public/splits/${token}` });
    expect(pub.json().settlements).toEqual([]);
  });

  it('recordatorio de pago: solo a amigos que deben, uno por día', async () => {
    const { groupId, bob, dani, me } = await aliceGroupWithBob();
    const sent = await call(ALICE, 'POST', `/people/groups/${groupId}/participants/${bob}/remind`);
    expect(sent.statusCode).toBe(200);
    expect((await call(BOB, 'GET', '/people/shared')).json()[0].remindedAt).toBe(now.toISOString());

    expect((await call(ALICE, 'POST', `/people/groups/${groupId}/participants/${bob}/remind`)).statusCode).toBe(409);
    now = new Date(now.getTime() + 21 * 3600 * 1000);
    expect((await call(ALICE, 'POST', `/people/groups/${groupId}/participants/${bob}/remind`)).statusCode).toBe(200);

    expect((await call(ALICE, 'POST', `/people/groups/${groupId}/participants/${dani}/remind`)).statusCode).toBe(400);
    expect((await call(ALICE, 'POST', `/people/groups/${groupId}/participants/${me}/remind`)).statusCode).toBe(400);
    expect((await call(BOB, 'POST', `/people/groups/${groupId}/participants/${bob}/remind`)).statusCode).toBe(404);
  });

  it('no se recuerda a quien no debe', async () => {
    const { groupId, bob, me } = await aliceGroupWithBob();
    await call(ALICE, 'POST', `/people/groups/${groupId}/settlements`, { fromId: bob, toId: me, amount: '10000', date: '2026-11-25' });
    expect((await call(ALICE, 'POST', `/people/groups/${groupId}/participants/${bob}/remind`)).statusCode).toBe(409);
  });

  it('al terminar la amistad, el amigo deja de ver el grupo', async () => {
    const { groupId } = await aliceGroupWithBob();
    await call(ALICE, 'DELETE', `/friends/${BOB.id}`);
    expect((await call(BOB, 'GET', '/people/shared')).json()).toEqual([]);
    expect((await call(BOB, 'GET', `/people/shared/${groupId}`)).statusCode).toBe(404);
    const detail = (await call(ALICE, 'GET', `/people/groups/${groupId}`)).json();
    expect(detail.participants.every((p: { linkedUserId: string | null }) => p.linkedUserId === null)).toBe(true);
  });

  it('si el amigo borra su cuenta, se deshacen sus enlaces y sus pagos sin confirmar', async () => {
    const { groupId, me } = await aliceGroupWithBob();
    await call(BOB, 'POST', `/people/shared/${groupId}/settlements`, { toId: me, amount: '10000', date: '2026-11-25' });
    expect((await call(BOB, 'DELETE', '/me', { confirmation: DELETE_CONFIRMATION })).statusCode).toBe(204);
    const detail = (await call(ALICE, 'GET', `/people/groups/${groupId}`)).json();
    expect(detail.settlements).toEqual([]);
    expect(detail.participants.every((p: { linkedUserId: string | null }) => p.linkedUserId === null)).toBe(true);
    expect((await call(ALICE, 'GET', '/friends')).json()).toEqual([]);
  });

  it('la exportación incluye el vínculo con amigos, sin sus datos', async () => {
    await call(BOB, 'PATCH', '/me', { displayName: 'Roberto', birthDay: 3, birthMonth: 5 });
    await befriend(ALICE, BOB);
    const exported = await call(ALICE, 'GET', '/me/export');
    expect(exported.json().friends).toEqual([{ friendUserId: BOB.id, since: expect.any(String), contactId: null }]);
    expect(exported.body).not.toContain('Roberto');
  });

  it('la bitácora no guarda nombres ni montos', async () => {
    const { groupId, me, bob } = await aliceGroupWithBob();
    await call(BOB, 'POST', `/people/shared/${groupId}/settlements`, { toId: me, amount: '10000', date: '2026-11-25' });
    await call(ALICE, 'POST', `/people/groups/${groupId}/participants/${bob}/remind`);
    const log = JSON.stringify(fakes.auditLog);
    for (const secret of ['Asado', 'Bob', 'Dani', '10000', '30000']) expect(log).not.toContain(secret);
    expect(fakes.auditLog.map((entry) => entry.action)).toEqual(
      expect.arrayContaining(['friends.accepted', 'people.settlement.reported', 'people.reminder.sent']),
    );
  });
});
