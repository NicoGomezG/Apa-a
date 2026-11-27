import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import type { AuthUser } from '../../lib/auth/token-verifier.js';
import { DELETE_CONFIRMATION } from '../account/account.routes.js';
import { ALICE, BOB, bearer, createFakeDeps, testEnv } from '../../test/fakes.js';
import { friendThreadKey } from './chat.repository.js';
import { MAX_MESSAGE_LENGTH, PAGE_SIZE } from './chat.routes.js';

const CAROL: AuthUser = { id: '0192f0a4-1c2b-7d3e-8f40-5a6b7c8d9e03', email: 'carol@example.com', suggestedName: 'Carol' };

let app: FastifyInstance;
let fakes: ReturnType<typeof createFakeDeps>;
let now: Date;

beforeEach(async () => {
  now = new Date('2026-11-26T15:00:00Z');
  fakes = createFakeDeps([ALICE, BOB, CAROL], () => now);
  app = await buildApp(testEnv, fakes.deps);
});

afterEach(async () => {
  await app.close();
});

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';
const call = (user: AuthUser, method: Method, url: string, payload?: object) =>
  app.inject({ method, url: `/api${url}`, headers: bearer(user), ...(payload ? { payload } : {}) });

const tick = (seconds = 1) => {
  now = new Date(now.getTime() + seconds * 1000);
};

async function befriend(a: AuthUser, b: AuthUser) {
  const invite = await call(a, 'POST', '/friends/invites');
  expect((await call(b, 'POST', '/friends/accept', { code: invite.json().code })).statusCode).toBe(201);
}

const say = (user: AuthUser, path: string, body: string) => call(user, 'POST', `/chats/${path}/messages`, { body });

