import { Pipe, type PipeTransform } from '@angular/core';
import { DEFAULT_CURRENCY, formatMoney } from './format';

/** {{ monto | money }} · {{ monto | money: 'USD' }} — el monto viene en unidad mínima. */
@Pipe({ name: 'money' })
export class MoneyPipe implements PipeTransform {
  transform(minorUnits: bigint | number | string | null | undefined, currency = DEFAULT_CURRENCY): string {
    if (minorUnits === null || minorUnits === undefined || minorUnits === '') return '';
    return formatMoney(typeof minorUnits === 'string' ? BigInt(minorUnits) : minorUnits, currency);
  }
}
