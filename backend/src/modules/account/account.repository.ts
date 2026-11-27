import type { PrismaClient } from '../../generated/prisma/client.js';

export interface AccountRepository {
  /**
   * Borra TODOS los datos de la persona en el schema `app`.
   * Cada módulo nuevo que guarde datos por usuario debe agregarse acá.
   * La bitácora (`audit_logs`) se conserva: solo tiene identificadores.
   */
  deleteAllData(userId: string): Promise<void>;
}

export function createPrismaAccountRepository(prisma: PrismaClient): AccountRepository {
  return {
    async deleteAllData(userId) {
      await prisma.$transaction([
        // Finanzas: movimientos, cuotas y estados de cuenta caen con su cuenta
        // (ON DELETE CASCADE), pero se borran explícitamente por userId igual.
        prisma.subscription.deleteMany({ where: { userId } }),
        prisma.transaction.deleteMany({ where: { userId } }),
        prisma.installmentPlan.deleteMany({ where: { userId } }),
        prisma.cardStatement.deleteMany({ where: { userId } }),
        prisma.financialAccount.deleteMany({ where: { userId } }),
        // Deudas: los abonos caen con su deuda, pero se borran por userId igual.
        prisma.debtPayment.deleteMany({ where: { userId } }),
        prisma.debt.deleteMany({ where: { userId } }),
        // Amigos: invitaciones, amistades y todo enlace que otras personas tengan hacia esta cuenta.
        prisma.friendInvite.deleteMany({ where: { userId } }),
        prisma.friendship.deleteMany({ where: { OR: [{ userAId: userId }, { userBId: userId }] } }),
        prisma.contact.updateMany({ where: { friendUserId: userId }, data: { friendUserId: null } }),
        prisma.splitParticipant.updateMany({ where: { linkedUserId: userId }, data: { linkedUserId: null, remindedAt: null } }),
        prisma.splitSettlement.deleteMany({ where: { reportedBy: userId, confirmed: false } }),
        prisma.splitSettlement.updateMany({ where: { reportedBy: userId }, data: { reportedBy: null } }),
        // Chat: los mensajes propios (en amigos y grupos ajenos) y lo leído. Los del resto en los
        // grupos propios caen con el grupo (ON DELETE CASCADE).
        prisma.chatMessage.deleteMany({ where: { authorId: userId } }),
        prisma.chatRead.deleteMany({ where: { userId } }),
        // Personas: participantes, gastos, ítems, repartos y pagos caen con su grupo.
        prisma.splitGroup.deleteMany({ where: { userId } }),
        prisma.contact.deleteMany({ where: { userId } }),
        // user_preferences cae por ON DELETE CASCADE.
        prisma.profile.deleteMany({ where: { id: userId } }),
      ]);
    },
  };
}
