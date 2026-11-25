// Formatos regionales. Por defecto Chile (es-CL, CLP, America/Santiago), pero
// todo recibe la moneda y la zona horaria para soportar otras más adelante.

export const DEFAULT_LOCALE = 'es-CL';
export const DEFAULT_CURRENCY = 'CLP';
export const DEFAULT_TIMEZONE = 'America/Santiago';

/** Decimales de cada moneda (ISO 4217). El dinero se maneja en unidades mínimas enteras. */
export function currencyExponent(currency: string): number {
  return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
}

/**
 * Formatea un monto en unidad mínima (CLP: pesos; USD: centavos).
 * Usa bigint/enteros: nunca aritmética de punto flotante sobre dinero.
 */
export function formatMoney(minorUnits: bigint | number, currency = DEFAULT_CURRENCY, locale = DEFAULT_LOCALE): string {
  const amount = typeof minorUnits === 'bigint' ? minorUnits : BigInt(Math.trunc(minorUnits));
  const exponent = currencyExponent(currency);
  const divisor = 10n ** BigInt(exponent);
  const negative = amount < 0n;
  const abs = negative ? -amount : amount;
  // Se arma el decimal como string para no perder precisión en montos grandes.
  const whole = abs / divisor;
  const fraction = (abs % divisor).toString().padStart(exponent, '0');
  const decimal = exponent > 0 ? `${whole}.${fraction}` : `${whole}`;
  const formatted = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  }).format(decimal as unknown as number);
  return negative ? `-${formatted}` : formatted;
}

/** "sábado 18 de octubre" en la zona horaria del usuario. */
export function formatLongDate(date: Date, timeZone = DEFAULT_TIMEZONE, locale = DEFAULT_LOCALE): string {
  return new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', timeZone }).format(date);
}

/** Hora local (0–23) en una zona horaria. */
export function hourIn(date: Date, timeZone = DEFAULT_TIMEZONE): number {
  const hour = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone }).format(date);
  return Number(hour);
}

export function greetingFor(date: Date, timeZone = DEFAULT_TIMEZONE): string {
  const hour = hourIn(date, timeZone);
  if (hour >= 5 && hour < 12) return 'Buenos días';
  if (hour >= 12 && hour < 20) return 'Buenas tardes';
  return 'Buenas noches';
}

// --- Días y meses del calendario ('YYYY-MM-DD' / 'YYYY-MM') ------------------
// Son días, no instantes: se formatean en UTC para que ninguna zona horaria
// los corra al día anterior.

const dayToUtc = (day: string) => new Date(`${day.slice(0, 10)}T12:00:00Z`);

/** '2026-11-25' → '25 nov' · con año: '25 nov 2026'. */
export function formatDay(day: string, withYear = false, locale = DEFAULT_LOCALE): string {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    ...(withYear ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  })
    .format(dayToUtc(day))
    .replace('.', '');
}

/** '2026-11' → 'noviembre 2026' · corto: 'nov 2026'. */
export function formatMonth(month: string, short = false, locale = DEFAULT_LOCALE): string {
  return new Intl.DateTimeFormat(locale, { month: short ? 'short' : 'long', year: 'numeric', timeZone: 'UTC' })
    .format(dayToUtc(`${month}-01`))
    .replace('.', '')
    .replace(' de ', ' ');
}

/** Suma meses a 'YYYY-MM'. */
export function addMonthsTo(month: string, count: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const index = y * 12 + (m - 1) + count;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/** Día de hoy ('YYYY-MM-DD') en una zona horaria. */
export function todayIn(timeZone = DEFAULT_TIMEZONE, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

// --- Montos escritos por la persona ------------------------------------------

/**
 * Convierte lo que alguien escribe ("12.990", "$ 12.990", "12,99" en USD) a unidad
 * mínima. Devuelve null si no es un monto válido. Nunca pasa por punto flotante.
 */
export function parseMoneyInput(text: string, currency = DEFAULT_CURRENCY): bigint | null {
  const exponent = currencyExponent(currency);
  const clean = text.replace(/[\s$]/g, '').replace(/^[A-Z]{3}/i, '');
  if (!clean) return null;
  const match = clean.match(/^(-?)(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d+))?$/);
  if (!match) return null;
  const [, sign, wholePart, fractionPart = ''] = match;
  if (fractionPart.length > exponent) return null;
  const whole = BigInt(wholePart!.replace(/\./g, ''));
  const fraction = BigInt(fractionPart.padEnd(exponent, '0') || '0');
  const value = whole * 10n ** BigInt(exponent) + fraction;
  return sign ? -value : value;
}

/** Unidad mínima → texto editable ("12990" → "12.990"; USD "1299" → "12,99"). */
export function moneyToInput(minorUnits: bigint | string, currency = DEFAULT_CURRENCY): string {
  const amount = typeof minorUnits === 'bigint' ? minorUnits : BigInt(minorUnits);
  const exponent = currencyExponent(currency);
  const negative = amount < 0n;
  const abs = negative ? -amount : amount;
  const divisor = 10n ** BigInt(exponent);
  const whole = (abs / divisor).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const fraction = exponent > 0 ? `,${(abs % divisor).toString().padStart(exponent, '0')}` : '';
  return `${negative ? '-' : ''}${whole}${fraction}`;
}
