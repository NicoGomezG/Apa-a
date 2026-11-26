// Cálculo del reparto de gastos. Todo en BigInt (unidad mínima, pesos enteros en CLP):
// lo que se reparte siempre suma exactamente el total de la boleta.

export type SplitMode = 'equal' | 'exact' | 'items';

export interface ShareResult {
  participantId: string;
  consumption: bigint;
  tip: bigint;
}

export interface SplitResult {
  subtotal: bigint;
  tip: bigint;
  total: bigint;
  shares: ShareResult[];
}

export interface SplitInput {
  mode: SplitMode;
  /** Orden del grupo: define a quién le toca el peso sobrante al redondear. */
  order: string[];
  /** equal: monto a dividir y entre quiénes. */
  amount?: bigint;
  participantIds?: string[];
  /** exact: cuánto consumió cada persona. */
  exact?: { participantId: string; amount: bigint }[];
  /** items: líneas de la boleta y entre quiénes se divide cada una. */
  items?: { amount: bigint; participantIds: string[] }[];
  /** Propina como porcentaje del consumo (ej. 10). */
  tipPercent: number;
}

export class SplitError extends Error {}

/** Divide `amount` en `count` partes casi iguales; el peso sobrante va a las primeras. */
export function splitEvenly(amount: bigint, count: number): bigint[] {
  if (count <= 0) throw new SplitError('No hay entre quiénes dividir');
  const n = BigInt(count);
  const base = amount / n;
  const remainder = Number(amount - base * n);
  return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1n : 0n));
}

/**
 * Reparte `total` en proporción a `weights` (método del resto mayor). Ante empate de
 * restos gana el que va antes, así el resultado es siempre el mismo.
 */
export function distributeProportional(total: bigint, weights: bigint[]): bigint[] {
  const sum = weights.reduce((acc, weight) => acc + weight, 0n);
  if (sum === 0n) return weights.map(() => 0n);
  const parts = weights.map((weight) => (total * weight) / sum);
  let left = total - parts.reduce((acc, part) => acc + part, 0n);
  const byRemainder = weights
    .map((weight, index) => ({ index, remainder: (total * weight) % sum }))
    .sort((a, b) => (b.remainder > a.remainder ? 1 : b.remainder < a.remainder ? -1 : a.index - b.index));
  for (const { index } of byRemainder) {
    if (left <= 0n) break;
    parts[index]! += 1n;
    left -= 1n;
  }
  return parts;
}

/** Propina sobre el consumo, redondeada al peso más cercano (la mitad hacia arriba). */
export function tipFor(subtotal: bigint, percent: number): bigint {
  if (percent <= 0) return 0n;
  return (subtotal * BigInt(percent) + 50n) / 100n;
}

const ordered = (ids: string[], order: string[]) => {
  const unique = [...new Set(ids)];
  for (const id of unique) if (!order.includes(id)) throw new SplitError('Hay una persona que no está en el grupo');
  return unique.sort((a, b) => order.indexOf(a) - order.indexOf(b));
};

