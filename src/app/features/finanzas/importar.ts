import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { formatDay, formatMonth } from '../../core/format/format';
import { MoneyPipe } from '../../core/format/money.pipe';
import { apiErrorMessage } from '../../core/http-errors';
import {
  CATEGORIES,
  categoryLabel,
  TRANSACTION_KIND_LABELS,
  TRANSACTION_KINDS,
  type Account,
  type Category,
  type ImportResult,
  type TransactionKind,
} from './finance.models';
import { FinanceService } from './finance.service';
import { ImportError, type ParsedImport, type ParsedInstallment, type ParsedMovement } from './import/import.types';
import { PdfPasswordError, readImportFile } from './import/read-file';
import { futureInstallments, verifyTotal, verifyUpcoming } from './import/verify';

type Step = 'select' | 'reading' | 'password' | 'preview' | 'saving' | 'done';

interface MovementRow extends Omit<ParsedMovement, 'category'> {
  include: boolean;
  category: Category | '';
}

interface InstallmentRow extends Omit<ParsedInstallment, 'category'> {
  include: boolean;
  category: Category | '';
  schedule: { number: number; month: string; amount: bigint }[];
}

const NEW_ACCOUNT = '__new__';

const SOURCE_LABELS: Record<ParsedImport['source'], string> = {
  'banco-chile-cartola': 'Cartola de cuenta corriente · Banco de Chile',
  'cmr-falabella': 'Estado de cuenta · CMR Falabella',
  'santander-tarjeta': 'Estado de cuenta · Tarjeta Santander',
};

@Component({
  selector: 'app-finanzas-importar',
  imports: [FormsModule, RouterLink, MoneyPipe],
  templateUrl: './importar.html',
  styles: `
    .drop {
      border: 2px dashed var(--bs-border-color);
      border-radius: 0.75rem;
      padding: 2rem 1rem;
      text-align: center;
      background: var(--bs-body-bg);
    }
    .drop.over {
      border-color: var(--apana-section-color);
    }
    .drop i {
      font-size: 2rem;
      color: var(--apana-section-color);
    }
    .preview-table td,
    .preview-table th {
      white-space: nowrap;
      vertical-align: middle;
    }
    .preview-table .desc {
      white-space: normal;
      min-width: 12rem;
    }
    .preview-table select {
      min-width: 9rem;
    }
  `,
})
export class FinanzasImportar {
  private readonly finance = inject(FinanceService);

  protected readonly kinds = TRANSACTION_KINDS;
  protected readonly kindLabels = TRANSACTION_KIND_LABELS;
  protected readonly categories = CATEGORIES;
  protected readonly categoryLabel = categoryLabel;
  protected readonly formatDay = formatDay;
  protected readonly formatMonth = formatMonth;
  protected readonly sourceLabels = SOURCE_LABELS;
  protected readonly newAccount = NEW_ACCOUNT;

  protected readonly step = signal<Step>('select');
  protected readonly error = signal<string | null>(null);
  protected readonly dragging = signal(false);
  protected readonly parsed = signal<ParsedImport | null>(null);
  protected readonly accounts = signal<Account[]>([]);
  protected readonly result = signal<ImportResult | null>(null);
  protected readonly importedAccountName = signal('');

  protected movements: MovementRow[] = [];
  protected installments: InstallmentRow[] = [];
  protected accountChoice = NEW_ACCOUNT;
  protected newAccountName = '';
  protected password = '';
  private file: File | null = null;

  protected readonly upcomingCheck = computed(() => {
    const parsed = this.parsed();
    return parsed ? verifyUpcoming(parsed) : [];
  });
  protected readonly totalCheck = computed(() => {
    const parsed = this.parsed();
    return parsed ? verifyTotal(parsed) : null;
  });
  protected readonly upcomingOk = computed(() => this.upcomingCheck().every((check) => check.matches));

  /** Cuentas compatibles con el archivo (mismo tipo). */
  protected readonly compatibleAccounts = computed(() => {
    const parsed = this.parsed();
    if (!parsed) return [];
    return this.accounts().filter((account) => account.kind === parsed.accountKind && account.currency === parsed.currency);
  });

  constructor() {
    void this.finance
      .accounts()
      .then((accounts) => this.accounts.set(accounts))
      .catch(() => undefined);
  }

