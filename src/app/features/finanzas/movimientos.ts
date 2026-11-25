import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { formatDay, formatMonth, parseMoneyInput, todayIn } from '../../core/format/format';
import { MoneyPipe } from '../../core/format/money.pipe';
import { apiErrorMessage } from '../../core/http-errors';
import { ProfileService } from '../../core/profile/profile.service';
import { EmptyState } from '../../shared/ui/empty-state';
import {
  CATEGORIES,
  categoryIcon,
  categoryLabel,
  TRANSACTION_KIND_LABELS,
  TRANSACTION_KINDS,
  type Account,
  type Category,
  type InstallmentPlan,
  type Transaction,
  type TransactionKind,
} from './finance.models';
import { FinanceService } from './finance.service';
import { MonthPicker } from '../../shared/ui/month-picker';

type Direction = 'out' | 'in';

interface Draft {
  accountId: string;
  date: string;
  description: string;
  amount: string;
  kind: TransactionKind;
  direction: Direction;
  category: Category | '';
}

@Component({
  selector: 'app-finanzas-movimientos',
  imports: [FormsModule, RouterLink, MoneyPipe, MonthPicker, EmptyState],
  templateUrl: './movimientos.html',
  styles: `
    .tx-row {
      display: grid;
      grid-template-columns: 2.25rem minmax(0, 1fr) auto;
      gap: 0.75rem;
      align-items: center;
      padding: 0.65rem 0;
      border-bottom: 1px solid var(--bs-border-color);
    }
    .tx-row:last-child {
      border-bottom: 0;
    }
    .tx-icon {
      width: 2.25rem;
      height: 2.25rem;
      display: grid;
      place-items: center;
      border-radius: 0.5rem;
      background: var(--bs-light);
      color: var(--apana-section-color);
    }
    .progress {
      height: 0.45rem;
    }
    .progress-bar {
      background: var(--apana-section-color);
    }
  `,
})
export class FinanzasMovimientos {
  private readonly finance = inject(FinanceService);
  private readonly profile = inject(ProfileService);

  protected readonly categories = CATEGORIES;
  protected readonly kinds = TRANSACTION_KINDS;
  protected readonly kindLabels = TRANSACTION_KIND_LABELS;
  protected readonly categoryLabel = categoryLabel;
  protected readonly categoryIcon = categoryIcon;
  protected readonly formatDay = formatDay;
  protected readonly formatMonth = formatMonth;

