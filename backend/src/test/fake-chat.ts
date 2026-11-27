import { type ChatGroupAccess, type ChatMessageRecord, type ChatRepository, friendFromKey } from '../modules/chat/chat.repository.js';
import type { createFakePeople } from './fake-people.js';

/** Chat en memoria. Usa los grupos y participantes del fake de Personas (acceso y cascada al borrar). */
export function createFakeChat(people: ReturnType<typeof createFakePeople>, now: () => Date) {
  let sequence = 0;
  const nextId = () => `00000000-0000-7000-b000-${String((sequence += 1)).padStart(12, '0')}`;
  const messages: (ChatMessageRecord & { groupId: string | null })[] = [];
  const reads = new Map<string, { lastReadAt: Date; groupId: string | null }>();
  const readKey = (userId: string, threadKey: string) => `${userId}|${threadKey}`;

  const groupExists = (groupId: string | null) => groupId === null || people.groups.some((group) => group.id === groupId);
  /** Como ON DELETE CASCADE: lo de grupos borrados desaparece. */
  const live = () => messages.filter((message) => groupExists(message.groupId));
  const strip = ({ groupId: _groupId, ...message }: ChatMessageRecord & { groupId: string | null }): ChatMessageRecord => ({
    ...message,
  });

  const toAccess = (groupId: string): ChatGroupAccess | null => {
    const group = people.groups.find((item) => item.id === groupId);
    if (!group) return null;
    const participants = people.participants.filter((item) => item.groupId === groupId);
    const names = new Map<string, string>();
    names.set(group.userId, participants.find((item) => item.isMe)?.name ?? group.name);
    for (const participant of participants) {
      if (participant.linkedUserId && participant.linkedUserId !== group.userId) names.set(participant.linkedUserId, participant.name);
    }
    return { groupId, name: group.name, ownerId: group.userId, names };
  };
  const hasAccess = (userId: string, groupId: string) =>
    people.groups.some((group) => group.id === groupId && group.userId === userId) ||
    people.participants.some((item) => item.groupId === groupId && item.linkedUserId === userId);

  const repo: ChatRepository = {
    async listGroupsFor(userId) {
      return people.groups
        .filter((group) => hasAccess(userId, group.id))
        .map((group) => toAccess(group.id)!)
        .filter(Boolean);
    },
    async groupFor(userId, groupId) {
      return hasAccess(userId, groupId) ? toAccess(groupId) : null;
    },
    async friendThreadKeys(userId) {
      return [...new Set(live().map((message) => message.threadKey))].filter((key) => friendFromKey(key, userId) !== null);
    },
    async summaries(userId, keys) {
      const result = new Map();
      for (const key of keys) {
        const thread = live().filter((message) => message.threadKey === key);
        const last = thread.at(-1);
        if (!last) continue;
        const lastRead = reads.get(readKey(userId, key))?.lastReadAt;
        const unread = thread.filter((message) => message.authorId !== userId && (!lastRead || message.createdAt > lastRead)).length;
        result.set(key, { lastBody: last.body, lastAt: last.createdAt, lastAuthorId: last.authorId, unread });
      }
      return result;
    },
    async listMessages(threadKey, { after, before, limit }) {
      const thread = live().filter((message) => message.threadKey === threadKey);
      if (after) return thread.filter((message) => message.createdAt >= after).slice(0, limit).map(strip);
      return thread
        .filter((message) => !before || message.createdAt < before)
        .slice(-limit)
        .map(strip);
    },
    async createMessage({ threadKey, groupId, authorId, body }) {
      const message = { id: nextId(), threadKey, groupId, authorId, body, createdAt: now() };
      messages.push(message);
      return strip(message);
    },
    async markRead(userId, threadKey, groupId, at) {
      reads.set(readKey(userId, threadKey), { lastReadAt: at, groupId });
    },
    async exportAll(userId) {
      return live()
        .filter((message) => message.authorId === userId)
        .map(strip);
    },
  };

  return {
    repo,
    messages,
    clearUser(userId: string) {
      for (let i = messages.length - 1; i >= 0; i -= 1) if (messages[i]!.authorId === userId) messages.splice(i, 1);
      for (const key of [...reads.keys()]) if (key.startsWith(`${userId}|`)) reads.delete(key);
    },
  };
}
