import { Component, computed, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { addMonthsTo, formatDay, formatMonth, moneyToInput, parseMoneyInput, todayIn } from '../../core/format/format';
import { MoneyPipe } from '../../core/format/money.pipe';
import { apiErrorMessage } from '../../core/http-errors';
import { ProfileService } from '../../core/profile/profile.service';
import { EmptyState } from '../../shared/ui/empty-state';
import {
  type Account,
  BILL_EVERY_MONTHS,
  BILL_KINDS,
  type Bill,
  type BillEveryMonths,
  type BillKind,
  type BillPayload,
  type BillsMonth,
  type BillStatus,
  billKindIcon,
  billKindLabel,
  CURRENCIES,
} from './finance.models';
import { FinanceService } from './finance.service';

type Status = { kind: 'success' | 'error'; message: string } | null;

export const BILL_STATUS_LABELS: Record<BillStatus, string> = {
  paid: 'Pagada',
  pending: 'Por pagar',
  overdue: 'Vencida',
};

/** Cuentas del mes en orden: vencidas, por pagar (por fecha) y pagadas al final. */
export function sortForMonth(bills: Bill[]): Bill[] {
  const rank: Record<BillStatus, number> = { overdue: 0, pending: 1, paid: 2 };
  return bills
    .filter((bill) => bill.active && bill.status !== null)
    .sort(
      (a, b) =>
        rank[a.status!] - rank[b.status!] || (a.dueDate ?? '').localeCompare(b.dueDate ?? '') || a.name.localeCompare(b.name, 'es'),
    );
}

interface Draft {
  kind: BillKind;
  name: string;
  company: string;
  amount: string;
  currency: string;
  dueDay: number | null;
  everyMonths: BillEveryMonths;
  startMonth: string;
  accountId: string;
  autopay: boolean;
  notes: string;
}

@Component({
  selector: 'app-finanzas-cuentas-fijas',
  imports: [FormsModule, NgTemplateOutlet, MoneyPipe, EmptyState],
  templateUrl: './cuentas-fijas.html',
  styles: `
    .totals {
      display: grid;
      gap: 1rem;
      grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
    }
    .total-card {
      display: grid;
      gap: 0.25rem;
    }
    .month-nav {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .month-nav .label {
      min-width: 9rem;
      text-align: center;
      font-weight: 600;
    }
    .kind-icon {
      display: inline-grid;
      place-items: center;
      flex: none;
      width: 2.25rem;
      height: 2.25rem;
      border-radius: 50%;
      background: color-mix(in srgb, var(--apana-section-color) 12%, transparent);
      color: var(--apana-section-color);
    }
    .bill {
      border-top: 1px solid var(--bs-border-color);
    }
    .bill-main {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.75rem 1rem;
    }
    .bill-toggle {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      flex: 1 1 auto;
      min-width: 0;
      padding: 0;
      border: 0;
      background: none;
      color: inherit;
      text-align: start;
    }
    .bill-detail {
      padding: 0 1rem 1rem calc(1rem + 2.25rem + 0.75rem);
    }
    @media (max-width: 575.98px) {
      .bill-main {
        flex-wrap: wrap;
      }
      .bill-detail {
        padding-left: 1rem;
      }
    }
    .pay-form {
      background: var(--bs-tertiary-bg);
      border-radius: 10px;
      padding: 0.75rem;
    }
    .badge {
      font-weight: 600;
    }
    .status-paid {
      background: var(--bs-success-bg-subtle);
      color: var(--bs-success-text-emphasis);
    }
    .status-pending {
      background: var(--bs-secondary-bg);
      color: var(--bs-body-color);
    }
    .status-overdue {
      background: var(--bs-danger);
      color: #fff;
    }
    .history {
      font-size: 0.875rem;
    }
    .min-w-0 {
      min-width: 0;
    }
    .flex-none {
      flex: none;
    }
    .muted-row {
      opacity: 0.75;
    }
  `,
})
export class FinanzasCuentasFijas {
  private readonly finance = inject(FinanceService);
  private readonly profile = inject(ProfileService);

  protected readonly kinds = BILL_KINDS;
  protected readonly frequencies = BILL_EVERY_MONTHS;
  protected readonly currencies = CURRENCIES;
  protected readonly statusLabels = BILL_STATUS_LABELS;
  protected readonly icon = billKindIcon;
  protected readonly kindLabel = billKindLabel;
  protected readonly formatDay = formatDay;
  protected readonly formatMonth = formatMonth;

  protected readonly today = signal(todayIn(this.profile.timezone()));
  protected readonly month = signal(this.today().slice(0, 7));
  protected readonly data = signal<BillsMonth | null>(null);
  protected readonly accounts = signal<Account[]>([]);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly status = signal<Status>(null);

  protected readonly formOpen = signal(false);
  protected readonly editingId = signal<string | null>(null);
  protected readonly expandedId = signal<string | null>(null);
  protected readonly payingId = signal<string | null>(null);
  protected readonly confirmDelete = signal<string | null>(null);
  protected draft: Draft = this.emptyDraft();
  protected payDraft = { amount: '', paidOn: '' };

  protected readonly bills = computed(() => this.data()?.bills ?? []);
  protected readonly currency = computed(() => this.data()?.currency ?? this.profile.me()?.preferences.currency ?? 'CLP');
  /** Las que vencen en el mes elegido. */
  protected readonly dueThisMonth = computed(() => sortForMonth(this.bills()));
  /** Activas que no vencen este mes (bimestrales, anuales o que empiezan después). */
  protected readonly notThisMonth = computed(() => this.bills().filter((bill) => bill.active && bill.status === null));
  protected readonly paused = computed(() => this.bills().filter((bill) => !bill.active));
  protected readonly overdueCount = computed(() => this.dueThisMonth().filter((bill) => bill.status === 'overdue').length);
  protected readonly isCurrentMonth = computed(() => this.month() === this.today().slice(0, 7));

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      const [data, accounts] = await Promise.all([this.finance.bills(this.month()), this.finance.accounts().catch(() => [])]);
      this.data.set(data);
      this.accounts.set(accounts);
    } catch (error) {
      this.status.set({ kind: 'error', message: apiErrorMessage(error, 'No pudimos cargar tus cuentas fijas.') });
    } finally {
      this.loading.set(false);
    }
  }

  protected changeMonth(delta: number): void {
    this.month.set(addMonthsTo(this.month(), delta));
    this.payingId.set(null);
    this.expandedId.set(null);
    void this.load();
  }

  protected accountName(id: string | null): string | null {
    return id ? (this.accounts().find((account) => account.id === id)?.name ?? null) : null;
  }

  /** Lo que se muestra como monto del mes: lo pagado o el estimado. */
  protected monthAmount(bill: Bill): string {
    return bill.payment?.amount ?? bill.estimate;
  }

  protected frequencyLabel(bill: Bill): string {
    return this.frequencies.find((item) => item.value === bill.everyMonths)?.label ?? '';
  }

  /** "Vence el 20" / "Vence el 20 (cada 2 meses)" para las que no vencen este mes. */
  protected nextDueLabel(bill: Bill): string {
    return bill.nextDue ? `Próximo vencimiento: ${formatDay(bill.nextDue.date, true)}` : 'Sin próximos vencimientos';
  }

  // --- Pagar ---------------------------------------------------------------------------
  protected startPay(bill: Bill): void {
    this.payingId.set(bill.id);
    this.payDraft = {
      amount: moneyToInput(bill.payment?.amount ?? bill.estimate, bill.currency),
      paidOn: bill.payment?.paidOn ?? (this.isCurrentMonth() ? this.today() : (bill.dueDate ?? this.today())),
    };
    this.status.set(null);
  }

  protected async pay(bill: Bill): Promise<void> {
    const amount = parseMoneyInput(this.payDraft.amount, bill.currency);
    if (amount === null || amount <= 0n) {
      this.status.set({ kind: 'error', message: 'Escribe cuánto pagaste.' });
      return;
    }
    if (!this.payDraft.paidOn) {
      this.status.set({ kind: 'error', message: 'Indica el día en que pagaste.' });
      return;
    }
    await this.run(async () => {
      await this.finance.payBill(bill.id, this.month(), { amount: amount.toString(), paidOn: this.payDraft.paidOn });
      this.payingId.set(null);
      await this.refresh();
    }, `Anotamos el pago de ${bill.name}.`);
  }

  protected async unpay(bill: Bill): Promise<void> {
    await this.run(async () => {
      await this.finance.unpayBill(bill.id, this.month());
      await this.refresh();
    }, 'Quitamos el pago de este mes.');
  }

  // --- Formulario ----------------------------------------------------------------------
  private emptyDraft(): Draft {
    return {
      kind: 'agua',
      name: 'Agua',
      company: '',
      amount: '',
      currency: this.profile.me()?.preferences.currency ?? 'CLP',
      dueDay: null,
      everyMonths: 1,
      startMonth: todayIn(this.profile.timezone()).slice(0, 7),
      accountId: '',
      autopay: false,
      notes: '',
    };
  }

  /** Al cambiar el tipo, propone el nombre si no se había escrito otro. */
  protected kindChanged(kind: BillKind): void {
    const previous = this.kinds.find((item) => item.label === this.draft.name);
    if (!this.draft.name || previous) this.draft.name = kind === 'otra' ? '' : billKindLabel(kind);
    this.draft.kind = kind;
  }

  protected openNew(): void {
    this.draft = this.emptyDraft();
    this.editingId.set(null);
    this.formOpen.set(true);
    this.status.set(null);
    this.scrollToForm();
  }

  protected edit(bill: Bill): void {
    this.draft = {
      kind: bill.kind,
      name: bill.name,
      company: bill.company ?? '',
      amount: moneyToInput(bill.amount, bill.currency),
      currency: bill.currency,
      dueDay: bill.dueDay,
      everyMonths: bill.everyMonths,
      startMonth: bill.startMonth,
      accountId: bill.accountId ?? '',
      autopay: bill.autopay,
      notes: bill.notes ?? '',
    };
    this.editingId.set(bill.id);
    this.formOpen.set(true);
    this.status.set(null);
    this.scrollToForm();
  }

  protected closeForm(): void {
    this.formOpen.set(false);
    this.editingId.set(null);
  }

  protected async save(): Promise<void> {
    const name = this.draft.name.trim();
    if (!name) {
      this.status.set({ kind: 'error', message: 'Ponle un nombre a la cuenta.' });
      return;
    }
    const amount = parseMoneyInput(this.draft.amount, this.draft.currency);
    if (amount === null || amount <= 0n) {
      this.status.set({ kind: 'error', message: 'Escribe cuánto pagas más o menos al mes.' });
      return;
    }
    const dueDay = Number(this.draft.dueDay);
    if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) {
      this.status.set({ kind: 'error', message: 'El día de vencimiento va del 1 al 31.' });
      return;
    }
    const everyMonths = Number(this.draft.everyMonths) as BillEveryMonths;
    const payload: BillPayload = {
      name,
      kind: this.draft.kind,
      company: this.draft.company,
      amount: amount.toString(),
      currency: this.draft.currency,
      dueDay,
      everyMonths,
      // Mensual: desde este mes (o el que ya tenía). Bimestral/anual: el mes que eligió.
      startMonth: this.draft.startMonth || undefined,
      accountId: this.draft.accountId || null,
      autopay: this.draft.autopay,
      active: true,
      notes: this.draft.notes,
    };
    const editingId = this.editingId();
    await this.run(async () => {
      if (editingId) {
        const { active: _active, ...changes } = payload;
        await this.finance.updateBill(editingId, changes);
      } else {
        await this.finance.createBill(payload);
      }
      this.closeForm();
      await this.refresh();
    }, editingId ? 'Guardamos los cambios.' : `Agregamos ${name}: ya suma en tu gasto base.`);
  }

  protected async toggleActive(bill: Bill): Promise<void> {
    await this.run(async () => {
      await this.finance.updateBill(bill.id, { active: !bill.active });
      await this.refresh();
    }, bill.active ? `Pausamos ${bill.name}: ya no suma en el gasto base.` : `${bill.name} vuelve a sumar en el gasto base.`);
  }

  protected async remove(bill: Bill): Promise<void> {
    await this.run(async () => {
      await this.finance.deleteBill(bill.id);
      this.confirmDelete.set(null);
      this.expandedId.set(null);
      await this.refresh();
    }, `Borramos ${bill.name}.`);
  }

  /** Recarga el mes (los totales los calcula el servidor). */
  private async refresh(): Promise<void> {
    this.data.set(await this.finance.bills(this.month()));
  }

  private async run(action: () => Promise<void>, success: string): Promise<void> {
    this.busy.set(true);
    this.status.set(null);
    try {
      await action();
      this.status.set({ kind: 'success', message: success });
    } catch (error) {
      this.status.set({ kind: 'error', message: apiErrorMessage(error) });
    } finally {
      this.busy.set(false);
    }
  }

  private scrollToForm(): void {
    setTimeout(() => document.getElementById('form-cuenta-fija')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }
}
