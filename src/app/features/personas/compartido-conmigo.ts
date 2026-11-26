import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { formatDay, moneyToInput, parseMoneyInput, todayIn } from '../../core/format/format';
import { MoneyPipe } from '../../core/format/money.pipe';
import { apiErrorMessage } from '../../core/http-errors';
import { ProfileService } from '../../core/profile/profile.service';
import { SPLIT_MODE_LABELS, type SharedGroupDetail, type Transfer } from './people.models';
import { PeopleService } from './people.service';

type Status = { kind: 'success' | 'error'; message: string } | null;

interface PaymentDraft {
  toId: string;
  amount: string;
  date: string;
}

/** Grupo de otra persona donde participas como amigo: ves lo que debes e informas tus pagos. */
@Component({
  selector: 'app-personas-compartido-conmigo',
  imports: [FormsModule, RouterLink, MoneyPipe],
  template: `
    <a class="d-inline-block mb-3" routerLink="/personas/gastos">
      <i class="fa-solid fa-arrow-left me-1" aria-hidden="true"></i>Gastos compartidos
    </a>

    @if (status(); as s) {
      <div class="alert py-2" [class.alert-success]="s.kind === 'success'" [class.alert-danger]="s.kind === 'error'" role="status">
        {{ s.message }}
      </div>
    }

    @if (loading()) {
      <p role="status">Cargando…</p>
    } @else if (detail(); as d) {
      <header class="mb-3">
        <h2 class="h4 mb-1">{{ d.group.name }}</h2>
        <p class="mb-0">
          Grupo de {{ d.ownerName || 'tu amigo' }} ·
          @if (d.group.date) { {{ formatDay(d.group.date, true) }} · }
          Total <strong>{{ d.totalSpent | money: d.group.currency }}</strong>
        </p>
      </header>

      <div class="row g-3">
        <div class="col-12 col-lg-6 d-grid gap-3 align-content-start">
          <section class="apana-card" aria-labelledby="tu-saldo">
            <h3 id="tu-saldo" class="apana-section-title"><i class="fa-solid fa-wallet" aria-hidden="true"></i>Tu saldo</h3>
            @if (d.remindedAt && mine().pays.length > 0) {
              <p class="reminder mb-3">
                <i class="fa-solid fa-bell me-1" aria-hidden="true"></i>{{ d.ownerName || 'Tu amigo' }} te recordó este pago el
                {{ formatDay(d.remindedAt.slice(0, 10)) }}.
              </p>
            }
            @if (mine().pays.length === 0 && mine().receives.length === 0) {
              <p class="mb-0 fw-semibold positive"><i class="fa-solid fa-circle-check me-1" aria-hidden="true"></i>Estás al día.</p>
            }
            <ul class="list-unstyled d-grid gap-3 mb-0">
              @for (transfer of mine().pays; track transfer.toId) {
                <li>
                  <p class="fs-5 mb-2">Le debes <strong>{{ transfer.amount | money: d.group.currency }}</strong> a {{ name(transfer.toId) }}.</p>
                  @if (paying() === transfer.toId) {
                    <form class="row g-2 align-items-end" (ngSubmit)="report()">
                      <div class="col-6">
                        <label class="form-label small mb-1" for="payAmount">Monto que pagaste</label>
                        <input id="payAmount" name="amount" class="form-control" inputmode="numeric" [(ngModel)]="payment.amount" />
                      </div>
                      <div class="col-6">
                        <label class="form-label small mb-1" for="payDate">Fecha</label>
                        <input id="payDate" name="date" type="date" class="form-control" [(ngModel)]="payment.date" />
                      </div>
                      <div class="col-12 d-flex gap-2">
                        <button type="submit" class="btn btn-primary btn-sm" [disabled]="busy()">Avisar que pagué</button>
                        <button type="button" class="btn btn-outline-primary btn-sm" (click)="paying.set(null)">Cancelar</button>
                      </div>
                    </form>
                  } @else {
                    <button type="button" class="btn btn-sm btn-primary" (click)="startPayment(transfer)">
                      <i class="fa-solid fa-money-bill-transfer me-1" aria-hidden="true"></i>Ya le pagué
                    </button>
                  }
                </li>
              }
              @for (transfer of mine().receives; track transfer.fromId) {
                <li class="fs-5">{{ name(transfer.fromId) }} te debe <strong>{{ transfer.amount | money: d.group.currency }}</strong>.</li>
              }
            </ul>
          </section>

          @if (myPending().length > 0) {
            <section class="apana-card" aria-labelledby="por-confirmar">
              <h3 id="por-confirmar" class="apana-section-title"><i class="fa-solid fa-hourglass-half" aria-hidden="true"></i>Pagos por confirmar</h3>
              <p class="small">{{ d.ownerName || 'Tu amigo' }} debe confirmarlos. Hasta entonces no cambian los saldos.</p>
              <ul class="list-unstyled d-grid gap-2 mb-0">
                @for (settlement of myPending(); track settlement.id) {
                  <li class="d-flex flex-wrap align-items-center gap-2">
                    <span class="flex-grow-1">A {{ name(settlement.toId) }} · {{ formatDay(settlement.date) }}</span>
                    <span class="fw-semibold">{{ settlement.amount | money: d.group.currency }}</span>
                    <button type="button" class="btn btn-sm btn-outline-danger" (click)="withdraw(settlement.id)" [disabled]="busy()">Retirar</button>
                  </li>
                }
              </ul>
            </section>
          }

          <section class="apana-card" aria-labelledby="quien-debe">
            <h3 id="quien-debe" class="apana-section-title"><i class="fa-solid fa-scale-balanced" aria-hidden="true"></i>¿Quién le debe a quién?</h3>
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
        </div>

        <div class="col-12 col-lg-6">
          <section class="apana-card" aria-labelledby="gastos-grupo">
            <h3 id="gastos-grupo" class="apana-section-title"><i class="fa-solid fa-receipt" aria-hidden="true"></i>Gastos</h3>
            <ul class="list-unstyled mb-0">
              @for (expense of d.expenses; track expense.id) {
                <li class="py-2 border-bottom">
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
                  @if (shareOf(expense.shares); as share) {
                    <div class="small mt-1">Tu parte: <strong>{{ share | money: d.group.currency }}</strong></div>
                  }
                </li>
              } @empty {
                <li>Todavía no hay gastos.</li>
              }
            </ul>

            @if (d.settlements.length > 0) {
              <h4 class="h6 fw-bold mt-3">Pagos</h4>
              <ul class="list-unstyled mb-0 d-grid gap-2">
                @for (settlement of d.settlements; track settlement.id) {
                  <li class="d-flex flex-wrap gap-2">
                    <span class="flex-grow-1">
                      {{ name(settlement.fromId) }} le pagó a {{ name(settlement.toId) }} · {{ formatDay(settlement.date) }}
                      @if (!settlement.confirmed) { <span class="badge text-bg-warning">Por confirmar</span> }
                    </span>
                    <span class="fw-semibold">{{ settlement.amount | money: d.group.currency }}</span>
                  </li>
                }
              </ul>
            }
          </section>
        </div>
      </div>

      <p class="small mt-4 mb-0">Solo puedes ver este grupo y avisar tus pagos. Los gastos los administra {{ d.ownerName || 'quien creó el grupo' }}.</p>
    } @else {
      <p>No encontramos este grupo. Puede que ya no te tenga en él.</p>
    }
  `,
  styles: `
    .positive {
      color: var(--bs-success);
    }
    .reminder {
      padding: 0.5rem 0.75rem;
      border-radius: 0.5rem;
      border: 1px solid var(--bs-warning);
      background: var(--bs-warning-bg-subtle);
      color: var(--bs-warning-text-emphasis);
      font-weight: 600;
    }
  `,
})
export class PersonasCompartidoConmigo {
  private readonly people = inject(PeopleService);
  private readonly profile = inject(ProfileService);

