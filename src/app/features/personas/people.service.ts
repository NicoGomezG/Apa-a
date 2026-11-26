import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment.generated';
import type {
  Contact,
  ContactPayload,
  Expense,
  ExpensePayload,
  GroupDetail,
  GroupInfo,
  GroupSummary,
  Participant,
  PublicGroup,
  Settlement,
} from './people.models';

@Injectable({ providedIn: 'root' })
export class PeopleService {
  private readonly http = inject(HttpClient);
  private readonly api = `${environment.apiUrl}/people`;

  private get<T>(path: string) {
    return firstValueFrom(this.http.get<T>(`${this.api}${path}`));
  }
  private post<T>(path: string, body: object = {}) {
    return firstValueFrom(this.http.post<T>(`${this.api}${path}`, body));
  }
  private patch<T>(path: string, body: object) {
    return firstValueFrom(this.http.patch<T>(`${this.api}${path}`, body));
  }
  private delete(path: string) {
    return firstValueFrom(this.http.delete<void>(`${this.api}${path}`));
  }

  // --- Contactos ---
  contacts() {
    return this.get<Contact[]>('/contacts');
  }
  createContact(payload: ContactPayload) {
    return this.post<Contact>('/contacts', payload);
  }
  updateContact(id: string, payload: Partial<ContactPayload>) {
    return this.patch<Contact>(`/contacts/${id}`, payload);
  }
  deleteContact(id: string) {
    return this.delete(`/contacts/${id}`);
  }

  // --- Grupos ---
  groups() {
    return this.get<GroupSummary[]>('/groups');
  }
  group(id: string) {
    return this.get<GroupDetail>(`/groups/${id}`);
  }
  createGroup(payload: { name: string; date: string | null; participants: { name: string; contactId: string | null }[] }) {
    return this.post<GroupDetail>('/groups', payload);
  }
  updateGroup(id: string, payload: { name?: string; date?: string | null }) {
    return this.patch<GroupInfo>(`/groups/${id}`, payload);
  }
  deleteGroup(id: string) {
    return this.delete(`/groups/${id}`);
  }
  enableShare(id: string) {
    return this.post<{ token: string }>(`/groups/${id}/share`);
  }
  disableShare(id: string) {
    return this.delete(`/groups/${id}/share`);
  }

  // --- Participantes ---
  addParticipant(groupId: string, payload: { name: string; contactId: string | null }) {
    return this.post<Participant>(`/groups/${groupId}/participants`, payload);
  }
  removeParticipant(groupId: string, id: string) {
    return this.delete(`/groups/${groupId}/participants/${id}`);
  }

  // --- Gastos ---
  createExpense(groupId: string, payload: ExpensePayload) {
    return this.post<Expense>(`/groups/${groupId}/expenses`, payload);
  }
  updateExpense(groupId: string, id: string, payload: ExpensePayload) {
    return firstValueFrom(this.http.put<Expense>(`${this.api}/groups/${groupId}/expenses/${id}`, payload));
  }
  deleteExpense(groupId: string, id: string) {
    return this.delete(`/groups/${groupId}/expenses/${id}`);
  }

  // --- Pagos ---
  createSettlement(groupId: string, payload: { fromId: string; toId: string; amount: string; date: string }) {
    return this.post<Settlement>(`/groups/${groupId}/settlements`, payload);
  }
  deleteSettlement(groupId: string, id: string) {
    return this.delete(`/groups/${groupId}/settlements/${id}`);
  }

  // --- Enlace público (sin sesión) ---
  publicGroup(token: string) {
    return firstValueFrom(this.http.get<PublicGroup>(`${environment.apiUrl}/public/splits/${token}`));
  }
}
