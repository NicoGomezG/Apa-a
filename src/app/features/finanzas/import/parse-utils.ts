// Utilidades para leer montos y fechas en formato chileno.

/** "54.990" · "$ -256.019" · "$9.147" · "-443.630" → BigInt. Null si no es un monto. */
export function parseChileanAmount(text: string | number | null | undefined): bigint | null {
  if (text === null || text === undefined) return null;
  if (typeof text === 'number') return Number.isSafeInteger(text) ? BigInt(text) : null;
  const clean = text.replace(/[\s$]/g, '');
  if (!/^-?\d{1,3}(\.\d{3})*$|^-?\d+$/.test(clean)) return null;
  return BigInt(clean.replace(/\./g, ''));
}

/** "19/11/2026" o "19/11/26" → "2026-11-19". */
export function parseChileanDate(text: string): string | null {
  const match = text.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!match) return null;
  const [, d, m, y] = match;
  const year = y!.length === 2 ? `20${y}` : y!;
  const day = d!.padStart(2, '0');
  const month = m!.padStart(2, '0');
  if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > 31) return null;
  return `${year}-${month}-${day}`;
}

/** Serial de fecha de Excel (días desde 1899-12-30) → "YYYY-MM-DD". */
export function excelSerialToDate(serial: number): string {
  const ms = Math.round((serial - 25569) * 86_400_000);
  return new Date(ms).toISOString().slice(0, 10);
}

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** "DICIEMBRE" / "dic" / "sept" → 1..12, o null. */
export function spanishMonthNumber(text: string): number | null {
  const clean = normalizeText(text).replace(/\.$/, '');
  if (clean.length < 3) return null;
  const index = MONTHS.findIndex((month) => month.startsWith(clean) || (clean === 'set' && month === 'septiembre'));
  return index >= 0 ? index + 1 : null;
}

export function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Colapsa espacios repetidos, sin cambiar mayúsculas. */
export function cleanDescription(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export const monthOf = (day: string) => day.slice(0, 7);

export function addMonths(month: string, count: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const index = y * 12 + (m - 1) + count;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

export function monthDiff(from: string, to: string): number {
  const [fy, fm] = from.split('-').map(Number) as [number, number];
  const [ty, tm] = to.split('-').map(Number) as [number, number];
  return (ty - fy) * 12 + (tm - fm);
}

/** Últimos 4 dígitos de un número enmascarado o con guiones. */
export function lastFourDigits(text: string): string | null {
  const digits = text.replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : null;
}
