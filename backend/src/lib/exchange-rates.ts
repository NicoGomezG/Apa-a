// Tipo de cambio a CLP: dólar y euro observados del Banco Central, vía la API pública
// mindicador.cl. Solo se pide el indicador (no se envía ningún dato de la persona).
// Si la API no responde, se devuelve null y los montos quedan sin convertir.

export interface ExchangeRate {
  currency: string;
  /** Pesos por 1 unidad de la moneda, multiplicado por 1.000.000 (sin decimales flotantes). */
  micros: bigint;
  /** Fecha del valor publicado ('YYYY-MM-DD'). */
  date: string;
  /** Valor publicado anterior, para mostrar la variación. */
  previous?: { micros: bigint; date: string };
}

/** Monedas con tipo de cambio disponible. */
export const RATE_CURRENCIES = ['USD', 'EUR'] as const;

export interface ExchangeRates {
  /** Valor para convertir `currency` a CLP, o null si no hay (moneda no soportada o API caída). */
  toClp(currency: string): Promise<ExchangeRate | null>;
}

/** Indicador de mindicador.cl para cada moneda soportada. */
const INDICATORS: Record<string, string> = { USD: 'dolar', EUR: 'euro' };

const HOUR = 3_600_000;
const SUCCESS_TTL = 6 * HOUR;
const FAILURE_TTL = 5 * 60_000;
const TIMEOUT_MS = 3_000;

/** 948.52 → 948520000n. Usa el texto con 6 decimales: nunca opera el dinero en flotante. */
export function rateToMicros(value: number): bigint {
  if (!Number.isFinite(value) || value <= 0) throw new Error('invalid rate');
  const [whole, fraction = ''] = value.toFixed(6).split('.');
  return BigInt(whole!) * 1_000_000n + BigInt(fraction.padEnd(6, '0'));
}

/** Decimales de cada moneda (ISO 4217), como en el front. */
export function currencyExponent(currency: string): number {
  return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
}

/** Convierte un monto en unidad mínima a pesos, redondeando al peso más cercano. */
export function convertToClp(amount: bigint, currency: string, rate: ExchangeRate): bigint {
  const divisor = 10n ** BigInt(currencyExponent(currency)) * 1_000_000n;
  const product = amount * rate.micros;
  const sign = product < 0n ? -1n : 1n;
  return (sign * (sign * product + divisor / 2n)) / divisor;
}

type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

export function createMindicadorRates(fetchImpl: FetchLike = fetch, now: () => number = Date.now): ExchangeRates {
  const cache = new Map<string, { value: ExchangeRate | null; expires: number }>();
  const inflight = new Map<string, Promise<ExchangeRate | null>>();

  const load = async (currency: string, indicator: string): Promise<ExchangeRate | null> => {
    try {
      const response = await fetchImpl(`https://mindicador.cl/api/${indicator}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!response.ok) throw new Error('bad status');
      const data = (await response.json()) as { serie?: { fecha?: string; valor?: number }[] };
      const [latest, before] = data.serie ?? [];
      if (!latest?.fecha || typeof latest.valor !== 'number') throw new Error('bad payload');
      const rate: ExchangeRate = { currency, micros: rateToMicros(latest.valor), date: latest.fecha.slice(0, 10) };
      if (before?.fecha && typeof before.valor === 'number' && before.valor > 0) {
        rate.previous = { micros: rateToMicros(before.valor), date: before.fecha.slice(0, 10) };
      }
      cache.set(currency, { value: rate, expires: now() + SUCCESS_TTL });
      return rate;
    } catch {
      // Si había un valor anterior, se sigue usando mientras se reintenta.
      const stale = cache.get(currency)?.value ?? null;
      cache.set(currency, { value: stale, expires: now() + FAILURE_TTL });
      return stale;
    }
  };

  return {
    async toClp(currency) {
      if (currency === 'CLP') return { currency, micros: 1_000_000n, date: '' };
      const indicator = INDICATORS[currency];
      if (!indicator) return null;
      const cached = cache.get(currency);
      if (cached && cached.expires > now()) return cached.value;
      let pending = inflight.get(currency);
      if (!pending) {
        pending = load(currency, indicator).finally(() => inflight.delete(currency));
        inflight.set(currency, pending);
      }
      return pending;
    },
  };
}
