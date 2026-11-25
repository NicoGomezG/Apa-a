import { addMonthsTo, currencyExponent, formatDay, formatLongDate, formatMoney, formatMonth, greetingFor, moneyToInput, parseMoneyInput, todayIn } from './format';

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

describe('días y meses del calendario', () => {
  it('no corre el día por la zona horaria', () => {
    expect(formatDay('2026-11-01')).toBe('1 nov');
    expect(formatDay('2026-12-31', true)).toBe('31 dic 2026');
  });

  it('formatea meses', () => {
    expect(formatMonth('2026-11')).toBe('noviembre 2026');
    expect(formatMonth('2027-01', true)).toBe('ene 2027');
  });

  it('suma meses cruzando el año', () => {
    expect(addMonthsTo('2026-11', 3)).toBe('2027-02');
    expect(addMonthsTo('2026-01', -1)).toBe('2025-12');
  });

  it('calcula hoy en la zona del usuario', () => {
    expect(todayIn('America/Santiago', new Date('2026-11-26T02:00:00Z'))).toBe('2026-11-25');
  });
});

describe('montos escritos a mano', () => {
  it('entiende pesos con o sin puntos', () => {
    expect(parseMoneyInput('12.990')).toBe(12990n);
    expect(parseMoneyInput('$ 1.234.567')).toBe(1234567n);
    expect(parseMoneyInput('6990')).toBe(6990n);
    expect(parseMoneyInput('-500')).toBe(-500n);
  });

  it('rechaza decimales en CLP y textos inválidos', () => {
    expect(parseMoneyInput('12,5')).toBeNull();
    expect(parseMoneyInput('doce')).toBeNull();
    expect(parseMoneyInput('')).toBeNull();
    expect(parseMoneyInput('1.23')).toBeNull();
  });

  it('usa centavos en USD', () => {
    expect(parseMoneyInput('12,99', 'USD')).toBe(1299n);
    expect(parseMoneyInput('10', 'USD')).toBe(1000n);
    expect(parseMoneyInput('1,999', 'USD')).toBeNull();
  });

  it('vuelve a texto editable', () => {
    expect(moneyToInput('1234567')).toBe('1.234.567');
    expect(moneyToInput(1299n, 'USD')).toBe('12,99');
    expect(moneyToInput('-500')).toBe('-500');
  });
});