export function computeSplit(input: SplitInput): SplitResult {
  const consumption = new Map<string, bigint>();
  const add = (id: string, value: bigint) => consumption.set(id, (consumption.get(id) ?? 0n) + value);

  if (input.mode === 'equal') {
    const amount = input.amount ?? 0n;
    if (amount <= 0n) throw new SplitError('El monto debe ser mayor que cero');
    const ids = ordered(input.participantIds ?? [], input.order);
    splitEvenly(amount, ids.length).forEach((part, index) => add(ids[index]!, part));
  } else if (input.mode === 'exact') {
    const entries = input.exact ?? [];
    ordered(
      entries.map((entry) => entry.participantId),
      input.order,
    );
    if (new Set(entries.map((entry) => entry.participantId)).size !== entries.length) {
      throw new SplitError('Una persona aparece dos veces');
    }
    for (const entry of entries) {
      if (entry.amount < 0n) throw new SplitError('Los montos no pueden ser negativos');
      add(entry.participantId, entry.amount);
    }
  } else {
    const items = input.items ?? [];
    if (items.length === 0) throw new SplitError('Agrega al menos un ítem de la boleta');
    for (const item of items) {
      if (item.amount < 0n) throw new SplitError('Los ítems no pueden ser negativos');
      const ids = ordered(item.participantIds, input.order);
      if (ids.length === 0) throw new SplitError('Cada ítem debe tener al menos una persona');
      splitEvenly(item.amount, ids.length).forEach((part, index) => add(ids[index]!, part));
    }
  }

  const ids = input.order.filter((id) => consumption.has(id));
  const consumptions = ids.map((id) => consumption.get(id)!);
  const subtotal = consumptions.reduce((acc, value) => acc + value, 0n);
  if (subtotal <= 0n) throw new SplitError('El total debe ser mayor que cero');

  const tip = tipFor(subtotal, input.tipPercent);
  const tips = distributeProportional(tip, consumptions);

  return {
    subtotal,
    tip,
    total: subtotal + tip,
    shares: ids.map((participantId, index) => ({
      participantId,
      consumption: consumptions[index]!,
      tip: tips[index]!,
    })),
  };
}

// --- Saldos ----------------------------------------------------------------------

export interface BalanceInput {
  participants: { id: string }[];
  expenses: { payerId: string; total: bigint; shares: { participantId: string; consumption: bigint; tip: bigint }[] }[];
  settlements: { fromId: string; toId: string; amount: bigint }[];
}

export interface Balance {
  participantId: string;
  paid: bigint;
  owed: bigint;
  /** > 0: le deben · < 0: debe. */
  balance: bigint;
}

export function computeBalances(input: BalanceInput): Balance[] {
  const paid = new Map<string, bigint>();
  const owed = new Map<string, bigint>();
  const settled = new Map<string, bigint>();
  const add = (map: Map<string, bigint>, id: string, value: bigint) => map.set(id, (map.get(id) ?? 0n) + value);

  for (const expense of input.expenses) {
    add(paid, expense.payerId, expense.total);
    for (const share of expense.shares) add(owed, share.participantId, share.consumption + share.tip);
  }
  for (const settlement of input.settlements) {
    // Quien paga achica su deuda; quien recibe deja de tener a favor.
    add(settled, settlement.fromId, settlement.amount);
    add(settled, settlement.toId, -settlement.amount);
  }

  return input.participants.map(({ id }) => {
    const p = paid.get(id) ?? 0n;
    const o = owed.get(id) ?? 0n;
    return { participantId: id, paid: p, owed: o, balance: p - o + (settled.get(id) ?? 0n) };
  });
}

export interface Transfer {
  fromId: string;
  toId: string;
  amount: bigint;
}

/** Quién le paga a quién, con pocas transferencias (el que más debe al que más le deben). */
export function simplifyDebts(balances: Balance[]): Transfer[] {
  const debtors = balances
    .filter((item) => item.balance < 0n)
    .map((item) => ({ id: item.participantId, amount: -item.balance }));
  const creditors = balances
    .filter((item) => item.balance > 0n)
    .map((item) => ({ id: item.participantId, amount: item.balance }));
  const byAmount = (a: { amount: bigint }, b: { amount: bigint }) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0);

  const transfers: Transfer[] = [];
  debtors.sort(byAmount);
  creditors.sort(byAmount);
  while (debtors.length > 0 && creditors.length > 0) {
    const debtor = debtors[0]!;
    const creditor = creditors[0]!;
    const amount = debtor.amount < creditor.amount ? debtor.amount : creditor.amount;
    transfers.push({ fromId: debtor.id, toId: creditor.id, amount });
    debtor.amount -= amount;
    creditor.amount -= amount;
    if (debtor.amount === 0n) debtors.shift();
    if (creditor.amount === 0n) creditors.shift();
    debtors.sort(byAmount);
    creditors.sort(byAmount);
  }
  return transfers;
}
