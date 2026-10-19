import type { PrismaClient } from '../../generated/prisma/client.js';

export interface Preferences {
  timezone: string;
  locale: string;
  currency: string;
}

export interface ProfileRecord {
  id: string;
  displayName: string | null;
  createdAt: Date;
  preferences: Preferences;
}

export interface ProfileRepository {
  find(userId: string): Promise<ProfileRecord | null>;
  /** Crea el perfil y sus preferencias por defecto. Idempotente ante carreras. */
  create(userId: string, displayName: string | null): Promise<{ profile: ProfileRecord; created: boolean }>;
  updateDisplayName(userId: string, displayName: string | null): Promise<ProfileRecord>;
  updatePreferences(userId: string, changes: Partial<Preferences>): Promise<ProfileRecord>;
}

const profileSelect = {
  id: true,
  displayName: true,
  createdAt: true,
  preferences: { select: { timezone: true, locale: true, currency: true } },
} as const;

type SelectedProfile = {
  id: string;
  displayName: string | null;
  createdAt: Date;
  preferences: Preferences | null;
};

const DEFAULT_PREFERENCES: Preferences = { timezone: 'America/Santiago', locale: 'es-CL', currency: 'CLP' };

function toRecord(row: SelectedProfile): ProfileRecord {
  return { ...row, preferences: row.preferences ?? DEFAULT_PREFERENCES };
}

export function createPrismaProfileRepository(prisma: PrismaClient): ProfileRepository {
  return {
    async find(userId) {
      const row = await prisma.profile.findUnique({ where: { id: userId }, select: profileSelect });
      return row ? toRecord(row) : null;
    },

    async create(userId, displayName) {
      // createMany + skipDuplicates evita el error de PK si dos requests del mismo
      // usuario llegan a la vez la primera vez que entra.
      const result = await prisma.$transaction(async (tx) => {
        const inserted = await tx.profile.createMany({
          data: [{ id: userId, displayName }],
          skipDuplicates: true,
        });
        await tx.userPreferences.createMany({ data: [{ userId }], skipDuplicates: true });
        return inserted.count > 0;
      });
      const row = await prisma.profile.findUniqueOrThrow({ where: { id: userId }, select: profileSelect });
      return { profile: toRecord(row), created: result };
    },

    async updateDisplayName(userId, displayName) {
      const row = await prisma.profile.update({
        where: { id: userId },
        data: { displayName },
        select: profileSelect,
      });
      return toRecord(row);
    },

    async updatePreferences(userId, changes) {
      await prisma.userPreferences.upsert({
        where: { userId },
        create: { userId, ...changes },
        update: changes,
      });
      const row = await prisma.profile.findUniqueOrThrow({ where: { id: userId }, select: profileSelect });
      return toRecord(row);
    },
  };
}