describe('chat entre amigos', () => {
  beforeEach(async () => {
    await call(ALICE, 'PATCH', '/me', { displayName: 'Alice' });
    await call(BOB, 'PATCH', '/me', { displayName: 'Bob' });
    await befriend(ALICE, BOB);
  });

  it('se escriben, cada uno ve sus mensajes como propios y los no leídos se cuentan', async () => {
    const sent = await say(ALICE, `friends/${BOB.id}`, '  ¿Vamos el sábado?  ');
    expect(sent.statusCode).toBe(201);
    expect(sent.json()).toMatchObject({ body: '¿Vamos el sábado?', mine: true, authorName: null });
    tick();
    await say(ALICE, `friends/${BOB.id}`, 'Avísame');

    const bobList = (await call(BOB, 'GET', '/chats')).json();
    expect(bobList.unread).toBe(2);
    expect(bobList.threads[0]).toMatchObject({
      kind: 'friend',
      id: ALICE.id,
      title: 'Alice',
      readOnly: false,
      unread: 2,
      lastMessage: { body: 'Avísame', mine: false },
    });
    // Quien escribe no tiene no leídos.
    expect((await call(ALICE, 'GET', '/chats/unread')).json()).toEqual({ unread: 0 });

    const thread = (await call(BOB, 'GET', `/chats/friends/${ALICE.id}`)).json();
    expect(thread).toMatchObject({ title: 'Alice', readOnly: false, hasMore: false });
    expect(thread.messages.map((m: { body: string; mine: boolean; authorName: string }) => [m.body, m.mine, m.authorName])).toEqual([
      ['¿Vamos el sábado?', false, 'Alice'],
      ['Avísame', false, 'Alice'],
    ]);

    expect((await call(BOB, 'POST', `/chats/friends/${ALICE.id}/read`)).statusCode).toBe(204);
    expect((await call(BOB, 'GET', '/chats/unread')).json()).toEqual({ unread: 0 });

    tick();
    await say(BOB, `friends/${ALICE.id}`, 'Dale');
    expect((await call(ALICE, 'GET', '/chats/unread')).json()).toEqual({ unread: 1 });
  });

  it('trae solo lo nuevo con after y pagina hacia atrás con before', async () => {
    // Directo al repositorio: por la API, el límite de envíos (30 por minuto) cortaría antes.
    for (let i = 1; i <= PAGE_SIZE + 5; i += 1) {
      tick();
      await fakes.chat.repo.createMessage({ threadKey: friendThreadKey(ALICE.id, BOB.id), groupId: null, authorId: ALICE.id, body: `m${i}` });
    }
    const page = (await call(BOB, 'GET', `/chats/friends/${ALICE.id}`)).json();
    expect(page.messages).toHaveLength(PAGE_SIZE);
    expect(page.hasMore).toBe(true);
    expect(page.messages[0].body).toBe('m6');

    const older = (await call(BOB, 'GET', `/chats/friends/${ALICE.id}?before=${page.messages[0].createdAt}`)).json();
    expect(older.messages.map((m: { body: string }) => m.body)).toEqual(['m1', 'm2', 'm3', 'm4', 'm5']);

    const last = page.messages.at(-1).createdAt;
    tick();
    await say(ALICE, `friends/${BOB.id}`, 'nuevo');
    const fresh = (await call(BOB, 'GET', `/chats/friends/${ALICE.id}?after=${last}`)).json();
    // after es inclusive: el cliente descarta los que ya tiene por id.
    expect(fresh.messages.map((m: { body: string }) => m.body)).toEqual([`m${PAGE_SIZE + 5}`, 'nuevo']);
  });

  it('valida el texto', async () => {
    expect((await say(ALICE, `friends/${BOB.id}`, '   ')).statusCode).toBe(400);
    expect((await say(ALICE, `friends/${BOB.id}`, 'x'.repeat(MAX_MESSAGE_LENGTH + 1))).statusCode).toBe(400);
    expect((await say(ALICE, `friends/${BOB.id}`, 'x'.repeat(MAX_MESSAGE_LENGTH))).statusCode).toBe(201);
  });

  it('un tercero no lee ni escribe en la conversación de otros, ni le escribe a quien no es su amigo', async () => {
    await say(ALICE, `friends/${BOB.id}`, 'secreto');
    // Carol no es parte del par: la clave de la conversación siempre incluye a quien pregunta.
    expect((await call(CAROL, 'GET', `/chats/friends/${ALICE.id}`)).statusCode).toBe(404);
    expect((await call(CAROL, 'GET', `/chats/friends/${BOB.id}`)).statusCode).toBe(404);
    expect((await say(CAROL, `friends/${ALICE.id}`, 'hola')).statusCode).toBe(404);
    expect((await call(CAROL, 'GET', '/chats')).json()).toEqual({ threads: [], unread: 0 });
    expect(JSON.stringify((await call(CAROL, 'GET', '/chats')).json())).not.toContain('secreto');
    // Ni contigo misma.
    expect((await call(ALICE, 'GET', `/chats/friends/${ALICE.id}`)).statusCode).toBe(404);
  });

  it('al terminar la amistad queda en solo lectura y sin nombre', async () => {
    await say(ALICE, `friends/${BOB.id}`, 'hola');
    expect((await call(BOB, 'DELETE', `/friends/${ALICE.id}`)).statusCode).toBe(204);

    const thread = await call(ALICE, 'GET', `/chats/friends/${BOB.id}`);
    expect(thread.statusCode).toBe(200);
    expect(thread.json()).toMatchObject({ readOnly: true, title: null });
    expect((await say(ALICE, `friends/${BOB.id}`, 'sigo aquí')).statusCode).toBe(403);
    expect((await say(BOB, `friends/${ALICE.id}`, 'chao')).statusCode).toBe(403);

    const list = (await call(BOB, 'GET', '/chats')).json();
    expect(list.threads).toEqual([expect.objectContaining({ kind: 'friend', id: ALICE.id, title: null, readOnly: true })]);
  });

  it('la bitácora registra el envío, nunca el contenido', async () => {
    await say(ALICE, `friends/${BOB.id}`, 'mi clave del wifi es pato123');
    const entry = fakes.auditLog.find((item) => item.action === 'chat.message.sent');
    expect(entry).toMatchObject({ userId: ALICE.id, entityType: 'chat_message' });
    expect(JSON.stringify(fakes.auditLog)).not.toContain('pato123');
  });
});

