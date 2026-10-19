import type { FastifyError, FastifyInstance } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';

export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = (message = 'No encontramos lo que buscabas') =>
  new AppError(404, 'NOT_FOUND', message);

export const unauthorized = (message = 'Tu sesión no es válida o expiró') =>
  new AppError(401, 'UNAUTHORIZED', message);

export const badRequest = (message: string) => new AppError(400, 'BAD_REQUEST', message);

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({ code: error.code, message: error.message });
    }

    if (hasZodFastifySchemaValidationErrors(error)) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Revisa los datos enviados',
        fields: error.validation.map((issue) => issue.instancePath.replace(/^\//, '')),
      });
    }

    if (error.statusCode === 429) {
      return reply
        .status(429)
        .send({ code: 'RATE_LIMITED', message: 'Demasiadas solicitudes, intenta en un momento' });
    }

    if (error.statusCode && error.statusCode < 500) {
      return reply.status(error.statusCode).send({ code: 'BAD_REQUEST', message: 'Solicitud inválida' });
    }

    request.log.error({ err: error }, 'unhandled error');
    return reply.status(500).send({ code: 'INTERNAL', message: 'Algo falló de nuestro lado' });
  });

  app.setNotFoundHandler((_request, reply) => {
    reply.status(404).send({ code: 'NOT_FOUND', message: 'Ruta no encontrada' });
  });
}
