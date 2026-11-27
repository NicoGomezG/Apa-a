import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AppError, notFound } from '../../lib/errors.js';
import { text } from '../../lib/schemas.js';
import { currentUser } from '../../plugins/auth.js';
import type { AuditRepository } from '../audit/audit.repository.js';
import type { FriendsRepository } from '../friends/friends.repository.js';
import {
  type ChatMessageRecord,
  type ChatRepository,
  friendFromKey,
  friendThreadKey,
  groupThreadKey,
  type ThreadSummary,
} from './chat.repository.js';

// Chat entre amigos (solo mientras lo sean; después queda en solo lectura) y en grupos de
// gastos (dueño + amigos enlazados). Nunca expone ids de cuenta de otros integrantes del
// grupo: cada mensaje dice solo si es tuyo y el nombre que el dueño le puso a su autor.

export interface ChatRoutesDeps {
  chat: ChatRepository;
  friends: FriendsRepository;
  audit: AuditRepository;
  now?: () => Date;
}

export const MAX_MESSAGE_LENGTH = 2000;
export const PAGE_SIZE = 50;
const NEW_MESSAGES_LIMIT = 200;

const friendParams = z.object({ friendId: z.uuid() });
const groupParams = z.object({ groupId: z.uuid() });
const messagesQuery = z.object({
  after: z.iso.datetime({ offset: true }).optional(),
  before: z.iso.datetime({ offset: true }).optional(),
});
const messageBody = z.object({ body: text(MAX_MESSAGE_LENGTH) });

const forbidden = (message: string) => new AppError(403, 'FORBIDDEN', message);

interface Thread {
  key: string;
  groupId: string | null;
  title: string | null;
  canWrite: boolean;
  /** Nombre de cada autor visible en la conversación (por id de cuenta, nunca se envía el id). */
  authorName: (authorId: string) => string | null;
}

