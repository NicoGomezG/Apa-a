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
      const contact = { ...data, id: nextId(), userId, createdAt: created };
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
        participants.push({ ...participant, id: nextId(), groupId: group.id, userId, position }),
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
      const participant = { ...data, id: nextId(), groupId, userId, position };
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
    clearUser(userId: string) {
      const groupIds = new Set(groups.filter((group) => group.userId === userId).map((group) => group.id));
      removeWhere(contacts, (item) => item.userId === userId);
      removeWhere(groups, (item) => item.userId === userId);
      removeWhere(participants, (item) => groupIds.has(item.groupId));
      removeWhere(expenses, (item) => groupIds.has(item.groupId));
      removeWhere(settlements, (item) => groupIds.has(item.groupId));
    },
  };
}
