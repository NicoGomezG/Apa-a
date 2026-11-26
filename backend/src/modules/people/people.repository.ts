import type { PrismaClient } from '../../generated/prisma/client.js';
import type { SplitMode } from './split.math.js';
import type {
  ContactInput,
  ContactRecord,
  ExpenseInput,
  ExpenseRecord,
  GroupDetail,
  GroupInput,
  GroupRecord,
  ParticipantInput,
  ParticipantRecord,
  Relationship,
  SettlementInput,
  SettlementRecord,
} from './people.types.js';

/**
 * Acceso a datos de Personas. Toda operación recibe el `userId` dueño y filtra por él;
 * la única excepción es `getGroupByToken`, que sirve el enlace de solo lectura.
 */
export interface PeopleRepository {
  listContacts(userId: string): Promise<ContactRecord[]>;
  findContact(userId: string, id: string): Promise<ContactRecord | null>;
  createContact(userId: string, data: ContactInput): Promise<ContactRecord>;
  updateContact(userId: string, id: string, changes: Partial<ContactInput>): Promise<ContactRecord | null>;
  deleteContact(userId: string, id: string): Promise<boolean>;

  listGroups(userId: string): Promise<GroupDetail[]>;
  getGroup(userId: string, id: string): Promise<GroupDetail | null>;
  getGroupByToken(token: string): Promise<GroupDetail | null>;
  createGroup(userId: string, data: GroupInput, participants: ParticipantInput[]): Promise<GroupDetail>;
  updateGroup(
    userId: string,
    id: string,
    changes: Partial<GroupInput> & { shareToken?: string | null },
  ): Promise<GroupRecord | null>;
  deleteGroup(userId: string, id: string): Promise<boolean>;

  addParticipant(userId: string, groupId: string, data: ParticipantInput): Promise<ParticipantRecord>;
  updateParticipant(
    userId: string,
    groupId: string,
    id: string,
    changes: Partial<Pick<ParticipantInput, 'name' | 'contactId'>>,
  ): Promise<ParticipantRecord | null>;
  deleteParticipant(userId: string, groupId: string, id: string): Promise<boolean>;

  createExpense(userId: string, groupId: string, data: ExpenseInput): Promise<ExpenseRecord>;
  replaceExpense(userId: string, groupId: string, id: string, data: ExpenseInput): Promise<ExpenseRecord | null>;
  deleteExpense(userId: string, groupId: string, id: string): Promise<boolean>;

  createSettlement(userId: string, groupId: string, data: SettlementInput): Promise<SettlementRecord>;
  deleteSettlement(userId: string, groupId: string, id: string): Promise<boolean>;

  exportAll(userId: string): Promise<{ contacts: ContactRecord[]; groups: GroupDetail[] }>;
}

const toDate = (day: string) => new Date(`${day}T00:00:00.000Z`);
const toDay = (date: Date) => date.toISOString().slice(0, 10);

type ContactRow = Omit<ContactRecord, 'relationship'> & { relationship: string | null };
const contactFromRow = (row: ContactRow): ContactRecord => ({
  id: row.id,
  name: row.name,
  nickname: row.nickname,
  birthDay: row.birthDay,
  birthMonth: row.birthMonth,
  birthYear: row.birthYear,
  phone: row.phone,
  email: row.email,
  relationship: row.relationship as Relationship | null,
  notes: row.notes,
  createdAt: row.createdAt,
});

const groupFromRow = (row: {
  id: string;
  name: string;
  date: Date | null;
  currency: string;
  shareToken: string | null;
  createdAt: Date;
}): GroupRecord => ({
  id: row.id,
  name: row.name,
  date: row.date ? toDay(row.date) : null,
  currency: row.currency,
  shareToken: row.shareToken,
  createdAt: row.createdAt,
});

const participantFromRow = (row: ParticipantRecord & Record<string, unknown>): ParticipantRecord => ({
  id: row.id,
  groupId: row.groupId,
  name: row.name,
  contactId: row.contactId,
  isMe: row.isMe,
  position: row.position,
});