describe('chat de grupos de gastos', () => {
  async function aliceGroupWithBob() {
    await call(ALICE, 'PATCH', '/me', { displayName: 'Alice' });
    await befriend(ALICE, BOB);
    const created = await call(ALICE, 'POST', '/people/groups', {
      name: 'Asado',
      participants: [{ name: 'Roberto', friendId: BOB.id }, { name: 'Dani' }],
    });
    expect(created.statusCode).toBe(201);
    return created.json().group.id as string;
  }

  it('el dueño y el amigo enlazado conversan; los nombres son los del grupo y no hay ids de cuenta', async () => {
    const groupId = await aliceGroupWithBob();
    expect((await say(ALICE, `groups/${groupId}`, 'Yo llevo el carbón')).statusCode).toBe(201);
    const unreadBefore = (await call(BOB, 'GET', '/chats')).json().threads.find((t: { kind: string }) => t.kind === 'group');
    expect(unreadBefore).toMatchObject({ id: groupId, title: 'Asado', unread: 1, owned: false });
    expect((await call(ALICE, 'GET', '/chats')).json().threads.find((t: { kind: string }) => t.kind === 'group').owned).toBe(true);
    tick();
    expect((await say(BOB, `groups/${groupId}`, 'Yo las bebidas')).statusCode).toBe(201);

    const aliceView = (await call(ALICE, 'GET', `/chats/groups/${groupId}`)).json();
    expect(aliceView.title).toBe('Asado');
    expect(aliceView.messages.map((m: { mine: boolean; authorName: string | null }) => [m.mine, m.authorName])).toEqual([
      [true, null],
      [false, 'Roberto'],
    ]);
    const bobView = await call(BOB, 'GET', `/chats/groups/${groupId}`);
    expect(bobView.json().messages[0]).toMatchObject({ mine: false, authorName: 'Alice' });
    for (const secret of [ALICE.id, BOB.id, 'authorId']) expect(bobView.body).not.toContain(secret);

    // Responder cuenta como haber leído; Alice tiene 1 sin leer.
    expect((await call(BOB, 'GET', '/chats/unread')).json()).toEqual({ unread: 0 });
    expect((await call(ALICE, 'GET', '/chats/unread')).json()).toEqual({ unread: 1 });
  });

  it('un tercero no ve ni escribe en el chat del grupo', async () => {
    const groupId = await aliceGroupWithBob();
    await say(ALICE, `groups/${groupId}`, 'privado');
    expect((await call(CAROL, 'GET', `/chats/groups/${groupId}`)).statusCode).toBe(404);
    expect((await say(CAROL, `groups/${groupId}`, 'hola')).statusCode).toBe(404);
    expect((await call(CAROL, 'POST', `/chats/groups/${groupId}/read`)).statusCode).toBe(404);
    expect((await call(CAROL, 'GET', '/chats')).json().threads).toEqual([]);
  });

  it('si el dueño desenlaza al amigo, este pierde el acceso; si borra el grupo, el chat se va con él', async () => {
    const groupId = await aliceGroupWithBob();
    await say(BOB, `groups/${groupId}`, 'hola');
    const participants = (await call(ALICE, 'GET', `/people/groups/${groupId}`)).json().participants;
    const bob = participants.find((p: { linkedUserId: string | null }) => p.linkedUserId === BOB.id);
    expect((await call(ALICE, 'PATCH', `/people/groups/${groupId}/participants/${bob.id}`, { friendId: null })).statusCode).toBe(200);

    expect((await call(BOB, 'GET', `/chats/groups/${groupId}`)).statusCode).toBe(404);
    // Alice sigue viendo el mensaje, sin nombre (ya no es parte del grupo).
    expect((await call(ALICE, 'GET', `/chats/groups/${groupId}`)).json().messages[0]).toMatchObject({ authorName: null });

    expect((await call(ALICE, 'DELETE', `/people/groups/${groupId}`)).statusCode).toBe(204);
    expect(fakes.chat.messages.filter((m) => m.groupId === groupId)).toHaveLength(1); // fila, pero inalcanzable
    expect((await call(ALICE, 'GET', `/chats/groups/${groupId}`)).statusCode).toBe(404);
    const groups = (await call(ALICE, 'GET', '/chats')).json().threads.filter((t: { kind: string }) => t.kind === 'group');
    expect(groups).toEqual([]);
  });

  it('un grupo sin amigos enlazados no aparece en la lista de conversaciones', async () => {
    await call(ALICE, 'POST', '/people/groups', { name: 'Solo', participants: [{ name: 'Dani' }] });
    expect((await call(ALICE, 'GET', '/chats')).json().threads).toEqual([]);
  });
});

describe('exportar y borrar cuenta', () => {
  it('exporta solo los mensajes propios y borrar la cuenta los elimina', async () => {
    await befriend(ALICE, BOB);
    await say(ALICE, `friends/${BOB.id}`, 'de Alice');
    await say(BOB, `friends/${ALICE.id}`, 'de Bob');

    const exported = (await call(ALICE, 'GET', '/me/export')).json();
    expect(exported.chat.map((m: { body: string }) => m.body)).toEqual(['de Alice']);

    expect((await call(ALICE, 'DELETE', '/me', { confirmation: DELETE_CONFIRMATION })).statusCode).toBe(204);
    expect(fakes.chat.messages.map((m) => m.body)).toEqual(['de Bob']);
    // Bob ya no es amigo de nadie: su conversación queda en solo lectura.
    expect((await call(BOB, 'GET', `/chats/friends/${ALICE.id}`)).json()).toMatchObject({ readOnly: true });
  });
});
