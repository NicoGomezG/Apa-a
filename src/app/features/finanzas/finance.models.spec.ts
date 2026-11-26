import { describe, expect, it } from 'vitest';
import { ACCOUNT_PRESETS, missingPresets, presetPayload } from './finance.models';

describe('lista base de tarjetas', () => {
  it('trae las 8 cuentas pedidas', () => {
    expect(ACCOUNT_PRESETS.map((preset) => preset.name)).toEqual([
      'CMR crédito',
      'Santander crédito',
      'Banco de Chile',
      'BancoEstado débito',
      'Banco de Chile crédito',
      'Santander débito',
      'MACH',
      'Mercado Pago',
    ]);
  });

  it('oculta las que ya tienes aunque cambien mayúsculas, tildes o espacios', () => {
    const missing = missingPresets([{ name: 'cmr  credito' }, { name: 'Mach' }]);
    expect(missing.map((preset) => preset.key)).not.toContain('cmr-credito');
    expect(missing.map((preset) => preset.key)).not.toContain('mach');
    expect(missing).toHaveLength(6);
  });

  it('las de crédito se crean como tarjeta de crédito, sin datos inventados', () => {
    const cmr = presetPayload(ACCOUNT_PRESETS[0]!);
    expect(cmr).toEqual({
      name: 'CMR crédito',
      kind: 'credit_card',
      institution: 'Banco Falabella',
      last4: null,
      creditLimit: null,
      billingDay: null,
      paymentDay: null,
    });
  });
});
