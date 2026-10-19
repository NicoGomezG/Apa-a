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
        // user_preferences cae por ON DELETE CASCADE.
        prisma.profile.deleteMany({ where: { id: userId } }),
      ]);
    },
  };
}
