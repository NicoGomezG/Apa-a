import { Component, inject, signal } from '@angular/core';
import { formatDay } from '../../core/format/format';
import type { ExchangeRate } from './finance.models';
import { FinanceService } from './finance.service';

const NAMES: Record<string, string> = { USD: 'Dólar', EUR: 'Euro' };

const pesos = new Intl.NumberFormat('es-CL', {
  style: 'currency',
  currency: 'CLP',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Pesos por unidad, para mostrar. Los cálculos con dinero se hacen en el backend con enteros. */
const toPesos = (micros: string) => Number(BigInt(micros)) / 1_000_000;

/** Apartado con el dólar y euro observados del Banco Central (vía mindicador.cl). */
@Component({
  selector: 'app-tipo-cambio',
  template: `
    <section class="apana-card" aria-labelledby="tipo-cambio">
      <h2 id="tipo-cambio" class="apana-section-title">
        <i class="fa-solid fa-dollar-sign" aria-hidden="true"></i>Tipo de cambio
      </h2>
      @if (loading()) {
        <p class="small mb-0" role="status">Cargando…</p>
      } @else if (rates().length === 0) {
        <p class="small mb-0">No pudimos obtener el tipo de cambio. Intenta más tarde.</p>
      } @else {
        <ul class="rates list-unstyled mb-2">
          @for (rate of rates(); track rate.currency) {
            <li>
              <span class="text-caption">{{ name(rate.currency) }} observado</span>
              <span class="display-stat">{{ value(rate.micros) }}</span>
              @if (rate.previous; as previous) {
                @let diff = change(rate.micros, previous.micros);
                <span class="small">
                  @if (diff.direction === 'same') {
                    Sin cambio
                  } @else {
                    <i
                      class="fa-solid {{ diff.direction === 'up' ? 'fa-arrow-trend-up' : 'fa-arrow-trend-down' }} me-1"
                      aria-hidden="true"
                    ></i>
                    <span class="visually-hidden">{{ diff.direction === 'up' ? 'Subió' : 'Bajó' }}</span>
                    {{ diff.label }}
                  }
                  respecto del {{ formatDay(previous.date) }}
                </span>
              }
            </li>
          }
        </ul>
        <p class="small mb-0">
          Valor del Banco Central publicado el {{ formatDay(rates()[0]!.date) }} (fuente: mindicador.cl). Es el que usamos para
          sumar tus suscripciones en dólares al gasto base.
        </p>
      }
    </section>
  `,
  styles: `
    .rates {
      display: grid;
      gap: 1rem;
      grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
    }
    .rates li {
      display: grid;
      gap: 0.15rem;
    }
  `,
})
export class TipoCambio {
  private readonly finance = inject(FinanceService);

  protected readonly rates = signal<ExchangeRate[]>([]);
  protected readonly loading = signal(true);
  protected readonly formatDay = formatDay;

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      this.rates.set((await this.finance.exchangeRates()).rates);
    } catch {
      this.rates.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  protected name(currency: string): string {
    return NAMES[currency] ?? currency;
  }

  protected value(micros: string): string {
    return pesos.format(toPesos(micros));
  }

  protected change(current: string, previous: string): { direction: 'up' | 'down' | 'same'; label: string } {
    const delta = BigInt(current) - BigInt(previous);
    if (delta === 0n) return { direction: 'same', label: '' };
    const sign = delta > 0n ? '+' : '−';
    const abs = delta > 0n ? delta : -delta;
    return { direction: delta > 0n ? 'up' : 'down', label: `${sign}${pesos.format(Number(abs) / 1_000_000)}` };
  }
}