export const chatRoutes: FastifyPluginAsyncZod<ChatRoutesDeps> = async (app, deps) => {
  app.addHook('onRequest', app.authenticate);
  const now = deps.now ?? (() => new Date());

  // --- Acceso ------------------------------------------------------------------
  const friendThread = async (userId: string, friendId: string): Promise<Thread> => {
    const key = friendThreadKey(userId, friendId);
    const friend = (await deps.friends.listFriends(userId)).find((item) => item.userId === friendId);
    if (!friend) {
      // Ex amigos: pueden releer lo que hablaron, pero no escribir. Sin mensajes, no hay nada que ver.
      const existing = userId !== friendId && (await deps.chat.listMessages(key, { limit: 1 })).length > 0;
      if (!existing) throw notFound('No encontramos esa conversación');
      return { key, groupId: null, title: null, canWrite: false, authorName: () => null };
    }
    return { key, groupId: null, title: friend.displayName, canWrite: true, authorName: () => friend.displayName };
  };

  const groupThread = async (userId: string, groupId: string): Promise<Thread> => {
    const group = await deps.chat.groupFor(userId, groupId);
    if (!group) throw notFound('No encontramos esa conversación');
    return {
      key: groupThreadKey(groupId),
      groupId,
      title: group.name,
      canWrite: true,
      authorName: (authorId) => group.names.get(authorId) ?? null,
    };
  };

  const toMessage = (thread: Thread, userId: string) => (message: ChatMessageRecord) => ({
    id: message.id,
    body: message.body,
    createdAt: message.createdAt,
    mine: message.authorId === userId,
    authorName: message.authorId === userId ? null : thread.authorName(message.authorId),
  });

  // --- Lista de conversaciones -----------------------------------------------------
  const lastMessage = (summary: ThreadSummary | undefined, userId: string) =>
    summary ? { body: summary.lastBody, at: summary.lastAt, mine: summary.lastAuthorId === userId } : null;

  const listThreads = async (userId: string) => {
    const [friends, groups, pastKeys] = await Promise.all([
      deps.friends.listFriends(userId),
      deps.chat.listGroupsFor(userId),
      deps.chat.friendThreadKeys(userId),
    ]);
    const friendIds = new Set(friends.map((friend) => friend.userId));
    const pastFriends = pastKeys
      .map((key) => friendFromKey(key, userId))
      .filter((id): id is string => id !== null && !friendIds.has(id));

    const keys = [
      ...friends.map((friend) => friendThreadKey(userId, friend.userId)),
      ...pastFriends.map((id) => friendThreadKey(userId, id)),
      ...groups.map((group) => groupThreadKey(group.groupId)),
    ];
    const summaries = await deps.chat.summaries(userId, keys);

    const threads = [
      ...friends.map((friend) => {
        const summary = summaries.get(friendThreadKey(userId, friend.userId));
        return { kind: 'friend' as const, id: friend.userId, title: friend.displayName, readOnly: false, owned: false, summary };
      }),
      ...pastFriends.map((id) => {
        const summary = summaries.get(friendThreadKey(userId, id));
        return { kind: 'friend' as const, id, title: null, readOnly: true, owned: false, summary };
      }),
      ...groups
        // Un grupo sin amigos enlazados no tiene con quién conversar, salvo que ya tenga mensajes.
        .filter((group) => group.names.size > 1 || summaries.has(groupThreadKey(group.groupId)))
        .map((group) => {
          const summary = summaries.get(groupThreadKey(group.groupId));
          const owned = group.ownerId === userId;
          return { kind: 'group' as const, id: group.groupId, title: group.name, readOnly: false, owned, summary };
        }),
    ];

    return threads
      .sort((a, b) => {
        const byDate = (b.summary?.lastAt.getTime() ?? 0) - (a.summary?.lastAt.getTime() ?? 0);
        return byDate !== 0 ? byDate : (a.title ?? '').localeCompare(b.title ?? '');
      })
      .map(({ summary, ...thread }) => ({
        ...thread,
        lastMessage: lastMessage(summary, userId),
        unread: summary?.unread ?? 0,
      }));
  };

  app.get('/', async (request) => {
    const user = currentUser(request);
    const threads = await listThreads(user.id);
    return { threads, unread: threads.reduce((total, thread) => total + thread.unread, 0) };
  });

  app.get('/unread', async (request) => {
    const user = currentUser(request);
    const threads = await listThreads(user.id);
    return { unread: threads.reduce((total, thread) => total + thread.unread, 0) };
  });

  // --- Mensajes ------------------------------------------------------------------
  const readMessages = async (thread: Thread, userId: string, query: z.infer<typeof messagesQuery>) => {
    const messages = query.after
      ? await deps.chat.listMessages(thread.key, { after: new Date(query.after), limit: NEW_MESSAGES_LIMIT })
      : await deps.chat.listMessages(thread.key, {
          ...(query.before ? { before: new Date(query.before) } : {}),
          limit: PAGE_SIZE,
        });
    return {
      title: thread.title,
      readOnly: !thread.canWrite,
      hasMore: !query.after && messages.length === PAGE_SIZE,
      messages: messages.map(toMessage(thread, userId)),
    };
  };

  const send = async (thread: Thread, userId: string, body: string) => {
    if (!thread.canWrite) throw forbidden('Ya no son amigos: esta conversación es de solo lectura');
    const message = await deps.chat.createMessage({ threadKey: thread.key, groupId: thread.groupId, authorId: userId, body });
    // Solo el hecho y el id: el contenido nunca va a la bitácora.
    await deps.audit.record({ userId, action: 'chat.message.sent', entityType: 'chat_message', entityId: message.id });
    // Escribir también cuenta como haber leído hasta ahí.
    await deps.chat.markRead(userId, thread.key, thread.groupId, message.createdAt);
    return toMessage(thread, userId)(message);
  };

  const markRead = async (thread: Thread, userId: string) => {
    const [last] = await deps.chat.listMessages(thread.key, { limit: 1 });
    const at = last && last.createdAt > now() ? last.createdAt : now();
    await deps.chat.markRead(userId, thread.key, thread.groupId, at);
  };

  const sendLimit = { rateLimit: { max: 30, timeWindow: '1 minute' } };

  app.get('/friends/:friendId', { schema: { params: friendParams, querystring: messagesQuery } }, async (request) => {
    const user = currentUser(request);
    return readMessages(await friendThread(user.id, request.params.friendId), user.id, request.query);
  });

  app.post(
    '/friends/:friendId/messages',
    { schema: { params: friendParams, body: messageBody }, config: sendLimit },
    async (request, reply) => {
      const user = currentUser(request);
      const thread = await friendThread(user.id, request.params.friendId);
      return reply.status(201).send(await send(thread, user.id, request.body.body));
    },
  );

  app.post('/friends/:friendId/read', { schema: { params: friendParams } }, async (request, reply) => {
    const user = currentUser(request);
    await markRead(await friendThread(user.id, request.params.friendId), user.id);
    return reply.status(204).send();
  });

  app.get('/groups/:groupId', { schema: { params: groupParams, querystring: messagesQuery } }, async (request) => {
    const user = currentUser(request);
    return readMessages(await groupThread(user.id, request.params.groupId), user.id, request.query);
  });

  app.post(
    '/groups/:groupId/messages',
    { schema: { params: groupParams, body: messageBody }, config: sendLimit },
    async (request, reply) => {
      const user = currentUser(request);
      const thread = await groupThread(user.id, request.params.groupId);
      return reply.status(201).send(await send(thread, user.id, request.body.body));
    },
  );

  app.post('/groups/:groupId/read', { schema: { params: groupParams } }, async (request, reply) => {
    const user = currentUser(request);
    await markRead(await groupThread(user.id, request.params.groupId), user.id);
    return reply.status(204).send();
  });
};
