import { orderedPair, type FriendInviteRecord, type FriendsRepository } from '../modules/friends/friends.repository.js';
import type { PeopleRepository } from '../modules/people/people.repository.js';
import type {
  ContactRecord,
  ExpenseRecord,
  GroupDetail,
  GroupRecord,
  ParticipantRecord,
  SettlementRecord,
} from '../modules/people/people.types.js';

type Owned<T> = T & { userId: string };

/** Repositorio de Personas en memoria, con las mismas reglas de pertenencia que el real. */
export function createFakePeople() {
  let sequence = 0;
  const nextId = () => `00000000-0000-7000-9000-${String((sequence += 1)).padStart(12, '0')}`;
  const created = new Date('2026-11-25T12:00:00Z');

  const contacts: Owned<ContactRecord>[] = [];
  const groups: Owned<GroupRecord>[] = [];
  const participants: Owned<ParticipantRecord>[] = [];
  const expenses: Owned<ExpenseRecord>[] = [];
  const settlements: Owned<SettlementRecord>[] = [];

  const strip = <T extends { userId: string }>({ userId: _userId, ...rest }: T) => rest as Omit<T, 'userId'>;
  const owned = <T extends { userId: string }>(list: T[], userId: string) => list.filter((item) => item.userId === userId);
  const removeWhere = <T>(list: T[], predicate: (item: T) => boolean) => {
    let removed = 0;
    for (let index = list.length - 1; index >= 0; index -= 1) {
      if (predicate(list[index]!)) {
        list.splice(index, 1);
        removed += 1;
      }
    }
    return removed;
  };

  const detail = (group: Owned<GroupRecord>): GroupDetail => ({
    group: strip(group),
    participants: participants
      .filter((item) => item.groupId === group.id)
      .sort((a, b) => a.position - b.position)
      .map(strip),
    expenses: expenses
      .filter((item) => item.groupId === group.id)
      .sort((a, b) => b.date.localeCompare(a.date))
      .map(strip),
    settlements: settlements.filter((item) => item.groupId === group.id).map(strip),
  });

  const ownsGroup = (userId: string, groupId: string) => groups.some((group) => group.id === groupId && group.userId === userId);
  const isLinked = (groupId: string, friendUserId: string) =>
    participants.some((item) => item.groupId === groupId && item.linkedUserId === friendUserId);

  const repo: PeopleRepository = {
    async listContacts(userId) {
      return owned(contacts, userId)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(strip);
    },
    async findContact(userId, id) {
      const contact = contacts.find((item) => item.id === id && item.userId === userId);
      return contact ? strip(contact) : null;
    },
    async createContact(userId, data) {
      const contact = { ...data, friendUserId: null, id: nextId(), userId, createdAt: created };
      contacts.push(contact);
      return strip(contact);
    },
    async updateContact(userId, id, changes) {
      const contact = contacts.find((item) => item.id === id && item.userId === userId);
      if (!contact) return null;
      Object.assign(contact, changes);
      return strip(contact);
    },
    async deleteContact(userId, id) {
      const removed = removeWhere(contacts, (item) => item.id === id && item.userId === userId) > 0;
      if (removed) for (const participant of participants) if (participant.contactId === id) participant.contactId = null;
      return removed;
    },

    async listGroups(userId) {
      return owned(groups, userId).map(detail);
    },
    async getGroup(userId, id) {
      const group = groups.find((item) => item.id === id && item.userId === userId);
      return group ? detail(group) : null;
    },
    async getGroupByToken(token) {
      const group = groups.find((item) => item.shareToken === token);
      return group ? detail(group) : null;
    },
    async createGroup(userId, data, list) {
      const group = { ...data, id: nextId(), userId, shareToken: null, createdAt: created };
      groups.push(group);
      list.forEach((participant, position) =>
        participants.push({ ...participant, remindedAt: null, id: nextId(), groupId: group.id, userId, position }),
      );
      return detail(group);
    },
    async updateGroup(userId, id, changes) {
      const group = groups.find((item) => item.id === id && item.userId === userId);
      if (!group) return null;
      Object.assign(group, changes);
      return strip(group);
    },
    async deleteGroup(userId, id) {
      if (removeWhere(groups, (item) => item.id === id && item.userId === userId) === 0) return false;
      removeWhere(participants, (item) => item.groupId === id);
      removeWhere(expenses, (item) => item.groupId === id);
      removeWhere(settlements, (item) => item.groupId === id);
      return true;
    },

    async addParticipant(userId, groupId, data) {
      if (!ownsGroup(userId, groupId)) throw new Error('Grupo ajeno');
      const position = Math.max(-1, ...participants.filter((item) => item.groupId === groupId).map((item) => item.position)) + 1;
      const participant = { ...data, remindedAt: null, id: nextId(), groupId, userId, position };
      participants.push(participant);
      return strip(participant);
    },
    async updateParticipant(userId, groupId, id, changes) {
      const participant = participants.find((item) => item.id === id && item.groupId === groupId && item.userId === userId);
      if (!participant) return null;
      Object.assign(participant, changes);
      return strip(participant);
    },
    async deleteParticipant(userId, groupId, id) {
      return removeWhere(participants, (item) => item.id === id && item.groupId === groupId && item.userId === userId) > 0;
    },

    async createExpense(userId, groupId, data) {
      if (!ownsGroup(userId, groupId)) throw new Error('Grupo ajeno');
      const expense = { ...data, id: nextId(), groupId, userId, createdAt: created };
      expenses.push(expense);
      return strip(expense);
    },
    async replaceExpense(userId, groupId, id, data) {
      const expense = expenses.find((item) => item.id === id && item.groupId === groupId && item.userId === userId);
      if (!expense) return null;
      Object.assign(expense, data);
      return strip(expense);
    },
    async deleteExpense(userId, groupId, id) {
      return removeWhere(expenses, (item) => item.id === id && item.groupId === groupId && item.userId === userId) > 0;
    },

    async createSettlement(userId, groupId, data) {
      if (!ownsGroup(userId, groupId)) throw new Error('Grupo ajeno');
      const settlement = { ...data, id: nextId(), groupId, userId, createdAt: created };
      settlements.push(settlement);
      return strip(settlement);
    },
    async deleteSettlement(userId, groupId, id) {
      return removeWhere(settlements, (item) => item.id === id && item.groupId === groupId && item.userId === userId) > 0;
    },
    async confirmSettlement(userId, groupId, id) {
      const settlement = settlements.find(
        (item) => item.id === id && item.groupId === groupId && item.userId === userId && !item.confirmed,
      );
      if (!settlement) return null;
      settlement.confirmed = true;
      return strip(settlement);
    },

    async listSharedGroups(friendUserId) {
      return groups
        .filter((group) => group.userId !== friendUserId && isLinked(group.id, friendUserId))
        .map((group) => ({ ownerId: group.userId, detail: detail(group) }));
    },
    async getSharedGroup(friendUserId, groupId) {
      const group = groups.find((item) => item.id === groupId && item.userId !== friendUserId && isLinked(item.id, friendUserId));
      return group ? { ownerId: group.userId, detail: detail(group) } : null;
    },
    async deleteReportedSettlement(friendUserId, groupId, id) {
      return (
        removeWhere(
          settlements,
          (item) => item.id === id && item.groupId === groupId && item.reportedBy === friendUserId && !item.confirmed,
        ) > 0
      );
    },

    async exportAll(userId) {
      return {
        contacts: await repo.listContacts(userId),
        groups: (await repo.listGroups(userId)).map((item) => ({ ...item, group: { ...item.group, shareToken: null } })),
      };
    },
  };

  return {
    repo,
    contacts,
    groups,
    participants,
    settlements,
    clearUser(userId: string) {
      for (const contact of contacts) if (contact.friendUserId === userId) contact.friendUserId = null;
      for (const participant of participants) {
        if (participant.linkedUserId === userId) Object.assign(participant, { linkedUserId: null, remindedAt: null });
      }
      removeWhere(settlements, (item) => item.reportedBy === userId && !item.confirmed);
      for (const settlement of settlements) if (settlement.reportedBy === userId) settlement.reportedBy = null;
      const groupIds = new Set(groups.filter((group) => group.userId === userId).map((group) => group.id));
      removeWhere(contacts, (item) => item.userId === userId);
      removeWhere(groups, (item) => item.userId === userId);
      removeWhere(participants, (item) => groupIds.has(item.groupId));
      removeWhere(expenses, (item) => groupIds.has(item.groupId));
      removeWhere(settlements, (item) => groupIds.has(item.groupId));
    },
  };
}

