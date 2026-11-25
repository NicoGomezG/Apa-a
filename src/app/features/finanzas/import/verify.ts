import type { ParsedImport, ParsedInstallment } from './import.types';
import { addMonths, monthDiff } from './parse-utils';

/** Cuota que se paga en `month` (la última ajusta el redondeo, igual que los bancos). */
export function installmentAmountIn(item: ParsedInstallment, month: string): bigint {
  const firstDue = addMonths(item.currentDueMonth, -(item.currentNumber - 1));
  const number = monthDiff(firstDue, month) + 1;
  if (number < 1 || number > item.installmentCount) return 0n;
  if (number < item.installmentCount) return item.installmentAmount;
  // Si este estado de cuenta trae la última cuota, su valor es el que cobra el banco.
  if (item.currentNumber === item.installmentCount) return item.installmentAmount;
  const last = item.totalAmount - item.installmentAmount * BigInt(item.installmentCount - 1);
  return last > 0n ? last : item.installmentAmount;
}

export interface UpcomingCheck {
  month: string;
  bank: bigint;
  projected: bigint;
  matches: boolean;
}

/**
 * Compara las cuotas que proyecta Apaña con la tabla "vencimientos próximos meses"
 * del banco. Si no cuadran, algo se leyó mal o hay cargos que no son compras en cuotas.
 */
export function verifyUpcoming(parsed: ParsedImport): UpcomingCheck[] {
  if (!parsed.statement) return [];
  return parsed.statement.upcoming.map(({ month, amount }) => {
    const projected = parsed.installments.reduce((sum, item) => sum + installmentAmountIn(item, month), 0n);
    return { month, bank: amount, projected, matches: projected === amount };
  });
}

/** Cuotas futuras de cada compra, para mostrar en qué meses caen. */
export function futureInstallments(item: ParsedInstallment): { number: number; month: string; amount: bigint }[] {
  const result = [];
  for (let number = item.currentNumber; number <= item.installmentCount; number += 1) {
    const month = addMonths(item.currentDueMonth, number - item.currentNumber);
    result.push({ number, month, amount: installmentAmountIn(item, month) });
  }
  return result;
}

/**
 * Suma de lo cargado en el período (compras al contado, comisiones y la cuota de
 * cada compra en cuotas) contra el total facturado. Puede no cuadrar si quedó
 * saldo impago del período anterior.
 */
export function verifyTotal(parsed: ParsedImport): { charged: bigint; billed: bigint; matches: boolean } | null {
  if (!parsed.statement) return null;
  const purchases = parsed.movements.filter((m) => m.kind === 'expense').reduce((sum, m) => sum - m.amount, 0n);
  const installments = parsed.installments.reduce(
    (sum, item) => sum + installmentAmountIn(item, item.currentDueMonth),
    0n,
  );
  const charged = purchases + installments;
  return { charged, billed: parsed.statement.totalBilled, matches: charged === parsed.statement.totalBilled };
}
