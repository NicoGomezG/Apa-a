import { Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { formatDay, formatMonth, todayIn } from '../../core/format/format';
import { MoneyPipe } from '../../core/format/money.pipe';
import { apiErrorMessage } from '../../core/http-errors';
import { ProfileService } from '../../core/profile/profile.service';
import { EmptyState } from '../../shared/ui/empty-state';
import { categoryIcon, categoryLabel, type Account, type FinanceSummary } from './finance.models';
import { FinanceService } from './finance.service';
import { MonthPicker } from '../../shared/ui/month-picker';

@Component({
  selector: 'app-finanzas-resumen',
  imports: [RouterLink, MoneyPipe, MonthPicker, EmptyState],
  templateUrl: './resumen.html',
  styles: `
    .big-number {
      font-size: clamp(1.75rem, 4vw, 2.25rem);
      font-weight: 800;
      line-height: 1.1;
    }
    .bar {
      height: 0.5rem;
      border-radius: 999px;
      background: var(--bs-border-color);
      overflow: hidden;
    }
    .bar > span {
      display: block;
      height: 100%;
      background: var(--apana-section-color);
    }
    .category-icon {
      width: 2rem;
      height: 2rem;
      display: grid;
      place-items: center;
      border-radius: 0.5rem;
      background: var(--bs-light);
      color: var(--apana-section-color);
      flex-shrink: 0;
    }
  `,
})
export class FinanzasResumen {
  private readonly finance = inject(FinanceService);
  private readonly profile = inject(ProfileService);

  protected readonly month = signal(todayIn(this.profile.timezone()).slice(0, 7));
  protected readonly summary = signal<FinanceSummary | null>(null);
  protected readonly accounts = signal<Account[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  protected readonly categoryLabel = categoryLabel;
  protected readonly categoryIcon = categoryIcon;
  protected readonly formatDay = formatDay;
  protected readonly formatMonth = formatMonth;

  protected readonly isEmpty = computed(() => {
    const summary = this.summary();
    return this.accounts().length === 0 && summary !== null && summary.base.every((row) => row.total === '0');
  });

  protected readonly categories = computed(() => {
    const summary = this.summary();
    if (!summary) return [];
    const total = BigInt(summary.spent.total);
    return summary.spent.byCategory
      .filter((item) => BigInt(item.amount) > 0n)
      .map((item) => ({
        ...item,
        percent: total > 0n ? Number((BigInt(item.amount) * 1000n) / total) / 10 : 0,
      }));
  });

  protected readonly accountName = computed(() => {
    const names = new Map(this.accounts().map((account) => [account.id, account.name]));
    return (id: string | null) => (id ? (names.get(id) ?? '') : '');
  });

  constructor() {
    effect(() => {
      void this.load(this.month());
    });
  }

  private async load(month: string): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const [summary, accounts] = await Promise.all([this.finance.summary(month), this.finance.accounts()]);
      this.summary.set(summary);
      this.accounts.set(accounts);
    } catch (error) {
      this.error.set(apiErrorMessage(error, 'No pudimos cargar tu resumen.'));
    } finally {
      this.loading.set(false);
    }
  }

  protected isPositive(amount: string): boolean {
    return BigInt(amount) > 0n;
  }
}