  protected readonly month = signal(todayIn(this.profile.timezone()).slice(0, 7));
  protected readonly accountFilter = signal('');
  protected readonly accounts = signal<Account[]>([]);
  protected readonly transactions = signal<Transaction[]>([]);
  protected readonly plans = signal<InstallmentPlan[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly status = signal<string | null>(null);

  protected readonly showForm = signal(false);
  protected readonly saving = signal(false);
  protected draft: Draft = this.emptyDraft();

  protected readonly editingId = signal<string | null>(null);
  protected edit: { description: string; kind: TransactionKind; category: Category | '' } = {
    description: '',
    kind: 'expense',
    category: '',
  };
  protected readonly confirmDeleteId = signal<string | null>(null);

  protected readonly accountById = computed(() => new Map(this.accounts().map((account) => [account.id, account])));

  protected readonly totals = computed(() => {
    let spent = 0n;
    let income = 0n;
    for (const tx of this.transactions()) {
      if (tx.kind === 'expense') spent -= BigInt(tx.amount);
      if (tx.kind === 'income') income += BigInt(tx.amount);
    }
    return { spent, income, hasIncome: income > 0n };
  });

  protected readonly activePlans = computed(() => this.plans().filter((plan) => !plan.status.finished));
  protected readonly finishedPlans = computed(() => this.plans().filter((plan) => plan.status.finished));

  constructor() {
    effect(() => {
      void this.loadTransactions(this.month(), this.accountFilter());
    });
    void this.loadStatic();
  }

  private emptyDraft(): Draft {
    return {
      accountId: this.accounts?.()[0]?.id ?? '',
      date: todayIn(this.profile.timezone()),
      description: '',
      amount: '',
      kind: 'expense',
      direction: 'out',
      category: '',
    };
  }

  private async loadStatic(): Promise<void> {
    try {
      const [accounts, plans] = await Promise.all([this.finance.accounts(), this.finance.installments()]);
      this.accounts.set(accounts);
      this.plans.set(plans);
      if (!this.draft.accountId) this.draft.accountId = accounts[0]?.id ?? '';
    } catch (error) {
      this.error.set(apiErrorMessage(error, 'No pudimos cargar tus cuentas.'));
    }
  }

  private async loadTransactions(month: string, accountId: string): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const result = await this.finance.transactions(month, accountId || undefined);
      this.transactions.set(result.transactions);
    } catch (error) {
      this.error.set(apiErrorMessage(error, 'No pudimos cargar tus movimientos.'));
    } finally {
      this.loading.set(false);
    }
  }

  protected currencyOf(accountId: string): string {
    return this.accountById().get(accountId)?.currency ?? 'CLP';
  }

  protected isIncoming(tx: Transaction): boolean {
    return BigInt(tx.amount) > 0n;
  }

  protected async create(): Promise<void> {
    const currency = this.currencyOf(this.draft.accountId);
    const value = parseMoneyInput(this.draft.amount, currency);
    if (!this.draft.accountId || !this.draft.description.trim() || value === null || value === 0n) {
      this.status.set('Completa cuenta, descripción y un monto válido.');
      return;
    }
    const abs = value < 0n ? -value : value;
    const outgoing =
      this.draft.kind === 'expense' || ((this.draft.kind === 'transfer' || this.draft.kind === 'card_payment') && this.draft.direction === 'out');
    this.saving.set(true);
    this.status.set(null);
    try {
      await this.finance.createTransaction({
        accountId: this.draft.accountId,
        date: this.draft.date,
        description: this.draft.description.trim(),
        amount: String(outgoing ? -abs : abs),
        kind: this.draft.kind,
        category: this.draft.category || (this.draft.kind === 'income' ? 'ingresos' : null),
      });
      const { accountId: keepAccount, date: savedDate } = this.draft;
      this.draft = { ...this.emptyDraft(), accountId: keepAccount };
      this.showForm.set(false);
      this.status.set('Guardamos el movimiento.');
      if (savedDate.slice(0, 7) !== this.month()) {
        this.month.set(savedDate.slice(0, 7));
        return;
      }
      await this.loadTransactions(this.month(), this.accountFilter());
    } catch (error) {
      this.status.set(apiErrorMessage(error));
    } finally {
      this.saving.set(false);
    }
  }

  protected startEdit(tx: Transaction): void {
    this.confirmDeleteId.set(null);
    this.edit = { description: tx.description, kind: tx.kind, category: tx.category ?? '' };
    this.editingId.set(tx.id);
  }

  protected async saveEdit(tx: Transaction): Promise<void> {
    try {
      const updated = await this.finance.updateTransaction(tx.id, {
        description: this.edit.description.trim() || tx.description,
        kind: this.edit.kind,
        category: this.edit.category || null,
      });
      this.transactions.update((list) => list.map((item) => (item.id === tx.id ? updated : item)));
      this.editingId.set(null);
    } catch (error) {
      this.status.set(apiErrorMessage(error));
    }
  }

  protected async remove(tx: Transaction): Promise<void> {
    try {
      await this.finance.deleteTransaction(tx.id);
      this.transactions.update((list) => list.filter((item) => item.id !== tx.id));
      this.confirmDeleteId.set(null);
      this.editingId.set(null);
    } catch (error) {
      this.status.set(apiErrorMessage(error));
    }
  }

  protected async setPlanCategory(plan: InstallmentPlan, category: string): Promise<void> {
    try {
      const updated = await this.finance.updateInstallment(plan.id, { category: category || null });
      this.plans.update((list) => list.map((item) => (item.id === plan.id ? updated : item)));
    } catch (error) {
      this.status.set(apiErrorMessage(error));
    }
  }

  protected async removePlan(plan: InstallmentPlan): Promise<void> {
    try {
      await this.finance.deleteInstallment(plan.id);
      this.plans.update((list) => list.filter((item) => item.id !== plan.id));
      this.confirmDeleteId.set(null);
    } catch (error) {
      this.status.set(apiErrorMessage(error));
    }
  }

  protected planProgress(plan: InstallmentPlan): number {
    return Math.round((plan.status.paidCount / plan.installmentCount) * 100);
  }
}
