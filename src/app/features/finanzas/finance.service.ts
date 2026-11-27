import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment.generated';
import type {
  Debt,
  DebtPayload,
  ExchangeRate,
  Account,
  AccountPayload,
  FinanceCalendar,
  FinanceSummary,
  ImportPayload,
  ImportResult,
  InstallmentPlan,
  Subscription,
  SubscriptionPayload,
  Transaction,
  TransactionPayload,
} from './finance.models';

@Injectable({ providedIn: 'root' })
export class FinanceService {
  private readonly http = inject(HttpClient);
  private readonly api = `${environment.apiUrl}/finance`;

  private get<T>(path: string, params?: Record<string, string | undefined>): Promise<T> {
    let httpParams = new HttpParams();
    for (const [key, value] of Object.entries(params ?? {})) {
      if (value) httpParams = httpParams.set(key, value);
    }
    return firstValueFrom(this.http.get<T>(`${this.api}${path}`, { params: httpParams }));
  }

  calendar(month?: string) {
    return this.get<FinanceCalendar>('/calendar', { month });
  }

  summary(month?: string) {
    return this.get<FinanceSummary>('/summary', { month });
  }

  /** Dólar y euro observados (pesos por unidad × 1.000.000). */
  exchangeRates() {
    return this.get<{ rates: ExchangeRate[] }>('/exchange-rates', {});
  }

  // --- Cuentas ---
  accounts() {
    return this.get<Account[]>('/accounts');
  }
  createAccount(payload: AccountPayload) {
    return firstValueFrom(this.http.post<Account>(`${this.api}/accounts`, payload));
  }
  updateAccount(id: string, payload: Partial<AccountPayload>) {
    return firstValueFrom(this.http.patch<Account>(`${this.api}/accounts/${id}`, payload));
  }
  deleteAccount(id: string) {
    return firstValueFrom(this.http.delete<void>(`${this.api}/accounts/${id}`));
  }

  // --- Movimientos ---
  transactions(month?: string, accountId?: string) {
    return this.get<{ month: string; transactions: Transaction[] }>('/transactions', { month, accountId });
  }
  createTransaction(payload: TransactionPayload) {
    return firstValueFrom(this.http.post<Transaction>(`${this.api}/transactions`, payload));
  }
  updateTransaction(id: string, payload: Partial<Omit<TransactionPayload, 'accountId'>>) {
    return firstValueFrom(this.http.patch<Transaction>(`${this.api}/transactions/${id}`, payload));
  }
  deleteTransaction(id: string) {
    return firstValueFrom(this.http.delete<void>(`${this.api}/transactions/${id}`));
  }

  // --- Cuotas ---
  installments() {
    return this.get<InstallmentPlan[]>('/installments');
  }
  updateInstallment(id: string, payload: { description?: string; category?: string | null }) {
    return firstValueFrom(this.http.patch<InstallmentPlan>(`${this.api}/installments/${id}`, payload));
  }
  deleteInstallment(id: string) {
    return firstValueFrom(this.http.delete<void>(`${this.api}/installments/${id}`));
  }

  // --- Suscripciones ---
  subscriptions() {
    return this.get<Subscription[]>('/subscriptions');
  }
  createSubscription(payload: SubscriptionPayload) {
    return firstValueFrom(this.http.post<Subscription>(`${this.api}/subscriptions`, payload));
  }
  updateSubscription(id: string, payload: Partial<SubscriptionPayload>) {
    return firstValueFrom(this.http.patch<Subscription>(`${this.api}/subscriptions/${id}`, payload));
  }
  deleteSubscription(id: string) {
    return firstValueFrom(this.http.delete<void>(`${this.api}/subscriptions/${id}`));
  }

  // --- Deudas ---
  debts() {
    return this.get<Debt[]>('/debts');
  }
  createDebt(payload: DebtPayload) {
    return firstValueFrom(this.http.post<Debt>(`${this.api}/debts`, payload));
  }
  updateDebt(id: string, payload: Partial<Omit<DebtPayload, 'direction' | 'currency'>>) {
    return firstValueFrom(this.http.patch<Debt>(`${this.api}/debts/${id}`, payload));
  }
  deleteDebt(id: string) {
    return firstValueFrom(this.http.delete<void>(`${this.api}/debts/${id}`));
  }
  addDebtPayment(id: string, payload: { amount: string; date: string }) {
    return firstValueFrom(this.http.post<Debt>(`${this.api}/debts/${id}/payments`, payload));
  }
  deleteDebtPayment(id: string, paymentId: string) {
    return firstValueFrom(this.http.delete<Debt>(`${this.api}/debts/${id}/payments/${paymentId}`));
  }

  // --- Importación ---
  import(payload: ImportPayload) {
    return firstValueFrom(this.http.post<ImportResult>(`${this.api}/imports`, payload));
  }
}
