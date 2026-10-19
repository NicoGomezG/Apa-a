import type { PrismaClient } from '../../generated/prisma/client.js';

export type AuditAction =
  | 'profile.created'
  | 'profile.updated'
  | 'preferences.updated'
  | 'account.exported'
  | 'account.deleted';

export interface AuditEntry {
  userId: string | null;
  action: AuditAction;
  entityType?: string;
  entityId?: string;
  // Solo identificadores o nombres de campos. Nunca valores personales, financieros ni médicos.
  metadata?: Record<string, string | number | boolean | string[]>;
}

export interface AuditRecord {
  action: string;
  entityType: string | null;
  createdAt: Date;
}

export interface AuditRepository {
  record(entry: AuditEntry): Promise<void>;
  listForUser(userId: string, limit: number): Promise<AuditRecord[]>;
}

export function createPrismaAuditRepository(prisma: PrismaClient): AuditRepository {
  return {
    async record(entry) {
      await prisma.auditLog.create({
        data: {
          userId: entry.userId,
          action: entry.action,
          entityType: entry.entityType ?? null,
          entityId: entry.entityId ?? null,
          metadata: entry.metadata ?? undefined,
        },
      });
    },

    listForUser(userId, limit) {
      return prisma.auditLog.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: { action: true, entityType: true, createdAt: true },
      });
    },
  };
}
