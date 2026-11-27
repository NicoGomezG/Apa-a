import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AuthUser } from '../../lib/auth/token-verifier.js';
import { birthdayFields, checkBirthday } from '../../lib/birthday.js';
import { optionalPhone } from '../../lib/schemas.js';
import { currentUser } from '../../plugins/auth.js';
import type { AuditRepository } from '../audit/audit.repository.js';
import type { ProfileRecord, ProfileRepository } from './profile.repository.js';

export const SUPPORTED_LOCALES = ['es-CL'] as const;
export const SUPPORTED_CURRENCIES = ['CLP', 'USD', 'EUR'] as const;
const TIMEZONES = new Set(Intl.supportedValuesOf('timeZone'));

const preferencesSchema = z.object({
  timezone: z.string(),
  locale: z.string(),
  currency: z.string(),
});

const meSchema = z.object({
  id: z.uuid(),
  email: z.string().nullable(),
  displayName: z.string().nullable(),
  birthDay: z.number().nullable(),
  birthMonth: z.number().nullable(),
  birthYear: z.number().nullable(),
  phone: z.string().nullable(),
  sharePhone: z.boolean(),
  createdAt: z.date(),
  preferences: preferencesSchema,
});

const displayNameSchema = z
  .string()
  .trim()
  .max(80)
  .transform((value) => (value === '' ? null : value))
  .nullable();

const updateProfileBody = z
  .object({ displayName: displayNameSchema.optional(), ...birthdayFields, phone: optionalPhone, sharePhone: z.boolean().optional() })
  .refine((body) => Object.keys(body).length > 0, 'Sin cambios');

const updatePreferencesBody = z
  .object({
    timezone: z
      .string()
      .refine((value) => TIMEZONES.has(value), 'Zona horaria no reconocida')
      .optional(),
    locale: z.enum(SUPPORTED_LOCALES).optional(),
    currency: z.enum(SUPPORTED_CURRENCIES).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'Sin cambios');

export interface ProfileRoutesDeps {
  profiles: ProfileRepository;
  audit: AuditRepository;
  now?: () => Date;
}

/** Devuelve el perfil del usuario, creándolo la primera vez que entra. */
export async function ensureProfile(deps: ProfileRoutesDeps, user: AuthUser): Promise<ProfileRecord> {
  const existing = await deps.profiles.find(user.id);
  if (existing) return existing;

  const { profile, created } = await deps.profiles.create(user.id, user.suggestedName);
  if (created) {
    await deps.audit.record({ userId: user.id, action: 'profile.created', entityType: 'profile', entityId: user.id });
  }
  return profile;
}

const toMe = (profile: ProfileRecord, user: AuthUser) => ({ ...profile, email: user.email });

export const profileRoutes: FastifyPluginAsyncZod<ProfileRoutesDeps> = async (app, deps) => {
  app.addHook('onRequest', app.authenticate);

  app.get('/me', { schema: { response: { 200: meSchema } } }, async (request) => {
    const user = currentUser(request);
    return toMe(await ensureProfile(deps, user), user);
  });

  app.patch(
    '/me',
    { schema: { body: updateProfileBody, response: { 200: meSchema } } },
    async (request) => {
      const user = currentUser(request);
      const current = await ensureProfile(deps, user);
      const changes = request.body;
      checkBirthday(
        {
          birthDay: changes.birthDay !== undefined ? changes.birthDay : current.birthDay,
          birthMonth: changes.birthMonth !== undefined ? changes.birthMonth : current.birthMonth,
          birthYear: changes.birthYear !== undefined ? changes.birthYear : current.birthYear,
        },
        (deps.now?.() ?? new Date()).getUTCFullYear(),
      );
      const profile = await deps.profiles.update(user.id, changes);
      await deps.audit.record({
        userId: user.id,
        action: 'profile.updated',
        entityType: 'profile',
        entityId: user.id,
        metadata: { fields: Object.keys(changes) },
      });
      return toMe(profile, user);
    },
  );

  app.patch(
    '/me/preferences',
    { schema: { body: updatePreferencesBody, response: { 200: meSchema } } },
    async (request) => {
      const user = currentUser(request);
      await ensureProfile(deps, user);
      const profile = await deps.profiles.updatePreferences(user.id, request.body);
      await deps.audit.record({
        userId: user.id,
        action: 'preferences.updated',
        entityType: 'profile',
        entityId: user.id,
        metadata: { fields: Object.keys(request.body) },
      });
      return toMe(profile, user);
    },
  );
};
