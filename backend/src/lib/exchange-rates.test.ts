import { describe, expect, it } from 'vitest';
import { convertToClp, createMindicadorRates, rateToMicros } from './exchange-rates.js';

const USD = { currency: 'USD', micros: 948_520_000n, date: '2026-11-27' };

describe('tipo de cambio', () => {
  it('pasa el valor a enteros sin perder decimales', () => {
    expect(rateToMicros(948.52)).toBe(948_520_000n);
    expect(rateToMicros(1012.3456789)).toBe(1_012_345_679n);
    expect(() => rateToMicros(0)).toThrow();
  });

  it('convierte centavos a pesos redondeando al peso', () => {
    expect(convertToClp(999n, 'USD', USD)).toBe(9_476n); // 9,99 × 948,52 = 9.475,7
    expect(convertToClp(100n, 'USD', USD)).toBe(949n); // 948,52 → 949
    expect(convertToClp(0n, 'USD', USD)).toBe(0n);
  });

  it('pide el indicador una vez, lo guarda y si la API falla usa el último valor', async () => {
    let time = 0;
    let calls = 0;
    let fail = false;
    const rates = createMindicadorRates(
      async (url) => {
        calls += 1;
        expect(url).toBe('https://mindicador.cl/api/dolar');
        if (fail) throw new Error('down');
        return {
          ok: true,
          json: async () => ({
            serie: [
              { fecha: '2026-11-27T03:00:00.000Z', valor: 948.52 },
              { fecha: '2026-11-26T03:00:00.000Z', valor: 950 },
            ],
          }),
        };
      },
      () => time,
    );
    const withPrevious = { ...USD, previous: { micros: 950_000_000n, date: '2026-11-26' } };
    expect(await rates.toClp('USD')).toEqual(withPrevious);
    await rates.toClp('USD');
    expect(calls).toBe(1);

    time += 7 * 3_600_000; // venció el caché
    fail = true;
    expect(await rates.toClp('USD')).toEqual(withPrevious);
    expect(calls).toBe(2);
  });

  it('monedas sin indicador o API caída sin valor previo: null', async () => {
    const rates = createMindicadorRates(async () => {
      throw new Error('down');
    });
    expect(await rates.toClp('JPY')).toBeNull();
    expect(await rates.toClp('EUR')).toBeNull();
  });
});
