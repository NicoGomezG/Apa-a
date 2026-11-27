import { Component, computed, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { formatDay, moneyToInput, parseMoneyInput, todayIn } from '../../core/format/format';
import { MoneyPipe } from '../../core/format/money.pipe';
import { apiErrorMessage } from '../../core/http-errors';
import { ProfileService } from '../../core/profile/profile.service';
import { EmptyState } from '../../shared/ui/empty-state';
import type { Contact } from '../personas/people.models';
import { PeopleService } from '../personas/people.service';
import { CURRENCIES, type Debt, type DebtDirection, type DebtPayload } from './finance.models';
import { FinanceService } from './finance.service';

type Status = { kind: 'success' | 'error'; message: string } | null;

/** Valor del selector de persona para escribir un nombre a mano. */
const OTHER = '__otra__';

/** Días entre dos fechas 'YYYY-MM-DD' (b − a). */
export function daysBetween(a: string, b: string): number {
  const toUtc = (day: string) => {
    const [y, m, d] = day.split('-').map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}

/** Días que lleva sin moverse una deuda pendiente: desde el último abono o, si no hay, desde que empezó. */
export function daysWithoutPayment(debt: Pick<Debt, 'date' | 'lastPaymentDate'>, today: string): number {
  return Math.max(0, daysBetween(debt.lastPaymentDate ?? debt.date, today));
}

export function daysLabel(days: number): string {
  if (days === 0) return 'Hoy';
  if (days === 1) return '1 día';
  return `${days.toLocaleString('es-CL')} días`;
}

/** Totales pendientes por moneda (para "Te deben" / "Debes"). */
export function pendingTotals(debts: Pick<Debt, 'pending' | 'currency' | 'status'>[]): { currency: string; amount: bigint }[] {
  const totals = new Map<string, bigint>();
  for (const debt of debts) {
    if (debt.status !== 'pending') continue;
    totals.set(debt.currency, (totals.get(debt.currency) ?? 0n) + BigInt(debt.pending));
  }
  return [...totals].map(([currency, amount]) => ({ currency, amount }));
}

interface Draft {
  direction: DebtDirection;
  person: string;
  personName: string;
  description: string;
  amount: string;
  currency: string;
  date: string;
}

@Component({
  selector: 'app-finanzas-deudas',
  imports: [FormsModule, NgTemplateOutlet, MoneyPipe, EmptyState],
  templateUrl: './deudas.html',
  styles: `
    .totals {
      display: grid;
      gap: 1rem;
      grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
    }
    .total-card {
      display: grid;
      gap: 0.25rem;
    }
    .late {
      color: var(--bs-danger);
      font-weight: 600;
    }
    .debt-table td,
    .debt-table th {
      vertical-align: middle;
      white-space: nowrap;
    }
    .debt-table .reason {
      white-space: normal;
      min-width: 10rem;
    }
    .payments {
      background: var(--bs-light);
      border-radius: 10px;
      padding: 0.75rem 1rem;
    }
    .paid-row td,
    li.paid-row {
      opacity: 0.75;
    }
    .min-w-0 {
      min-width: 0;
    }
    .flex-none {
      flex: none;
    }
  `,
})
export class FinanzasDeudas {
  private readonly finance = inject(FinanceService);
  private readonly people = inject(PeopleService);
  private readonly profile = inject(ProfileService);

  protected readonly currencies = CURRENCIES;
  protected readonly other = OTHER;
  protected readonly formatDay = formatDay;
  protected readonly daysLabel = daysLabel;
  /** Desde cuántos días sin pago se marca en rojo. */
  protected readonly lateAfter = 30;

  protected readonly debts = signal<Debt[]>([]);
  protected readonly contacts = signal<Contact[]>([]);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly status = signal<Status>(null);
  protected readonly view = signal<DebtDirection>('owed_to_me');
  protected readonly showPaid = signal(false);
  protected readonly formOpen = signal(false);
  protected readonly editingId = signal<string | null>(null);
  protected readonly expandedId = signal<string | null>(null);
  protected readonly confirmDelete = signal<string | null>(null);

  protected draft: Draft = this.emptyDraft('owed_to_me');
  protected paymentDraft = { amount: '', date: '' };

  protected readonly today = computed(() => todayIn(this.profile.timezone()));
  protected readonly owedToMe = computed(() => this.debts().filter((debt) => debt.direction === 'owed_to_me'));
  protected readonly iOwe = computed(() => this.debts().filter((debt) => debt.direction === 'i_owe'));
  protected readonly owedTotals = computed(() => pendingTotals(this.owedToMe()));
  protected readonly oweTotals = computed(() => pendingTotals(this.iOwe()));
  protected readonly owedPeople = computed(() => this.peopleCount(this.owedToMe()));
  protected readonly owePeople = computed(() => this.peopleCount(this.iOwe()));

  /** Lista visible: pendientes primero (las más antiguas sin pago arriba), luego pagadas. */
  protected readonly rows = computed(() => {
    const today = this.today();
    const list = (this.view() === 'owed_to_me' ? this.owedToMe() : this.iOwe()).filter(
      (debt) => this.showPaid() || debt.status === 'pending',
    );
    return list
      .map((debt) => ({
        debt,
        days: debt.status === 'pending' ? daysWithoutPayment(debt, today) : null,
        tookDays: debt.paidAt ? daysBetween(debt.date, debt.paidAt) : null,
      }))
      .sort((a, b) => {
        if (a.debt.status !== b.debt.status) return a.debt.status === 'pending' ? -1 : 1;
        if (a.days !== null && b.days !== null) return b.days - a.days;
        return (b.debt.paidAt ?? '').localeCompare(a.debt.paidAt ?? '');
      });
  });
  protected readonly paidCount = computed(
    () => (this.view() === 'owed_to_me' ? this.owedToMe() : this.iOwe()).filter((debt) => debt.status === 'paid').length,
  );

  constructor() {
    void this.load();
  }

  private peopleCount(debts: Debt[]): number {
    return new Set(debts.filter((debt) => debt.status === 'pending').map((debt) => debt.contactId ?? debt.personName.toLowerCase()))
      .size;
  }

  private async load(): Promise<void> {
    try {
      const [debts, contacts] = await Promise.all([this.finance.debts(), this.people.contacts().catch(() => [])]);
      this.debts.set(debts);
      this.contacts.set(contacts.sort((a, b) => a.name.localeCompare(b.name)));
    } catch (error) {
      this.status.set({ kind: 'error', message: apiErrorMessage(error, 'No pudimos cargar tus deudas.') });
    } finally {
      this.loading.set(false);
    }
  }

  private async run(action: () => Promise<unknown>, success?: string): Promise<boolean> {
    this.busy.set(true);
    this.status.set(null);
    try {
      await action();
      if (success) this.status.set({ kind: 'success', message: success });
      return true;
    } catch (error) {
      this.status.set({ kind: 'error', message: apiErrorMessage(error) });
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  private replace(debt: Debt): void {
    this.debts.update((list) => (list.some((item) => item.id === debt.id) ? list.map((item) => (item.id === debt.id ? debt : item)) : [debt, ...list]));
  }

  private emptyDraft(direction: DebtDirection): Draft {
    return {
      direction,
      person: OTHER,
      personName: '',
      description: '',
      amount: '',
      currency: this.profile.me()?.preferences.currency ?? 'CLP',
      date: todayIn(this.profile.timezone()),
    };
  }

  // --- Formulario ---------------------------------------------------------------------
  protected openNew(): void {
    this.editingId.set(null);
    this.draft = this.emptyDraft(this.view());
    if (this.contacts().length > 0) this.draft.person = '';
    this.formOpen.set(true);
  }

  protected edit(debt: Debt): void {
    this.editingId.set(debt.id);
    this.draft = {
      direction: debt.direction,
      person: debt.contactId ?? OTHER,
      personName: debt.contactId ? '' : debt.personName,
      description: debt.description ?? '',
      amount: moneyToInput(debt.amount, debt.currency),
      currency: debt.currency,
      date: debt.date,
    };
    this.formOpen.set(true);
  }

  protected closeForm(): void {
    this.formOpen.set(false);
    this.editingId.set(null);
  }

  protected async save(): Promise<void> {
    const draft = this.draft;
    const amount = parseMoneyInput(draft.amount, draft.currency);
    if (amount === null || amount <= 0n) {
      this.status.set({ kind: 'error', message: 'Revisa el monto.' });
      return;
    }
    const contactId = draft.person && draft.person !== OTHER ? draft.person : null;
    const personName = contactId ? null : draft.personName.trim() || null;
    if (!contactId && !personName) {
      this.status.set({ kind: 'error', message: 'Elige un contacto o escribe el nombre de la persona.' });
      return;
    }
    const payload: DebtPayload = {
      direction: draft.direction,
      contactId,
      personName,
      description: draft.description.trim() || null,
      amount: amount.toString(),
      currency: draft.currency,
      date: draft.date,
    };
    const id = this.editingId();
    const ok = await this.run(async () => {
      if (id) {
        const { direction: _direction, currency: _currency, ...changes } = payload;
        this.replace(await this.finance.updateDebt(id, changes));
      } else {
        this.replace(await this.finance.createDebt(payload));
        this.view.set(payload.direction);
      }
    }, id ? 'Guardamos los cambios.' : 'Anotamos la deuda.');
    if (ok) this.closeForm();
  }

  protected async remove(debt: Debt): Promise<void> {
    const ok = await this.run(async () => {
      await this.finance.deleteDebt(debt.id);
      this.debts.update((list) => list.filter((item) => item.id !== debt.id));
    }, 'Borramos la deuda.');
    if (ok) this.confirmDelete.set(null);
  }

  // --- Abonos -------------------------------------------------------------------------
  protected toggle(debt: Debt): void {
    if (this.expandedId() === debt.id) {
      this.expandedId.set(null);
      return;
    }
    this.expandedId.set(debt.id);
    this.paymentDraft = { amount: moneyToInput(debt.pending, debt.currency), date: this.today() };
  }

  protected async addPayment(debt: Debt): Promise<void> {
    const amount = parseMoneyInput(this.paymentDraft.amount, debt.currency);
    if (amount === null || amount <= 0n) {
      this.status.set({ kind: 'error', message: 'Revisa el monto del pago.' });
      return;
    }
    const full = amount === BigInt(debt.pending);
    await this.run(
      async () => {
        const updated = await this.finance.addDebtPayment(debt.id, { amount: amount.toString(), date: this.paymentDraft.date });
        this.replace(updated);
        this.paymentDraft = { amount: moneyToInput(updated.pending, updated.currency), date: this.today() };
        if (updated.status === 'paid') this.expandedId.set(null);
      },
      full ? 'Quedó pagada.' : 'Anotamos el pago.',
    );
  }

  protected async removePayment(debt: Debt, paymentId: string): Promise<void> {
    await this.run(async () => this.replace(await this.finance.deleteDebtPayment(debt.id, paymentId)), 'Borramos el pago.');
  }

  protected isLate(days: number | null): boolean {
    return days !== null && days >= this.lateAfter;
  }
}
