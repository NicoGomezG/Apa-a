import { randomBytes } from 'node:crypto';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AppError, badRequest, notFound } from '../../lib/errors.js';
import { optionalText } from '../../lib/schemas.js';
import { currentUser } from '../../plugins/auth.js';
import type { AuditAction, AuditRepository } from '../audit/audit.repository.js';
import { ensureProfile } from '../profile/profile.routes.js';
import type { ProfileRepository } from '../profile/profile.repository.js';
import type { FriendsRepository } from './friends.repository.js';

export interface FriendsRoutesDeps {
  friends: FriendsRepository;
  profiles: ProfileRepository;
  audit: AuditRepository;
  now?: () => Date;
}

/** 24 bytes aleatorios en base64url = 32 caracteres (192 bits), igual que el enlace de invitados. */
export const INVITE_CODE_RE = /^[A-Za-z0-9_-]{32}$/;
export const INVITE_TTL_DAYS = 7;
export const MAX_ACTIVE_INVITES = 10;

const conflict = (message: string) => new AppError(409, 'CONFLICT', message);

const friendParams = z.object({ friendId: z.uuid() });
const inviteParams = z.object({ id: z.uuid() });
const codeParams = z.object({ code: z.string() });
const acceptBody = z.object({ code: z.string() });
const linkBody = z.object({ contactId: z.uuid().nullable() });
const nicknameBody = z.object({ nickname: optionalText(40) });

/** Rutas de amistad: invitación por enlace, aceptar, listar, enlazar contacto y eliminar. */
export const friendsRoutes: FastifyPluginAsyncZod<FriendsRoutesDeps> = async (app, deps) => {
  app.addHook('onRequest', app.authenticate);
  const now = deps.now ?? (() => new Date());

  const audit = (userId: string, action: AuditAction, entityType: string, entityId: string) =>
    deps.audit.record({ userId, action, entityType, entityId });

  const findValidInvite = async (code: string) =>
    INVITE_CODE_RE.test(code) ? deps.friends.findInvite(code, now()) : null;

  // --- Amigos --------------------------------------------------------------------
  app.get('/', async (request) => {
    const user = currentUser(request);
    return deps.friends.listFriends(user.id);
  });

  app.patch('/:friendId', { schema: { params: friendParams, body: linkBody } }, async (request) => {
    const user = currentUser(request);
    const { friendId } = request.params;
    if (!(await deps.friends.areFriends(user.id, friendId))) throw notFound('No encontramos a ese amigo');
    if (!(await deps.friends.linkContact(user.id, friendId, request.body.contactId))) {
      throw notFound('No encontramos ese contacto');
    }
    await audit(user.id, 'friends.contact.linked', 'friend', friendId);
    const friend = (await deps.friends.listFriends(user.id)).find((item) => item.userId === friendId);
    return friend;
  });

  /** Apodo propio para el amigo (vive en el contacto enlazado; el amigo no lo ve). */
  app.put('/:friendId/nickname', { schema: { params: friendParams, body: nicknameBody } }, async (request) => {
    const user = currentUser(request);
    const { friendId } = request.params;
    const friend = (await deps.friends.listFriends(user.id)).find((item) => item.userId === friendId);
    if (!friend) throw notFound('No encontramos a ese amigo');
    const nickname = request.body.nickname ?? null;
    await deps.friends.setNickname(user.id, friendId, nickname, friend.displayName ?? nickname ?? 'Amigo');
    await audit(user.id, 'friends.nickname.updated', 'friend', friendId);
    return (await deps.friends.listFriends(user.id)).find((item) => item.userId === friendId);
  });

  app.delete('/:friendId', { schema: { params: friendParams } }, async (request, reply) => {
    const user = currentUser(request);
    if (!(await deps.friends.removeFriend(user.id, request.params.friendId))) throw notFound('No encontramos a ese amigo');
    await audit(user.id, 'friends.removed', 'friend', request.params.friendId);
    return reply.status(204).send();
  });

  // --- Invitaciones ------------------------------------------------------------
  app.get('/invites', async (request) => {
    const user = currentUser(request);
    return deps.friends.listInvites(user.id, now());
  });

  app.post('/invites', { config: { rateLimit: { max: 20, timeWindow: '1 hour' } } }, async (request, reply) => {
    const user = currentUser(request);
    await ensureProfile(deps, user);
    const active = await deps.friends.listInvites(user.id, now());
    if (active.length >= MAX_ACTIVE_INVITES) {
      throw conflict(`Tienes ${MAX_ACTIVE_INVITES} invitaciones sin usar. Anula alguna antes de crear otra.`);
    }
    const code = randomBytes(24).toString('base64url');
    const expiresAt = new Date(now().getTime() + INVITE_TTL_DAYS * 86_400_000);
    const invite = await deps.friends.createInvite(user.id, code, expiresAt);
    await audit(user.id, 'friends.invite.created', 'friend_invite', invite.id);
    return reply.status(201).send(invite);
  });

  app.delete('/invites/:id', { schema: { params: inviteParams } }, async (request, reply) => {
    const user = currentUser(request);
    if (!(await deps.friends.deleteInvite(user.id, request.params.id))) throw notFound('No encontramos esa invitación');
    await audit(user.id, 'friends.invite.revoked', 'friend_invite', request.params.id);
    return reply.status(204).send();
  });

  /** Quién invita, para mostrarlo antes de aceptar. */
  app.get(
    '/invites/:code/preview',
    { schema: { params: codeParams }, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request) => {
      const user = currentUser(request);
      const invite = await findValidInvite(request.params.code);
      if (!invite) throw notFound('Esta invitación no existe, ya se usó o venció');
      return {
        inviterName: invite.inviterName,
        own: invite.userId === user.id,
        alreadyFriends: await deps.friends.areFriends(user.id, invite.userId),
      };
    },
  );

  app.post(
    '/accept',
    { schema: { body: acceptBody }, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const user = currentUser(request);
      await ensureProfile(deps, user);
      const invite = await findValidInvite(request.body.code);
      if (!invite) throw notFound('Esta invitación no existe, ya se usó o venció');
      if (invite.userId === user.id) throw badRequest('Esta invitación es tuya: compártela con tu amigo');
      const alreadyFriends = await deps.friends.areFriends(user.id, invite.userId);
      if (!(await deps.friends.acceptInvite(invite.id, invite.userId, user.id))) {
        throw notFound('Esta invitación no existe, ya se usó o venció');
      }
      if (!alreadyFriends) {
        await audit(user.id, 'friends.accepted', 'friend', invite.userId);
        await audit(invite.userId, 'friends.accepted', 'friend', user.id);
      }
      const friend = (await deps.friends.listFriends(user.id)).find((item) => item.userId === invite.userId);
      return reply.status(alreadyFriends ? 200 : 201).send({ alreadyFriends, friend });
    },
  );
};
