import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { formatDay } from '../../core/format/format';
import { MoneyPipe } from '../../core/format/money.pipe';
import { SPLIT_MODE_LABELS, type PublicGroup } from '../personas/people.models';
import { PeopleService } from '../personas/people.service';

/** Vista de solo lectura de un grupo de gastos, para invitados sin cuenta. */
@Component({
  selector: 'app-compartido',
  imports: [FormsModule, MoneyPipe],
  host: { style: '--apana-section-color: var(--apana-module-personas)' },
  template: `
    <main class="container py-4" style="max-width: 46rem">
      <p class="brand mb-4"><i class="fa-solid fa-user-group me-2" aria-hidden="true"></i>Apaña · gastos compartidos</p>

      @if (loading()) {
        <p role="status">Cargando…</p>
      } @else if (error(); as message) {
        <section class="apana-card">
          <h1 class="h5">No pudimos abrir este enlace</h1>
          <p class="mb-0">{{ message }}</p>
        </section>
      } @else if (data(); as d) {
        <h1 class="h3 mb-1">{{ d.group.name }}</h1>
        <p class="mb-4">
          @if (d.group.date) { {{ formatDay(d.group.date, true) }} · }
          Total <strong>{{ d.totalSpent | money: d.group.currency }}</strong>
        </p>

        <section class="apana-card mb-3" aria-labelledby="quien-soy">
          <label id="quien-soy" class="form-label fw-semibold" for="me">¿Quién eres?</label>
          <select id="me" class="form-select" [ngModel]="me()" (ngModelChange)="me.set($event)">
            <option value="">Elige tu nombre</option>
            @for (person of d.participants; track person.id) {
              <option [value]="person.id">{{ person.name }}</option>
            }
          </select>
          @if (mine(); as m) {
            <div class="mt-3">
              @if (m.pays.length === 0 && m.receives.length === 0) {
                <p class="mb-0 fw-semibold positive"><i class="fa-solid fa-circle-check me-1" aria-hidden="true"></i>Estás al día.</p>
              }
              @for (transfer of m.pays; track transfer.toId) {
                <p class="mb-1 fs-5">Le debes <strong>{{ transfer.amount | money: d.group.currency }}</strong> a {{ name(transfer.toId) }}.</p>
              }
              @for (transfer of m.receives; track transfer.fromId) {
                <p class="mb-1 fs-5">{{ name(transfer.fromId) }} te debe <strong>{{ transfer.amount | money: d.group.currency }}</strong>.</p>
              }
            </div>
          }
        </section>

        <section class="apana-card mb-3" aria-labelledby="pagos">
          <h2 id="pagos" class="apana-section-title"><i class="fa-solid fa-scale-balanced" aria-hidden="true"></i>¿Quién le debe a quién?</h2>
          @if (d.transfers.length === 0) {
            <p class="mb-0">Todos están al día.</p>
          } @else {
            <ul class="list-unstyled d-grid gap-2 mb-0">
              @for (transfer of d.transfers; track transfer.fromId + transfer.toId) {
                <li class="d-flex justify-content-between gap-2">
                  <span><strong>{{ name(transfer.fromId) }}</strong> le paga a <strong>{{ name(transfer.toId) }}</strong></span>
                  <span class="fw-bold text-nowrap">{{ transfer.amount | money: d.group.currency }}</span>
                </li>
              }
            </ul>
          }
        </section>

        <section class="apana-card" aria-labelledby="gastos">
          <h2 id="gastos" class="apana-section-title"><i class="fa-solid fa-receipt" aria-hidden="true"></i>Gastos</h2>
          <ul class="list-unstyled mb-0">
            @for (expense of d.expenses; track expense.id) {
              <li class="py-3 border-bottom">
                <div class="d-flex justify-content-between gap-2">
                  <div>
                    <div class="fw-semibold">{{ expense.description }}</div>
                    <div class="small">
                      {{ formatDay(expense.date) }} · pagó {{ name(expense.payerId) }} · {{ modeLabels[expense.mode] }}
                      @if (expense.tipPercent > 0) { · propina {{ expense.tipPercent }} % }
                    </div>
                  </div>
                  <span class="fw-bold text-nowrap">{{ expense.total | money: d.group.currency }}</span>
                </div>
                @if (expense.items.length > 0) {
                  <ul class="list-unstyled small mt-2 mb-1">
                    @for (item of expense.items; track $index) {
                      <li class="d-flex justify-content-between gap-2">
                        <span>@if (item.quantity > 1) { {{ item.quantity }} × }{{ item.description }} · {{ namesOf(item.participantIds) }}</span>
                        <span class="text-nowrap">{{ item.amount | money: d.group.currency }}</span>
                      </li>
                    }
                  </ul>
                }
                <ul class="list-unstyled small mt-2 mb-0">
                  @for (share of expense.shares; track share.participantId) {
                    <li class="d-flex justify-content-between gap-2" [class.fw-bold]="share.participantId === me()">
                      <span>{{ name(share.participantId) }}</span>
                      <span class="text-nowrap">
                        {{ share.consumption | money: d.group.currency }}
                        @if (expense.tipPercent > 0) { + {{ share.tip | money: d.group.currency }} propina }
                      </span>
                    </li>
                  }
                </ul>
              </li>
            } @empty {
              <li>Todavía no hay gastos.</li>
            }
          </ul>
        </section>

        <p class="small mt-4">Vista de solo lectura. Los datos los administra quien creó el grupo en Apaña.</p>
      }
    </main>
  `,
  styles: `
    :host {
      display: block;
      min-height: 100vh;
      background: var(--bs-body-bg);
    }
    .brand {
      font-weight: 800;
      color: var(--apana-section-color);
    }
    .positive {
      color: var(--bs-success);
    }
  `,
})
export class Compartido {
  private readonly people = inject(PeopleService);

  /** Código del enlace, desde la ruta /compartido/:token. */
  readonly token = input.required<string>();

  protected readonly formatDay = formatDay;
  protected readonly modeLabels = SPLIT_MODE_LABELS;
  protected readonly data = signal<PublicGroup | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly me = signal('');

  private readonly names = computed(() => new Map((this.data()?.participants ?? []).map((person) => [person.id, person.name])));

  protected readonly mine = computed(() => {
    const id = this.me();
    const data = this.data();
    if (!id || !data) return null;
    return {
      pays: data.transfers.filter((transfer) => transfer.fromId === id),
      receives: data.transfers.filter((transfer) => transfer.toId === id),
    };
  });

  constructor() {
    effect(() => {
      void this.load(this.token());
    });
  }

  private async load(token: string): Promise<void> {
    try {
      this.data.set(await this.people.publicGroup(token));
    } catch (error) {
      this.error.set(
        error instanceof HttpErrorResponse && error.status === 404
          ? 'El enlace no existe o quien lo creó lo desactivó. Pídele uno nuevo.'
          : 'Revisa tu conexión e inténtalo de nuevo.',
      );
    } finally {
      this.loading.set(false);
    }
  }

  protected name(id: string): string {
    return this.names().get(id) ?? '—';
  }

  protected namesOf(ids: string[]): string {
    return ids.map((id) => this.name(id)).join(', ');
  }
}