  protected onDrag(event: DragEvent, over: boolean): void {
    event.preventDefault();
    this.dragging.set(over);
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) void this.read(file);
  }

  protected onFileInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) void this.read(file);
  }

  protected async submitPassword(): Promise<void> {
    if (this.file && this.password) await this.read(this.file, this.password);
  }

  private async read(file: File, password?: string): Promise<void> {
    this.file = file;
    this.error.set(null);
    this.step.set('reading');
    try {
      const parsed = await readImportFile(file, password);
      this.password = '';
      this.preparePreview(parsed);
      this.step.set('preview');
    } catch (error) {
      if (error instanceof PdfPasswordError) {
        this.error.set(error.incorrect ? error.message : null);
        this.step.set('password');
        return;
      }
      this.error.set(error instanceof ImportError ? error.message : 'No pudimos leer el archivo.');
      this.step.set('select');
    }
  }

  private preparePreview(parsed: ParsedImport): void {
    this.parsed.set(parsed);
    this.movements = parsed.movements.map((movement) => ({
      ...movement,
      include: true,
      category: movement.category ?? '',
    }));
    this.installments = parsed.installments.map((item) => ({
      ...item,
      include: true,
      category: item.category ?? '',
      schedule: futureInstallments(item),
    }));

    // Si ya existe una cuenta del mismo tipo y con los mismos 4 dígitos, se usa esa.
    const match = this.accounts().find(
      (account) => account.kind === parsed.accountKind && parsed.last4 !== null && account.last4 === parsed.last4,
    );
    this.accountChoice = match?.id ?? NEW_ACCOUNT;
    this.newAccountName = parsed.suggestedName;
  }

  protected includedCount(): { movements: number; installments: number } {
    return {
      movements: this.movements.filter((row) => row.include).length,
      installments: this.installments.filter((row) => row.include).length,
    };
  }

  protected setAll(include: boolean): void {
    for (const row of this.movements) row.include = include;
  }

  protected reset(): void {
    this.parsed.set(null);
    this.movements = [];
    this.installments = [];
    this.result.set(null);
    this.error.set(null);
    this.step.set('select');
  }

  protected async confirm(): Promise<void> {
    const parsed = this.parsed();
    if (!parsed) return;
    this.step.set('saving');
    this.error.set(null);
    try {
      let accountId = this.accountChoice;
      let accountName = this.accounts().find((account) => account.id === accountId)?.name ?? '';
      if (accountId === NEW_ACCOUNT) {
        const statement = parsed.statement;
        const created = await this.finance.createAccount({
          name: this.newAccountName.trim() || parsed.suggestedName,
          kind: parsed.accountKind,
          institution: parsed.institution,
          last4: parsed.last4,
          currency: parsed.currency,
          creditLimit: parsed.creditLimit !== null ? String(parsed.creditLimit) : null,
          billingDay: statement ? Number(statement.periodEnd.slice(8, 10)) : null,
          paymentDay: statement ? Number(statement.dueDate.slice(8, 10)) : null,
        });
        this.accounts.update((list) => [...list, created]);
        this.accountChoice = created.id;
        accountId = created.id;
        accountName = created.name;
      }

      const statement = parsed.statement;
      const result = await this.finance.import({
        accountId,
        movements: this.movements
          .filter((row) => row.include)
          .map((row) => ({
            date: row.date,
            description: row.description,
            amount: String(row.amount),
            kind: row.kind as TransactionKind,
            category: row.category || null,
          })),
        installments: this.installments
          .filter((row) => row.include)
          .map((row) => ({
            description: row.description,
            purchaseDate: row.purchaseDate,
            originalAmount: String(row.originalAmount),
            totalAmount: String(row.totalAmount),
            installmentCount: row.installmentCount,
            installmentAmount: String(row.installmentAmount),
            currentNumber: row.currentNumber,
            currentDueMonth: row.currentDueMonth,
            category: row.category || null,
          })),
        statement: statement
          ? {
              periodStart: statement.periodStart,
              periodEnd: statement.periodEnd,
              dueDate: statement.dueDate,
              totalBilled: String(statement.totalBilled),
              minimumPayment: String(statement.minimumPayment),
            }
          : null,
      });
      this.importedAccountName.set(accountName);
      this.result.set(result);
      this.step.set('done');
    } catch (error) {
      this.error.set(apiErrorMessage(error, 'No pudimos guardar la importación.'));
      this.step.set('preview');
    }
  }
}
