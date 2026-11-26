import { describe, expect, it } from 'vitest';
import { computeSplit, tipFor } from './split.math';

// Mismos casos que backend/src/modules/people/split.math.test.ts: la vista previa
// tiene que mostrar exactamente lo que el backend va a guardar.
describe('vista previa del reparto (igual que el backend)', () => {
  const order = ['yo', 'ana', 'beto', 'caro'];

  it('boleta por ítems con propina del 10 %', () => {
    const result = computeSplit({
      mode: 'items',
      order,
      items: [
        { amount: 12_990n, participantIds: ['yo'] },
        { amount: 9_990n, participantIds: ['ana'] },
        { amount: 15_000n, participantIds: ['yo', 'ana', 'beto'] },
        { amount: 3_500n, participantIds: ['beto'] },
      ],
      tipPercent: 10,
    });
    expect(result).toMatchObject({ subtotal: 41_480n, tip: 4_148n, total: 45_628n });
    expect(result.shares.map((share) => share.consumption + share.tip)).toEqual([19_789n, 16_489n, 9_350n]);
  });

  it('redondeo de la propina', () => {
    expect(tipFor(12_345n, 10)).toBe(1_235n);
  });
});