/** Amistades en memoria. Usa los contactos y participantes del fake de Personas. */
export function createFakeFriends(
  people: ReturnType<typeof createFakePeople>,
  profiles: Map<
    string,
    { displayName: string | null; birthDay: number | null; birthMonth: number | null; phone: string | null; sharePhone: boolean }
  >,
) {
  let sequence = 0;
  const nextId = () => `00000000-0000-7000-a000-${String((sequence += 1)).padStart(12, '0')}`;
  const invites: (FriendInviteRecord & { userId: string })[] = [];
  const friendships: { userAId: string; userBId: string; createdAt: Date }[] = [];
  const created = new Date('2026-11-25T12:00:00Z');

  const findPair = (a: string, b: string) => {
    const pair = orderedPair(a, b);
    return friendships.findIndex((item) => item.userAId === pair.userAId && item.userBId === pair.userBId);
  };
  const linked = (userId: string, friendId: string) =>
    people.contacts.find((contact) => contact.userId === userId && contact.friendUserId === friendId);
  const strip = ({ userId: _userId, ...rest }: FriendInviteRecord & { userId: string }): FriendInviteRecord => rest;

  const repo: FriendsRepository = {
    async createInvite(userId, code, expiresAt) {
      const invite = { id: nextId(), userId, code, expiresAt, createdAt: created };
      invites.push(invite);
      return strip(invite);
    },
    async listInvites(userId, now) {
      return invites.filter((item) => item.userId === userId && item.expiresAt > now).map(strip);
    },
    async deleteInvite(userId, id) {
      const index = invites.findIndex((item) => item.id === id && item.userId === userId);
      if (index < 0) return false;
      invites.splice(index, 1);
      return true;
    },
    async findInvite(code, now) {
      const invite = invites.find((item) => item.code === code && item.expiresAt > now);
      if (!invite) return null;
      return { id: invite.id, userId: invite.userId, inviterName: profiles.get(invite.userId)?.displayName ?? null };
    },
    async acceptInvite(inviteId, inviterId, acceptorId) {
      const index = invites.findIndex((item) => item.id === inviteId && item.userId === inviterId);
      if (index < 0) return false;
      invites.splice(index, 1);
      if (findPair(inviterId, acceptorId) < 0) friendships.push({ ...orderedPair(inviterId, acceptorId), createdAt: created });
      return true;
    },
    async listFriends(userId) {
      return friendships
        .filter((item) => item.userAId === userId || item.userBId === userId)
        .map((item) => {
          const friendId = item.userAId === userId ? item.userBId : item.userAId;
          const profile = profiles.get(friendId);
          return {
            userId: friendId,
            displayName: profile?.displayName ?? null,
            birthDay: profile?.birthDay ?? null,
            birthMonth: profile?.birthMonth ?? null,
            phone: profile?.sharePhone ? profile.phone : null,
            nickname: linked(userId, friendId)?.nickname ?? null,
            since: item.createdAt,
            contactId: linked(userId, friendId)?.id ?? null,
          };
        });
    },
    async areFriends(userId, otherId) {
      return userId !== otherId && findPair(userId, otherId) >= 0;
    },
    async removeFriend(userId, friendId) {
      const index = findPair(userId, friendId);
      if (index < 0) return false;
      friendships.splice(index, 1);
      for (const [owner, friend] of [
        [userId, friendId],
        [friendId, userId],
      ]) {
        for (const participant of people.participants) {
          if (participant.userId === owner && participant.linkedUserId === friend) {
            Object.assign(participant, { linkedUserId: null, remindedAt: null });
          }
        }
        for (const contact of people.contacts) {
          if (contact.userId === owner && contact.friendUserId === friend) contact.friendUserId = null;
        }
      }
      return true;
    },
    async linkContact(userId, friendId, contactId) {
      const target = contactId ? people.contacts.find((item) => item.id === contactId && item.userId === userId) : null;
      if (contactId && !target) return false;
      for (const contact of people.contacts) {
        if (contact.userId === userId && contact.friendUserId === friendId) contact.friendUserId = null;
      }
      if (target) target.friendUserId = friendId;
      return true;
    },
    async setNickname(userId, friendId, nickname, friendName) {
      const contact = linked(userId, friendId);
      if (contact) contact.nickname = nickname;
      else if (nickname !== null) {
        const created = await people.repo.createContact(userId, {
          name: friendName, nickname, birthDay: null, birthMonth: null, birthYear: null,
          phone: null, email: null, relationship: null, notes: null,
        });
        people.contacts.find((item) => item.id === created.id)!.friendUserId = friendId;
      }
    },
  };

  return {
    repo,
    invites,
    friendships,
    clearUser(userId: string) {
      for (let i = invites.length - 1; i >= 0; i -= 1) if (invites[i]!.userId === userId) invites.splice(i, 1);
      for (let i = friendships.length - 1; i >= 0; i -= 1) {
        if (friendships[i]!.userAId === userId || friendships[i]!.userBId === userId) friendships.splice(i, 1);
      }
    },
  };
}
