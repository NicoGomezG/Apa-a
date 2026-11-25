import { Component, computed, model } from '@angular/core';
import { addMonthsTo, formatMonth } from '../../core/format/format';

/** Selector de mes calendario: ‹ noviembre 2026 › */
@Component({
  selector: 'app-month-picker',
  host: { class: 'd-inline-flex align-items-center gap-1' },
  template: `
    <button type="button" class="btn btn-sm btn-outline-primary" (click)="move(-1)" aria-label="Mes anterior">
      <i class="fa-solid fa-chevron-left" aria-hidden="true"></i>
    </button>
    <span class="fw-semibold text-capitalize px-2 month-label" aria-live="polite">{{ label() }}</span>
    <button type="button" class="btn btn-sm btn-outline-primary" (click)="move(1)" aria-label="Mes siguiente">
      <i class="fa-solid fa-chevron-right" aria-hidden="true"></i>
    </button>
  `,
  styles: `
    .month-label {
      min-width: 9.5rem;
      text-align: center;
    }
  `,
})
export class MonthPicker {
  readonly month = model.required<string>();
  protected readonly label = computed(() => formatMonth(this.month()));

  protected move(delta: number): void {
    this.month.set(addMonthsTo(this.month(), delta));
  }
}
