import type { PrismaClient } from '../../generated/prisma/client.js';

export type AuditAction =
  | 'profile.created'
  | 'profile.updated'
  | 'preferences.updated'
  | 'account.exported'
  | 'account.deleted'
  | 'finance.account.created'
  | 'finance.account.updated'
  | 'finance.account.deleted'
  | 'finance.transaction.created'
  | 'finance.transaction.updated'
  | 'finance.transaction.deleted'
  | 'finance.installment.updated'
  | 'finance.installment.deleted'
  | 'finance.subscription.created'
  | 'finance.subscription.updated'
  | 'finance.subscription.deleted'
  | 'finance.import.completed'
  | 'people.contact.created'
  | 'people.contact.updated'
  | 'people.contact.deleted'
  | 'people.group.created'
  | 'people.group.updated'
  | 'people.group.deleted'
  | 'people.share.enabled'
  | 'people.share.disabled'
  | 'people.participant.added'
  | 'people.participant.updated'
  | 'people.participant.deleted'
  | 'people.expense.created'
  | 'people.expense.updated'
  | 'people.expense.deleted'
  | 'people.settlement.created'
  | 'people.settlement.deleted'
  | 'people.settlement.confirmed'
  | 'people.settlement.reported'
  | 'people.settlement.withdrawn'
  | 'people.reminder.sent'
  | 'friends.invite.created'
  | 'friends.invite.revoked'
  | 'friends.accepted'
  | 'chat.message.sent'
  | 'finance.debt.created'
  | 'finance.debt.updated'
  | 'finance.debt.deleted'
  | 'finance.debt.payment.created'
  | 'finance.debt.payment.deleted'
  | 'friends.removed'
  | 'friends.contact.linked';

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