type ExpenseRow = {
  id: string;
  groupId: string;
  description: string;
  date: Date;
  payerId: string;
  mode: string;
  subtotal: bigint;
  tipPercent: number;
  tip: bigint;
  total: bigint;
  createdAt: Date;
  items: { description: string; quantity: number; unitPrice: bigint; amount: bigint; participantIds: string[]; position: number }[];
  shares: { participantId: string; consumption: bigint; tip: bigint }[];
};

const expenseFromRow = (row: ExpenseRow): ExpenseRecord => ({
  id: row.id,
  groupId: row.groupId,
  description: row.description,
  date: toDay(row.date),
  payerId: row.payerId,
  mode: row.mode as SplitMode,
  subtotal: row.subtotal,
  tipPercent: row.tipPercent,
  tip: row.tip,
  total: row.total,
  items: [...row.items]
    .sort((a, b) => a.position - b.position)
    .map((item) => ({
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      amount: item.amount,
      participantIds: item.participantIds,
    })),
  shares: row.shares.map((share) => ({ participantId: share.participantId, consumption: share.consumption, tip: share.tip })),
  createdAt: row.createdAt,
});

const settlementFromRow = (row: {
  id: string;
  groupId: string;
  fromId: string;
  toId: string;
  amount: bigint;
  date: Date;
  createdAt: Date;
}): SettlementRecord => ({
  id: row.id,
  groupId: row.groupId,
  fromId: row.fromId,
  toId: row.toId,
  amount: row.amount,
  date: toDay(row.date),
  createdAt: row.createdAt,
});

const groupInclude = {
  participants: { orderBy: { position: 'asc' as const } },
  expenses: {
    orderBy: [{ date: 'desc' as const }, { createdAt: 'desc' as const }],
    include: { items: true, shares: true },
  },
  settlements: { orderBy: [{ date: 'desc' as const }, { createdAt: 'desc' as const }] },
};

type GroupWithRelations = Parameters<typeof groupFromRow>[0] & {
  participants: Parameters<typeof participantFromRow>[0][];
  expenses: ExpenseRow[];
  settlements: Parameters<typeof settlementFromRow>[0][];
};

const detailFromRow = (row: GroupWithRelations): GroupDetail => ({
  group: groupFromRow(row),
  participants: row.participants.map(participantFromRow),
  expenses: row.expenses.map(expenseFromRow),
  settlements: row.settlements.map(settlementFromRow),
});

const expenseData = (userId: string, data: ExpenseInput) => ({
  description: data.description,
  date: toDate(data.date),
  payerId: data.payerId,
  mode: data.mode,
  subtotal: data.subtotal,
  tipPercent: data.tipPercent,
  tip: data.tip,
  total: data.total,
  items: {
    create: data.items.map((item, position) => ({ ...item, userId, position })),
  },
  shares: {
    create: data.shares.map((share) => ({ ...share, userId })),
  },
});

