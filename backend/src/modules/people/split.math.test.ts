import { describe, expect, it } from 'vitest';
import {
  computeBalances,
  computeSplit,
  distributeProportional,
  simplifyDebts,
  splitEvenly,
  SplitError,
  tipFor,
} from './split.math.js';

const order = ['yo', 'ana', 'beto', 'caro'];
const sum = (values: bigint[]) => values.reduce((acc, value) => acc + value, 0n);

describe('división de montos', () => {
  it('divide en partes iguales y el peso sobrante va a los primeros', () => {
    expect(splitEvenly(10_000n, 3)).toEqual([3_334n, 3_333n, 3_333n]);
    expect(sum(splitEvenly(10_001n, 4))).toBe(10_001n);
  });

  it('reparte en proporción sin perder pesos', () => {
    const parts = distributeProportional(1_001n, [5_000n, 3_000n, 2_000n]);
    expect(sum(parts)).toBe(1_001n);
    expect(parts).toEqual([501n, 300n, 200n]);
  });

  it('propina del 10 % redondeada al peso', () => {
    expect(tipFor(45_990n, 10)).toBe(4_599n);
    expect(tipFor(12_345n, 10)).toBe(1_235n); // 1.234,5 → 1.235
    expect(tipFor(12_345n, 0)).toBe(0n);
  });
});

describe('reparto de un gasto', () => {
  it('partes iguales con propina: cada uno paga su parte más su 10 %', () => {
    const result = computeSplit({ mode: 'equal', order, amount: 30_000n, participantIds: ['yo', 'ana', 'beto'], tipPercent: 10 });
    expect(result).toMatchObject({ subtotal: 30_000n, tip: 3_000n, total: 33_000n });
    expect(result.shares).toEqual([
      { participantId: 'yo', consumption: 10_000n, tip: 1_000n },
      { participantId: 'ana', consumption: 10_000n, tip: 1_000n },
      { participantId: 'beto', consumption: 10_000n, tip: 1_000n },
    ]);
  });

  it('boleta por ítems: compartidos entre quienes consumieron, propina según lo de cada uno', () => {
    const result = computeSplit({
      mode: 'items',
      order,
      items: [
        { amount: 12_990n, participantIds: ['yo'] }, // lomo a lo pobre
        { amount: 9_990n, participantIds: ['ana'] }, // ensalada
        { amount: 15_000n, participantIds: ['yo', 'ana', 'beto'] }, // tabla para compartir
        { amount: 3_500n, participantIds: ['beto'] }, // bebida
      ],
      tipPercent: 10,
    });
    expect(result.subtotal).toBe(41_480n);
    expect(result.tip).toBe(4_148n);
    expect(result.total).toBe(45_628n);
    const byId = Object.fromEntries(result.shares.map((share) => [share.participantId, share]));
    expect(byId['yo']!.consumption).toBe(17_990n);
    expect(byId['ana']!.consumption).toBe(14_990n);
    expect(byId['beto']!.consumption).toBe(8_500n);
    expect(byId['yo']!.tip).toBe(1_799n);
    expect(sum(result.shares.map((share) => share.consumption + share.tip))).toBe(result.total);
    // Caro no consumió nada: no aparece.
    expect(byId['caro']).toBeUndefined();
  });

  it('montos exactos', () => {
    const result = computeSplit({
      mode: 'exact',
      order,
      exact: [
        { participantId: 'ana', amount: 7_000n },
        { participantId: 'yo', amount: 3_000n },
      ],
      tipPercent: 0,
    });
    expect(result.total).toBe(10_000n);
    expect(result.shares.map((share) => share.participantId)).toEqual(['yo', 'ana']);
  });

  it('rechaza personas fuera del grupo, ítems sin nadie y montos en cero', () => {
    expect(() => computeSplit({ mode: 'equal', order, amount: 1_000n, participantIds: ['otro'], tipPercent: 0 })).toThrow(SplitError);
    expect(() => computeSplit({ mode: 'items', order, items: [{ amount: 1_000n, participantIds: [] }], tipPercent: 0 })).toThrow(SplitError);
    expect(() => computeSplit({ mode: 'equal', order, amount: 0n, participantIds: ['yo'], tipPercent: 0 })).toThrow(SplitError);
  });
});

describe('saldos y quién le debe a quién', () => {
  const participants = order.map((id) => ({ id }));

  it('el que pagó queda a favor y el resto debe su parte', () => {
    const split = computeSplit({ mode: 'equal', order, amount: 40_000n, participantIds: order, tipPercent: 10 });
    const balances = computeBalances({ participants, expenses: [{ payerId: 'yo', total: split.total, shares: split.shares }], settlements: [] });
    expect(balances.map((item) => item.balance)).toEqual([33_000n, -11_000n, -11_000n, -11_000n]);
    expect(sum(balances.map((item) => item.balance))).toBe(0n);

    expect(simplifyDebts(balances)).toEqual([
      { fromId: 'ana', toId: 'yo', amount: 11_000n },
      { fromId: 'beto', toId: 'yo', amount: 11_000n },
      { fromId: 'caro', toId: 'yo', amount: 11_000n },
    ]);
  });

  it('un pago registrado salda la deuda', () => {
    const split = computeSplit({ mode: 'equal', order, amount: 20_000n, participantIds: ['yo', 'ana'], tipPercent: 0 });
    const balances = computeBalances({
      participants,
      expenses: [{ payerId: 'yo', total: split.total, shares: split.shares }],
      settlements: [{ fromId: 'ana', toId: 'yo', amount: 10_000n }],
    });
    expect(balances.every((item) => item.balance === 0n)).toBe(true);
    expect(simplifyDebts(balances)).toEqual([]);
  });

  it('con varios pagadores, minimiza las transferencias', () => {
    const balances = computeBalances({
      participants,
      expenses: [
        { payerId: 'yo', total: 30_000n, shares: order.slice(0, 3).map((id) => ({ participantId: id, consumption: 10_000n, tip: 0n })) },
        { payerId: 'ana', total: 9_000n, shares: ['beto', 'caro', 'ana'].map((id) => ({ participantId: id, consumption: 3_000n, tip: 0n })) },
      ],
      settlements: [],
    });
    const transfers = simplifyDebts(balances);
    expect(transfers).toEqual([
      // yo +20.000 · ana −4.000 · beto −13.000 · caro −3.000 → 3 transferencias.
      { fromId: 'beto', toId: 'yo', amount: 13_000n },
      { fromId: 'ana', toId: 'yo', amount: 4_000n },
      { fromId: 'caro', toId: 'yo', amount: 3_000n },
    ]);
  });
});
