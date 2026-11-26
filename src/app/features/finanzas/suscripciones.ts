import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { addMonthsTo, formatDay, moneyToInput, parseMoneyInput, todayIn } from '../../core/format/format';
import { MoneyPipe } from '../../core/format/money.pipe';
import { apiErrorMessage } from '../../core/http-errors';
import { ProfileService } from '../../core/profile/profile.service';
import { EmptyState } from '../../shared/ui/empty-state';
import {
  CATEGORIES,
  categoryLabel,
  ACCOUNT_KIND_LABELS,
  ACCOUNT_PRESETS,
  CURRENCIES,
  missingPresets,
  presetPayload,
  type Account,
  type Category,
  type Frequency,
  type Subscription,
  type SubscriptionPayload,
} from './finance.models';
import { FinanceService } from './finance.service';

interface Draft {
  name: string;
  amount: string;
  currency: string;
  frequency: Frequency;
  startDate: string;
  accountId: string;
  category: Category | '';
  active: boolean;
  email: string;
  notes: string;
}

/** Valor del selector "Se paga con" para una cuenta de la lista base que aún no existe. */
const PRESET_PREFIX = 'preset:';

/** Próximo cobro en o después de `today` (el día se ajusta en meses cortos). */
export function nextCharge(startDate: string, frequency: Frequency, today: string): string {
  if (startDate >= today) return startDate;
  const day = Number(startDate.slice(8, 10));
  const step = frequency === 'yearly' ? 12 : 1;
  let month = startDate.slice(0, 7);
  for (let i = 0; i < 1200; i += 1) {
    month = addMonthsTo(month, step);
    const [y, m] = month.split('-').map(Number) as [number, number];
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const candidate = `${month}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
    if (candidate >= today) return candidate;
  }
  return startDate;
}

@Component({
  selector: 'app-finanzas-suscripciones',
  imports: [FormsModule, MoneyPipe, EmptyState],
  templateUrl: './suscripciones.html',
  styles: `
    .meta-icon {
      color: var(--apana-section-color);
    }
  `,
})
export class FinanzasSuscripciones {
  private readonly finance = inject(FinanceService);
  private readonly profile = inject(ProfileService);

  protected readonly categories = CATEGORIES;
  protected readonly categoryLabel = categoryLabel;
  protected readonly currencies = CURRENCIES;
  protected readonly formatDay = formatDay;
  protected readonly kindLabels = ACCOUNT_KIND_LABELS;
  protected readonly presetPrefix = PRESET_PREFIX;

  protected readonly subscriptions = signal<Subscription[]>([]);
  protected readonly accounts = signal<Account[]>([]);
  protected readonly loading = signal(true);
  protected readonly status = signal<{ kind: 'success' | 'error'; message: string } | null>(null);
  protected readonly formOpen = signal(false);
  protected readonly editingId = signal<string | null>(null);
  protected readonly confirmDeleteId = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected draft: Draft = this.emptyDraft();

  private readonly today = todayIn(this.profile.timezone());

  protected readonly rows = computed(() =>
    this.subscriptions()
      .map((sub) => ({ ...sub, next: nextCharge(sub.startDate, sub.frequency, this.today) }))
      .sort((a, b) => Number(b.active) - Number(a.active) || a.next.localeCompare(b.next)),
  );

  /** Total mensual por moneda (las anuales se prorratean en 12). */
  protected readonly monthlyTotals = computed(() => {
    const totals = new Map<string, bigint>();
    for (const sub of this.subscriptions()) {
      if (!sub.active) continue;
      const amount = BigInt(sub.amount);
      const monthly = sub.frequency === 'yearly' ? amount / 12n : amount;
      totals.set(sub.currency, (totals.get(sub.currency) ?? 0n) + monthly);
    }
    return [...totals].map(([currency, amount]) => ({ currency, amount }));
  });

  protected readonly accountName = computed(() => {
    const names = new Map(this.accounts().map((account) => [account.id, account.name]));
    return (id: string | null) => (id ? (names.get(id) ?? null) : null);
  });

  /** Tarjetas y cuentas de la lista base que todavía no tienes: se crean al guardar. */
  protected readonly presets = computed(() => missingPresets(this.accounts()));

  constructor() {
    void this.load();
  }

  private emptyDraft(): Draft {
    return {
      name: '',
      amount: '',
      currency: 'CLP',
      frequency: 'monthly',
      startDate: todayIn(this.profile.timezone()),
      accountId: '',
      category: 'suscripciones',
      active: true,
      email: '',
      notes: '',
    };
  }

  private async load(): Promise<void> {
    try {
      const [subscriptions, accounts] = await Promise.all([this.finance.subscriptions(), this.finance.accounts()]);
      this.subscriptions.set(subscriptions);
      this.accounts.set(accounts);
    } catch (error) {
      this.status.set({ kind: 'error', message: apiErrorMessage(error, 'No pudimos cargar tus suscripciones.') });
    } finally {
      this.loading.set(false);
    }
  }

  protected openNew(): void {
    this.draft = this.emptyDraft();
    this.editingId.set(null);
    this.formOpen.set(true);
  }

  protected openEdit(sub: Subscription): void {
    this.draft = {
      name: sub.name,
      amount: moneyToInput(sub.amount, sub.currency),
      currency: sub.currency,
      frequency: sub.frequency,
      startDate: sub.startDate,
      accountId: sub.accountId ?? '',
      category: sub.category ?? '',
      active: sub.active,
      email: sub.email ?? '',
      notes: sub.notes ?? '',
    };
    this.editingId.set(sub.id);
    this.formOpen.set(true);
  }

  protected async save(): Promise<void> {
    const draft = this.draft;
    const amount = parseMoneyInput(draft.amount, draft.currency);
    if (!draft.name.trim() || amount === null || amount <= 0n || !draft.startDate) {
      this.status.set({ kind: 'error', message: 'Completa nombre, monto y fecha de cobro.' });
      return;
    }
    const email = draft.email.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      this.status.set({ kind: 'error', message: 'Revisa el correo.' });
      return;
    }
    const payload: SubscriptionPayload = {
      name: draft.name.trim(),
      amount: String(amount),
      currency: draft.currency,
      frequency: draft.frequency,
      startDate: draft.startDate,
      accountId: draft.accountId || null,
      category: draft.category || null,
      active: draft.active,
      email: email || null,
      notes: draft.notes.trim() || null,
    };
    this.saving.set(true);
    this.status.set(null);
    try {
      payload.accountId = await this.resolveAccount(draft.accountId);
      draft.accountId = payload.accountId ?? '';
      const id = this.editingId();
      if (id) {
        const updated = await this.finance.updateSubscription(id, payload);
        this.subscriptions.update((list) => list.map((item) => (item.id === id ? updated : item)));
      } else {
        const created = await this.finance.createSubscription(payload);
        this.subscriptions.update((list) => [...list, created]);
      }
      this.formOpen.set(false);
      this.status.set({ kind: 'success', message: 'Guardamos la suscripción.' });
    } catch (error) {
      this.status.set({ kind: 'error', message: apiErrorMessage(error) });
    } finally {
      this.saving.set(false);
    }
  }

  /** Si eligió una cuenta de la lista base, la crea primero y devuelve su id. */
  private async resolveAccount(choice: string): Promise<string | null> {
    if (!choice.startsWith(PRESET_PREFIX)) return choice || null;
    const preset = ACCOUNT_PRESETS.find((item) => item.key === choice.slice(PRESET_PREFIX.length));
    if (!preset) return null;
    const created = await this.finance.createAccount(presetPayload(preset));
    this.accounts.update((list) => [...list, created]);
    return created.id;
  }

  protected async toggle(sub: Subscription): Promise<void> {
    try {
      const updated = await this.finance.updateSubscription(sub.id, { active: !sub.active });
      this.subscriptions.update((list) => list.map((item) => (item.id === sub.id ? updated : item)));
    } catch (error) {
      this.status.set({ kind: 'error', message: apiErrorMessage(error) });
    }
  }

  protected async remove(sub: Subscription): Promise<void> {
    try {
      await this.finance.deleteSubscription(sub.id);
      this.subscriptions.update((list) => list.filter((item) => item.id !== sub.id));
      this.confirmDeleteId.set(null);
    } catch (error) {
      this.status.set({ kind: 'error', message: apiErrorMessage(error) });
    }
  }
}
