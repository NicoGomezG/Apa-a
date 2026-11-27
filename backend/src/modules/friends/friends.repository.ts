import type { PrismaClient } from '../../generated/prisma/client.js';

// Amistades entre cuentas de Apaña. Se guarda una fila por par, con user_a_id < user_b_id.

export interface FriendInviteRecord {
  id: string;
  code: string;
  expiresAt: Date;
  createdAt: Date;
}

/**
 * Lo que una persona ve de su amigo: nombre, cumpleaños (día y mes) y teléfono solo si el amigo
 * eligió compartirlo. El apodo es el del contacto propio enlazado: lo pone uno y el amigo no lo ve.
 */
export interface FriendRecord {
  userId: string;
  displayName: string | null;
  birthDay: number | null;
  birthMonth: number | null;
  phone: string | null;
  nickname: string | null;
  since: Date;
  /** Contacto propio enlazado a este amigo. */
  contactId: string | null;
}

export interface InviteLookup {
  id: string;
  userId: string;
  inviterName: string | null;
}

export interface FriendsRepository {
  createInvite(userId: string, code: string, expiresAt: Date): Promise<FriendInviteRecord>;
  /** Invitaciones vigentes (sin vencer) creadas por la persona. */
  listInvites(userId: string, now: Date): Promise<FriendInviteRecord[]>;
  deleteInvite(userId: string, id: string): Promise<boolean>;
  /** Busca una invitación vigente por su código. */
  findInvite(code: string, now: Date): Promise<InviteLookup | null>;
  /** Usa la invitación (una sola vez) y crea la amistad. false si alguien la usó antes. */
  acceptInvite(inviteId: string, inviterId: string, acceptorId: string): Promise<boolean>;

  listFriends(userId: string): Promise<FriendRecord[]>;
  areFriends(userId: string, otherId: string): Promise<boolean>;
  /** Termina la amistad y deshace los enlaces en ambos sentidos (grupos y contactos). */
  removeFriend(userId: string, friendId: string): Promise<boolean>;
  /** Enlaza (o desenlaza con null) un contacto propio con un amigo. false si el contacto no existe. */
  linkContact(userId: string, friendId: string, contactId: string | null): Promise<boolean>;
  /**
   * Pone (o borra con null) el apodo en el contacto enlazado al amigo. Si no hay contacto enlazado y
   * el apodo no es null, crea uno con el nombre del amigo y lo enlaza.
   */
  setNickname(userId: string, friendId: string, nickname: string | null, friendName: string): Promise<void>;
}

export const orderedPair = (a: string, b: string) => (a < b ? { userAId: a, userBId: b } : { userAId: b, userBId: a });

export function createPrismaFriendsRepository(prisma: PrismaClient): FriendsRepository {
  const inviteSelect = { id: true, code: true, expiresAt: true, createdAt: true } as const;

  return {
    async createInvite(userId, code, expiresAt) {
      return prisma.friendInvite.create({ data: { userId, code, expiresAt }, select: inviteSelect });
    },

    async listInvites(userId, now) {
      return prisma.friendInvite.findMany({
        where: { userId, expiresAt: { gt: now } },
        orderBy: { createdAt: 'desc' },
        select: inviteSelect,
      });
    },

    async deleteInvite(userId, id) {
      const { count } = await prisma.friendInvite.deleteMany({ where: { id, userId } });
      return count > 0;
    },

    async findInvite(code, now) {
      const invite = await prisma.friendInvite.findFirst({ where: { code, expiresAt: { gt: now } } });
      if (!invite) return null;
      const profile = await prisma.profile.findUnique({ where: { id: invite.userId }, select: { displayName: true } });
      return { id: invite.id, userId: invite.userId, inviterName: profile?.displayName ?? null };
    },

    async acceptInvite(inviteId, inviterId, acceptorId) {
      return prisma.$transaction(async (tx) => {
        const { count } = await tx.friendInvite.deleteMany({ where: { id: inviteId, userId: inviterId } });
        if (count === 0) return false;
        await tx.friendship.createMany({ data: [orderedPair(inviterId, acceptorId)], skipDuplicates: true });
        return true;
      });
    },

    async listFriends(userId) {
      const rows = await prisma.friendship.findMany({
        where: { OR: [{ userAId: userId }, { userBId: userId }] },
        orderBy: { createdAt: 'asc' },
      });
      const ids = rows.map((row) => (row.userAId === userId ? row.userBId : row.userAId));
      if (ids.length === 0) return [];
      const [profiles, contacts] = await Promise.all([
        prisma.profile.findMany({
          where: { id: { in: ids } },
          select: { id: true, displayName: true, birthDay: true, birthMonth: true, phone: true, sharePhone: true },
        }),
        prisma.contact.findMany({ where: { userId, friendUserId: { in: ids } }, select: { id: true, friendUserId: true, nickname: true } }),
      ]);
      const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
      const contactByFriend = new Map(contacts.map((contact) => [contact.friendUserId, contact]));
      return rows.map((row, index) => {
        const friendId = ids[index]!;
        const profile = profileById.get(friendId);
        return {
          userId: friendId,
          displayName: profile?.displayName ?? null,
          birthDay: profile?.birthDay ?? null,
          birthMonth: profile?.birthMonth ?? null,
          phone: profile?.sharePhone ? profile.phone : null,
          nickname: contactByFriend.get(friendId)?.nickname ?? null,
          since: row.createdAt,
          contactId: contactByFriend.get(friendId)?.id ?? null,
        };
      });
    },

    async areFriends(userId, otherId) {
      if (userId === otherId) return false;
      return (await prisma.friendship.count({ where: orderedPair(userId, otherId) })) > 0;
    },

    async removeFriend(userId, friendId) {
      return prisma.$transaction(async (tx) => {
        const { count } = await tx.friendship.deleteMany({ where: orderedPair(userId, friendId) });
        if (count === 0) return false;
        for (const [owner, friend] of [
          [userId, friendId],
          [friendId, userId],
        ] as const) {
          await tx.splitParticipant.updateMany({
            where: { userId: owner, linkedUserId: friend },
            data: { linkedUserId: null, remindedAt: null },
          });
          await tx.contact.updateMany({ where: { userId: owner, friendUserId: friend }, data: { friendUserId: null } });
        }
        return true;
      });
    },

    async linkContact(userId, friendId, contactId) {
      return prisma.$transaction(async (tx) => {
        await tx.contact.updateMany({ where: { userId, friendUserId: friendId }, data: { friendUserId: null } });
        if (contactId === null) return true;
        const { count } = await tx.contact.updateMany({ where: { id: contactId, userId }, data: { friendUserId: friendId } });
        if (count === 0) throw new ContactNotFound();
        return true;
      }).catch((error: unknown) => {
        if (error instanceof ContactNotFound) return false;
        throw error;
      });
    },

    async setNickname(userId, friendId, nickname, friendName) {
      const { count } = await prisma.contact.updateMany({ where: { userId, friendUserId: friendId }, data: { nickname } });
      if (count > 0 || nickname === null) return;
      await prisma.contact.create({ data: { userId, friendUserId: friendId, name: friendName, nickname } });
    },
  };
}

/** Aborta la transacción de enlace (deshace el desenlace previo) si el contacto no es de la persona. */
class ContactNotFound extends Error {}
