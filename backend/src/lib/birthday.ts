import { z } from 'zod';
import { badRequest } from './errors.js';

// Cumpleaños como día + mes, con año opcional (solo para la edad). Lo usan contactos y perfil.

export const birthdayFields = {
  birthDay: z.number().int().min(1).max(31).nullable().optional(),
  birthMonth: z.number().int().min(1).max(12).nullable().optional(),
  birthYear: z.number().int().min(1900).max(2100).nullable().optional(),
};

export interface Birthday {
  birthDay: number | null;
  birthMonth: number | null;
  birthYear: number | null;
}

const isLeap = (year: number) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
const daysInMonth = (month: number) => new Date(Date.UTC(2000, month, 0)).getUTCDate(); // 2000: bisiesto, admite 29-feb

/** Valida que el cumpleaños sea un día real; el año solo tiene sentido con día y mes. */
export function checkBirthday({ birthDay, birthMonth, birthYear }: Birthday, currentYear: number): void {
  if ((birthDay === null) !== (birthMonth === null)) throw badRequest('Indica el día y el mes del cumpleaños');
  if (birthDay !== null && birthMonth !== null && birthDay > daysInMonth(birthMonth)) {
    throw badRequest('Ese día no existe en ese mes');
  }
  if (birthYear !== null) {
    if (birthDay === null) throw badRequest('Indica el día y el mes además del año');
    if (birthYear > currentYear) throw badRequest('El año de nacimiento no puede ser futuro');
    if (birthDay === 29 && birthMonth === 2 && !isLeap(birthYear)) throw badRequest('Ese año no tuvo 29 de febrero');
  }
}