export function createPrismaPeopleRepository(prisma: PrismaClient): PeopleRepository {
  const ownsGroup = async (userId: string, groupId: string) =>
    (await prisma.splitGroup.count({ where: { id: groupId, userId } })) > 0;

  return {
    // --- Contactos -------------------------------------------------------------
    async listContacts(userId) {
      const rows = await prisma.contact.findMany({ where: { userId }, orderBy: { name: 'asc' } });
      return rows.map(contactFromRow);
    },

    async findContact(userId, id) {
      const row = await prisma.contact.findFirst({ where: { id, userId } });
      return row ? contactFromRow(row) : null;
    },

    async createContact(userId, data) {
      return contactFromRow(await prisma.contact.create({ data: { ...data, userId } }));
    },

    async updateContact(userId, id, changes) {
      const { count } = await prisma.contact.updateMany({ where: { id, userId }, data: changes });
      if (count === 0) return null;
      return contactFromRow(await prisma.contact.findFirstOrThrow({ where: { id, userId } }));
    },

    async deleteContact(userId, id) {
      const { count } = await prisma.contact.deleteMany({ where: { id, userId } });
      return count > 0;
    },

    // --- Grupos ----------------------------------------------------------------
    async listGroups(userId) {
      const rows = await prisma.splitGroup.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        include: groupInclude,
      });
      return rows.map(detailFromRow);
    },

    async getGroup(userId, id) {
      const row = await prisma.splitGroup.findFirst({ where: { id, userId }, include: groupInclude });
      return row ? detailFromRow(row) : null;
    },

    async getGroupByToken(token) {
      const row = await prisma.splitGroup.findUnique({ where: { shareToken: token }, include: groupInclude });
      return row ? detailFromRow(row) : null;
    },

    async createGroup(userId, data, participants) {
      const row = await prisma.splitGroup.create({
        data: {
          userId,
          name: data.name,
          date: data.date ? toDate(data.date) : null,
          currency: data.currency,
          participants: { create: participants.map((participant, position) => ({ ...participant, userId, position })) },
        },
        include: groupInclude,
      });
      return detailFromRow(row);
    },

    async updateGroup(userId, id, changes) {
      const data = {
        ...changes,
        ...(changes.date !== undefined ? { date: changes.date ? toDate(changes.date) : null } : {}),
      };
      const { count } = await prisma.splitGroup.updateMany({ where: { id, userId }, data });
      if (count === 0) return null;
      return groupFromRow(await prisma.splitGroup.findFirstOrThrow({ where: { id, userId } }));
    },

    async deleteGroup(userId, id) {
      const { count } = await prisma.splitGroup.deleteMany({ where: { id, userId } });
      return count > 0;
    },

    // --- Participantes ---------------------------------------------------------
    async addParticipant(userId, groupId, data) {
      if (!(await ownsGroup(userId, groupId))) throw new Error('Grupo ajeno');
      const last = await prisma.splitParticipant.aggregate({ where: { groupId, userId }, _max: { position: true } });
      const row = await prisma.splitParticipant.create({
        data: { ...data, groupId, userId, position: (last._max.position ?? -1) + 1 },
      });
      return participantFromRow(row);
    },

    async updateParticipant(userId, groupId, id, changes) {
      const { count } = await prisma.splitParticipant.updateMany({ where: { id, groupId, userId }, data: changes });
      if (count === 0) return null;
      return participantFromRow(await prisma.splitParticipant.findFirstOrThrow({ where: { id, groupId, userId } }));
    },

    async deleteParticipant(userId, groupId, id) {
      const { count } = await prisma.splitParticipant.deleteMany({ where: { id, groupId, userId } });
      return count > 0;
    },

    // --- Gastos ----------------------------------------------------------------
    async createExpense(userId, groupId, data) {
      if (!(await ownsGroup(userId, groupId))) throw new Error('Grupo ajeno');
      const row = await prisma.splitExpense.create({
        data: { ...expenseData(userId, data), groupId, userId },
        include: { items: true, shares: true },
      });
      return expenseFromRow(row);
    },

    async replaceExpense(userId, groupId, id, data) {
      return prisma.$transaction(async (tx) => {
        const existing = await tx.splitExpense.findFirst({ where: { id, groupId, userId } });
        if (!existing) return null;
        await tx.splitExpenseItem.deleteMany({ where: { expenseId: id, userId } });
        await tx.splitShare.deleteMany({ where: { expenseId: id, userId } });
        const row = await tx.splitExpense.update({
          where: { id },
          data: expenseData(userId, data),
          include: { items: true, shares: true },
        });
        return expenseFromRow(row);
      });
    },

    async deleteExpense(userId, groupId, id) {
      const { count } = await prisma.splitExpense.deleteMany({ where: { id, groupId, userId } });
      return count > 0;
    },

    // --- Pagos entre personas --------------------------------------------------
    async createSettlement(userId, groupId, data) {
      if (!(await ownsGroup(userId, groupId))) throw new Error('Grupo ajeno');
      const row = await prisma.splitSettlement.create({
        data: { ...data, date: toDate(data.date), groupId, userId },
      });
      return settlementFromRow(row);
    },

    async deleteSettlement(userId, groupId, id) {
      const { count } = await prisma.splitSettlement.deleteMany({ where: { id, groupId, userId } });
      return count > 0;
    },

    async exportAll(userId) {
      const [contacts, groups] = await Promise.all([this.listContacts(userId), this.listGroups(userId)]);
      // El código del enlace no se exporta: es una credencial de acceso, no un dato.
      return { contacts, groups: groups.map((detail) => ({ ...detail, group: { ...detail.group, shareToken: null } })) };
    },
  };
}