  /** Viene de la ruta /personas/compartidos/:id. */
  readonly id = input.required<string>();

  protected readonly formatDay = formatDay;
  protected readonly modeLabels = SPLIT_MODE_LABELS;

  protected readonly detail = signal<SharedGroupDetail | null>(null);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly status = signal<Status>(null);
  /** A quién le estás informando un pago (id del participante). */
  protected readonly paying = signal<string | null>(null);
  protected payment: PaymentDraft = { toId: '', amount: '', date: '' };

  private readonly names = computed(() => {
    const detail = this.detail();
    return new Map(
      (detail?.participants ?? []).map((person) => [person.id, person.id === detail?.youId ? `${person.name} (tú)` : person.name]),
    );
  });

  protected readonly mine = computed(() => {
    const detail = this.detail();
    if (!detail) return { pays: [], receives: [] };
    return {
      pays: detail.transfers.filter((transfer) => transfer.fromId === detail.youId),
      receives: detail.transfers.filter((transfer) => transfer.toId === detail.youId),
    };
  });

  protected readonly myPending = computed(() =>
    (this.detail()?.settlements ?? []).filter((settlement) => settlement.reportedByYou && !settlement.confirmed),
  );

  constructor() {
    effect(() => {
      void this.load(this.id());
    });
  }

  private async load(id: string): Promise<void> {
    try {
      this.detail.set(await this.people.sharedGroup(id));
    } catch (error) {
      this.detail.set(null);
      this.status.set({ kind: 'error', message: apiErrorMessage(error, 'No pudimos cargar el grupo.') });
    } finally {
      this.loading.set(false);
    }
  }

  protected name(id: string): string {
    return this.names().get(id) ?? '—';
  }

  protected shareOf(shares: { participantId: string; consumption: string; tip: string }[]): bigint | null {
    const share = shares.find((item) => item.participantId === this.detail()?.youId);
    return share ? BigInt(share.consumption) + BigInt(share.tip) : null;
  }

  protected startPayment(transfer: Transfer): void {
    const currency = this.detail()?.group.currency ?? 'CLP';
    this.payment = { toId: transfer.toId, amount: moneyToInput(transfer.amount, currency), date: todayIn(this.profile.timezone()) };
    this.paying.set(transfer.toId);
  }

  protected async report(): Promise<void> {
    const draft = this.payment;
    const detail = this.detail();
    if (!this.paying() || !detail) return;
    const amount = parseMoneyInput(draft.amount, detail.group.currency);
    if (amount === null || amount <= 0n) {
      this.status.set({ kind: 'error', message: 'Escribe el monto que pagaste.' });
      return;
    }
    await this.run(async () => {
      await this.people.reportPayment(detail.group.id, { toId: draft.toId, amount: String(amount), date: draft.date });
      this.paying.set(null);
    }, `Listo: le avisamos a ${detail.ownerName || 'tu amigo'}. El pago cuenta cuando lo confirme.`);
  }

  protected async withdraw(id: string): Promise<void> {
    await this.run(() => this.people.withdrawPayment(this.id(), id), 'Retiramos el aviso de pago.');
  }

  private async run(action: () => Promise<unknown>, success: string): Promise<void> {
    this.busy.set(true);
    this.status.set(null);
    try {
      await action();
      await this.load(this.id());
      this.status.set({ kind: 'success', message: success });
    } catch (error) {
      this.status.set({ kind: 'error', message: apiErrorMessage(error) });
    } finally {
      this.busy.set(false);
    }
  }
}
