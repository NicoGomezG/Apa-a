import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { moneyToInput, parseMoneyInput } from '../../core/format/format';
import { MoneyPipe } from '../../core/format/money.pipe';
import { apiErrorMessage } from '../../core/http-errors';
import { EmptyState } from '../../shared/ui/empty-state';
import {
  ACCOUNT_KIND_ICONS,
  ACCOUNT_KIND_LABELS,
  ACCOUNT_KINDS,
  CURRENCIES,
  missingPresets,
  type Account,
  type AccountPreset,
  type AccountKind,
  type AccountPayload,
} from './finance.models';
import { FinanceService } from './finance.service';

interface AccountDraft {
  name: string;
  kind: AccountKind;
  institution: string;
  last4: string;
  currency: string;
  creditLimit: string;
  billingDay: number | null;
  paymentDay: number | null;
}

const emptyDraft = (): AccountDraft => ({
  name: '',
  kind: 'checking',
  institution: '',
  last4: '',
  currency: 'CLP',
  creditLimit: '',
  billingDay: null,
  paymentDay: null,
});

@Component({
  selector: 'app-finanzas-cuentas',
  imports: [FormsModule, RouterLink, MoneyPipe, EmptyState],
  templateUrl: './cuentas.html',
  styles: `
    .account-icon {
      width: 2.5rem;
      height: 2.5rem;
      display: grid;
      place-items: center;
      border-radius: 0.6rem;
      background: var(--apana-section-color);
      color: #fff;
      flex-shrink: 0;
    }
  `,
})
export class FinanzasCuentas {
  private readonly finance = inject(FinanceService);

  protected readonly kinds = ACCOUNT_KINDS;
  protected readonly kindLabels = ACCOUNT_KIND_LABELS;
  protected readonly kindIcons = ACCOUNT_KIND_ICONS;
  protected readonly currencies = CURRENCIES;
  protected readonly days = Array.from({ length: 31 }, (_, index) => index + 1);

  protected readonly accounts = signal<Account[]>([]);
  protected readonly loading = signal(true);
  protected readonly status = signal<{ kind: 'success' | 'error'; message: string } | null>(null);
  protected readonly formOpen = signal(false);
  protected readonly editingId = signal<string | null>(null);
  protected readonly confirmDeleteId = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected draft: AccountDraft = emptyDraft();

  /** Lista base (CMR, Santander, MACH…) sin las que ya tienes. */
  protected readonly presets = computed(() => missingPresets(this.accounts()));

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      this.accounts.set(await this.finance.accounts());
    } catch (error) {
      this.status.set({ kind: 'error', message: apiErrorMessage(error, 'No pudimos cargar tus cuentas.') });
    } finally {
      this.loading.set(false);
    }
  }

  protected openNew(): void {
    this.draft = emptyDraft();
    this.editingId.set(null);
    this.formOpen.set(true);
  }

  /** Rellena el formulario con una cuenta de la lista base; luego puedes sumar dígitos, cupo y fechas. */
  protected usePreset(preset: AccountPreset): void {
    this.draft = { ...emptyDraft(), name: preset.name, kind: preset.kind, institution: preset.institution };
  }

  protected openEdit(account: Account): void {
    this.draft = {
      name: account.name,
      kind: account.kind,
      institution: account.institution ?? '',
      last4: account.last4 ?? '',
      currency: account.currency,
      creditLimit: account.creditLimit ? moneyToInput(account.creditLimit, account.currency) : '',
      billingDay: account.billingDay,
      paymentDay: account.paymentDay,
    };
    this.editingId.set(account.id);
    this.formOpen.set(true);
  }

  protected async save(): Promise<void> {
    const draft = this.draft;
    if (!draft.name.trim()) {
      this.status.set({ kind: 'error', message: 'Ponle un nombre a la cuenta.' });
      return;
    }
    if (draft.last4 && !/^\d{4}$/.test(draft.last4)) {
      this.status.set({ kind: 'error', message: 'Usa solo los últimos 4 dígitos.' });
      return;
    }
    const creditLimit = draft.creditLimit ? parseMoneyInput(draft.creditLimit, draft.currency) : null;
    if (draft.creditLimit && (creditLimit === null || creditLimit < 0n)) {
      this.status.set({ kind: 'error', message: 'El cupo no es un monto válido.' });
      return;
    }
    const isCard = draft.kind === 'credit_card';
    const payload: AccountPayload = {
      name: draft.name.trim(),
      kind: draft.kind,
      institution: draft.institution.trim() || null,
      last4: draft.last4 || null,
      creditLimit: isCard && creditLimit !== null ? String(creditLimit) : null,
      billingDay: isCard ? draft.billingDay : null,
      paymentDay: isCard ? draft.paymentDay : null,
    };

    this.saving.set(true);
    this.status.set(null);
    try {
      const id = this.editingId();
      if (id) {
        const updated = await this.finance.updateAccount(id, payload);
        this.accounts.update((list) => list.map((item) => (item.id === id ? updated : item)));
      } else {
        const created = await this.finance.createAccount({ ...payload, currency: draft.currency });
        this.accounts.update((list) => [...list, created]);
      }
      this.formOpen.set(false);
      this.status.set({ kind: 'success', message: 'Guardamos la cuenta.' });
    } catch (error) {
      this.status.set({ kind: 'error', message: apiErrorMessage(error) });
    } finally {
      this.saving.set(false);
    }
  }

  protected async remove(account: Account): Promise<void> {
    try {
      await this.finance.deleteAccount(account.id);
      this.accounts.update((list) => list.filter((item) => item.id !== account.id));
      this.confirmDeleteId.set(null);
      this.status.set({ kind: 'success', message: `Eliminamos "${account.name}" y sus movimientos.` });
    } catch (error) {
      this.status.set({ kind: 'error', message: apiErrorMessage(error) });
    }
  }
}
