import { currencyExponent, formatLongDate, formatMoney, greetingFor } from './format';

const plain = (value: string) => value.replace(/\s/g, ' ');

describe('formatMoney', () => {
  it('formatea pesos chilenos sin decimales y con punto de miles', () => {
    expect(formatMoney(1234567)).toBe('$1.234.567');
    expect(formatMoney(0)).toBe('$0');
  });

  it('formatea montos negativos', () => {
    expect(formatMoney(-15990)).toBe('-$15.990');
  });

  it('interpreta USD en centavos', () => {
    expect(formatMoney(12345, 'USD')).toBe('US$123,45');
    expect(plain(formatMoney(5, 'EUR'))).toBe('EUR 0,05');
  });

  it('no pierde precisión con montos sobre Number.MAX_SAFE_INTEGER', () => {
    expect(formatMoney(9007199254740993123n)).toBe('$9.007.199.254.740.993.123');
  });

  it('conoce los decimales de cada moneda', () => {
    expect(currencyExponent('CLP')).toBe(0);
    expect(currencyExponent('USD')).toBe(2);
  });
});

describe('fechas en la zona horaria del usuario', () => {
  // 02:30 UTC del 19 de octubre = 23:30 del 18 en Santiago (UTC-3 en horario de verano).
  const instant = new Date('2026-10-19T02:30:00Z');

  it('usa el día local, no el de UTC', () => {
    expect(formatLongDate(instant, 'America/Santiago')).toBe('domingo, 18 de octubre');
    expect(formatLongDate(instant, 'UTC')).toBe('lunes, 19 de octubre');
  });

  it('saluda según la hora local', () => {
    expect(greetingFor(instant, 'America/Santiago')).toBe('Buenas noches');
    expect(greetingFor(new Date('2026-10-19T13:00:00Z'), 'America/Santiago')).toBe('Buenos días');
    expect(greetingFor(new Date('2026-10-19T18:00:00Z'), 'America/Santiago')).toBe('Buenas tardes');
  });
});
