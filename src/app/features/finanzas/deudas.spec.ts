import { describe, expect, it } from 'vitest';
import { daysBetween, daysLabel, daysWithoutPayment, pendingTotals } from './deudas';

describe('deudas', () => {
  it('cuenta los días entre fechas, también entre meses y años', () => {
    expect(daysBetween('2026-11-01', '2026-11-27')).toBe(26);
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
    expect(daysBetween('2026-03-01', '2026-03-31')).toBe(30); // cambio de horario no afecta (UTC)
  });

  it('días sin pagar: desde el último pago o, si no hay, desde que empezó', () => {
    expect(daysWithoutPayment({ date: '2026-10-01', lastPaymentDate: null }, '2026-11-27')).toBe(57);
    expect(daysWithoutPayment({ date: '2026-10-01', lastPaymentDate: '2026-11-20' }, '2026-11-27')).toBe(7);
    expect(daysWithoutPayment({ date: '2026-11-28', lastPaymentDate: null }, '2026-11-27')).toBe(0);
  });

  it('etiqueta de días', () => {
    expect(daysLabel(0)).toBe('Hoy');
    expect(daysLabel(1)).toBe('1 día');
    expect(daysLabel(1200)).toBe('1.200 días');
  });

  it('suma lo pendiente por moneda e ignora las pagadas', () => {
    expect(
      pendingTotals([
        { pending: '25000', currency: 'CLP', status: 'pending' },
        { pending: '5000', currency: 'CLP', status: 'pending' },
        { pending: '0', currency: 'CLP', status: 'paid' },
        { pending: '1999', currency: 'USD', status: 'pending' },
      ]),
    ).toEqual([
      { currency: 'CLP', amount: 30_000n },
      { currency: 'USD', amount: 1_999n },
    ]);
  });
});
