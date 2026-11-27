import type { PrismaClient } from '../../generated/prisma/client.js';
import { orderedPair } from '../friends/friends.repository.js';

// Chat entre amigos y en grupos de gastos. La conversación se identifica con una clave:
// "friend:<userA>:<userB>" (par ordenado, como las amistades) o "group:<groupId>".
// El repositorio no decide quién puede leer o escribir: eso lo validan las rutas.

export const friendThreadKey = (a: string, b: string) => {
  const pair = orderedPair(a, b);
  return `friend:${pair.userAId}:${pair.userBId}`;
};
export const groupThreadKey = (groupId: string) => `group:${groupId}`;

/** El otro integrante de una conversación de amigos, o null si la clave no es de esa persona. */
export function friendFromKey(key: string, userId: string): string | null {
  const [kind, a, b] = key.split(':');
  if (kind !== 'friend' || !a || !b) return null;
  if (a === userId) return b;
  if (b === userId) return a;
  return null;
}

export interface ChatMessageRecord {
  id: string;
  threadKey: string;
  authorId: string;
  body: string;
  createdAt: Date;
}

export interface ThreadSummary {
  lastBody: string;
  lastAt: Date;
  lastAuthorId: string;
  unread: number;
}

/** Grupo con chat visible para una persona: es la dueña o un amigo enlazado. */
export interface ChatGroupAccess {
  groupId: string;
  name: string;
  ownerId: string;
  /** Nombre (el que puso el dueño en el grupo) de cada cuenta con acceso: dueño y amigos enlazados. */
  names: Map<string, string>;
}

export interface MessageQuery {
  /** Mensajes desde este instante (inclusive): para traer lo nuevo. */
  after?: Date;
  /** Mensajes anteriores a este instante: para cargar más arriba. */
  before?: Date;
  limit: number;
}

export interface ChatRepository {
  /** Grupos propios y ajenos (como amigo enlazado) a los que la persona tiene acceso. */
  listGroupsFor(userId: string): Promise<ChatGroupAccess[]>;
  groupFor(userId: string, groupId: string): Promise<ChatGroupAccess | null>;
  /** Claves de conversaciones de amigos con mensajes en las que participa (incluye ex amigos). */
  friendThreadKeys(userId: string): Promise<string[]>;
  /** Último mensaje y no leídos de cada conversación que tenga mensajes. */
  summaries(userId: string, keys: string[]): Promise<Map<string, ThreadSummary>>;
  /** Mensajes en orden cronológico. */
  listMessages(threadKey: string, query: MessageQuery): Promise<ChatMessageRecord[]>;
  createMessage(data: { threadKey: string; groupId: string | null; authorId: string; body: string }): Promise<ChatMessageRecord>;
  markRead(userId: string, threadKey: string, groupId: string | null, at: Date): Promise<void>;
  /** Mensajes escritos por la persona (exportación de datos). */
  exportAll(userId: string): Promise<ChatMessageRecord[]>;
}

export function createPrismaChatRepository(prisma: PrismaClient): ChatRepository {
  const messageSelect = { id: true, threadKey: true, authorId: true, body: true, createdAt: true } as const;
  const groupSelect = {
    id: true,
    name: true,
    userId: true,
    participants: { select: { name: true, isMe: true, linkedUserId: true } },
  } as const;

  type GroupRow = {
    id: string;
    name: string;
    userId: string;
    participants: { name: string; isMe: boolean; linkedUserId: string | null }[];
  };
  const toAccess = (row: GroupRow): ChatGroupAccess => {
    const names = new Map<string, string>();
    names.set(row.userId, row.participants.find((item) => item.isMe)?.name ?? row.name);
    for (const participant of row.participants) {
      if (participant.linkedUserId && participant.linkedUserId !== row.userId) names.set(participant.linkedUserId, participant.name);
    }
    return { groupId: row.id, name: row.name, ownerId: row.userId, names };
  };
  const accessWhere = (userId: string) => ({
    OR: [{ userId }, { participants: { some: { linkedUserId: userId } } }],
  });

  return {
    async listGroupsFor(userId) {
      const rows = await prisma.splitGroup.findMany({ where: accessWhere(userId), select: groupSelect });
      return rows.map(toAccess);
    },

    async groupFor(userId, groupId) {
      const row = await prisma.splitGroup.findFirst({ where: { id: groupId, ...accessWhere(userId) }, select: groupSelect });
      return row ? toAccess(row) : null;
    },

    async friendThreadKeys(userId) {
      const rows = await prisma.chatMessage.findMany({
        where: { groupId: null, threadKey: { startsWith: 'friend:', contains: userId } },
        distinct: ['threadKey'],
        select: { threadKey: true },
      });
      return rows.map((row) => row.threadKey).filter((key) => friendFromKey(key, userId) !== null);
    },

    async summaries(userId, keys) {
      if (keys.length === 0) return new Map();
      const rows = await prisma.$queryRaw<
        { thread_key: string; body: string; created_at: Date; author_id: string; unread: bigint }[]
      >`
        SELECT DISTINCT ON (m.thread_key) m.thread_key, m.body, m.created_at, m.author_id,
          (SELECT count(*) FROM "app"."chat_messages" u
            WHERE u.thread_key = m.thread_key
              AND u.author_id <> ${userId}::uuid
              AND u.created_at > COALESCE(
                (SELECT r.last_read_at FROM "app"."chat_reads" r WHERE r.user_id = ${userId}::uuid AND r.thread_key = m.thread_key),
                '-infinity'::timestamptz)) AS unread
        FROM "app"."chat_messages" m
        WHERE m.thread_key = ANY(${keys}::text[])
        ORDER BY m.thread_key, m.created_at DESC, m.id DESC`;
      return new Map(
        rows.map((row) => [
          row.thread_key,
          { lastBody: row.body, lastAt: row.created_at, lastAuthorId: row.author_id, unread: Number(row.unread) },
        ]),
      );
    },

    async listMessages(threadKey, { after, before, limit }) {
      if (after) {
        return prisma.chatMessage.findMany({
          where: { threadKey, createdAt: { gte: after } },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: limit,
          select: messageSelect,
        });
      }
      const rows = await prisma.chatMessage.findMany({
        where: { threadKey, ...(before ? { createdAt: { lt: before } } : {}) },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
        select: messageSelect,
      });
      return rows.reverse();
    },

    async createMessage(data) {
      return prisma.chatMessage.create({ data, select: messageSelect });
    },

    async markRead(userId, threadKey, groupId, at) {
      await prisma.chatRead.upsert({
        where: { userId_threadKey: { userId, threadKey } },
        create: { userId, threadKey, groupId, lastReadAt: at },
        update: { lastReadAt: at },
      });
    },

    async exportAll(userId) {
      return prisma.chatMessage.findMany({
        where: { authorId: userId },
        orderBy: { createdAt: 'asc' },
        select: messageSelect,
      });
    },
  };
}
