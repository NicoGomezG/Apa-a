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
