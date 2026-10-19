import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AuthAdmin } from '../../lib/auth/auth-admin.js';
import { AppError } from '../../lib/errors.js';
import { currentUser } from '../../plugins/auth.js';
import type { AuditRepository } from '../audit/audit.repository.js';
import { ensureProfile } from '../profile/profile.routes.js';
import type { ProfileRepository } from '../profile/profile.repository.js';
import type { AccountRepository } from './account.repository.js';

export const DELETE_CONFIRMATION = 'ELIMINAR MI CUENTA';

const deleteBody = z.object({ confirmation: z.literal(DELETE_CONFIRMATION) });

export interface AccountRoutesDeps {
  profiles: ProfileRepository;
  audit: AuditRepository;
  account: AccountRepository;
  authAdmin: AuthAdmin;
}

export const accountRoutes: FastifyPluginAsyncZod<AccountRoutesDeps> = async (app, deps) => {
  app.addHook('onRequest', app.authenticate);

  // Exportación de datos (derecho de acceso y portabilidad). Cada módulo nuevo
  // agrega aquí su sección.
  app.get(
    '/me/export',
    { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } },
    async (request, reply) => {
      const user = currentUser(request);
      const profile = await ensureProfile(deps, user);
      const activity = await deps.audit.listForUser(user.id, 1000);
      await deps.audit.record({ userId: user.id, action: 'account.exported', entityType: 'profile', entityId: user.id });

      reply.header('Content-Disposition', 'attachment; filename="apana-mis-datos.json"');
      reply.header('Cache-Control', 'no-store');
      return {
        exportedAt: new Date().toISOString(),
        account: { email: user.email },
        profile,
        activity,
      };
    },
  );

  app.delete(
    '/me',
    {
      schema: { body: deleteBody },
      config: { rateLimit: { max: 5, timeWindow: '1 hour' } },
    },
    async (request, reply) => {
      const user = currentUser(request);

      // Primero los datos y después la identidad: si fallara lo segundo, no
      // quedan datos huérfanos y el usuario puede reintentar (todo es idempotente).
      await deps.account.deleteAllData(user.id);
      await deps.audit.record({ userId: user.id, action: 'account.deleted', entityType: 'profile', entityId: user.id });

      try {
        await deps.authAdmin.deleteUser(user.id);
      } catch (err) {
        request.log.error({ err }, 'auth user deletion failed');
        throw new AppError(
          502,
          'AUTH_DELETE_FAILED',
          'Borramos tus datos, pero no pudimos cerrar tu acceso. Intenta de nuevo en unos minutos.',
        );
      }

      return reply.status(204).send();
    },
  );
};
