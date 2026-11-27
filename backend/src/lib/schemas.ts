import { z } from 'zod';
import { isValidDay } from '../modules/finance/finance.dates.js';

// Esquemas Zod compartidos entre módulos.

const MAX_MINOR_UNITS = 10n ** 15n;

/** Dinero en unidad mínima: string de dígitos o entero seguro → BigInt. Nunca decimales. */
export const money = z
  .union([z.string().regex(/^-?\d{1,16}$/), z.number().int().refine(Number.isSafeInteger)])
  .transform((value) => BigInt(value))
  .refine((value) => value < MAX_MINOR_UNITS && value > -MAX_MINOR_UNITS, 'Monto fuera de rango');

export const positiveMoney = money.refine((value) => value > 0n, 'Debe ser mayor que cero');
export const nonNegativeMoney = money.refine((value) => value >= 0n, 'No puede ser negativo');

export const day = z.string().refine(isValidDay, 'Fecha inválida');

export const text = (max: number) => z.string().trim().min(1).max(max);

/** Texto opcional: '' se guarda como null. */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .optional();

/** Correo opcional, en minúsculas; '' se guarda como null. */
export const optionalEmail = z
  .string()
  .trim()
  .max(254)
  .transform((value) => (value === '' ? null : value.toLowerCase()))
  .refine((value) => value === null || z.email().safeParse(value).success, 'Correo inválido')
  .nullable()
  .optional();

/** Teléfono opcional (dígitos, +, espacios, guiones, paréntesis); '' se guarda como null. */
export const optionalPhone = optionalText(30).refine(
  (value) => !value || /^[+\d\s()-]{6,30}$/.test(value),
  'Teléfono inválido',
);
