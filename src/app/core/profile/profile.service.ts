import { HttpClient } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment.generated';
import { DEFAULT_CURRENCY, DEFAULT_TIMEZONE } from '../format/format';

export interface Preferences {
  timezone: string;
  locale: string;
  currency: string;
}

export interface Me {
  id: string;
  email: string | null;
  displayName: string | null;
  createdAt: string;
  preferences: Preferences;
}

export const DELETE_CONFIRMATION = 'ELIMINAR MI CUENTA';

@Injectable({ providedIn: 'root' })
export class ProfileService {
  private readonly http = inject(HttpClient);
  private readonly api = environment.apiUrl;

  private readonly meState = signal<Me | null>(null);
  readonly me = this.meState.asReadonly();
  readonly timezone = computed(() => this.meState()?.preferences.timezone ?? DEFAULT_TIMEZONE);
  readonly currency = computed(() => this.meState()?.preferences.currency ?? DEFAULT_CURRENCY);
  readonly firstName = computed(() => this.meState()?.displayName?.split(' ')[0] ?? null);

  async load(): Promise<Me> {
    const me = await firstValueFrom(this.http.get<Me>(`${this.api}/me`));
    this.meState.set(me);
    return me;
  }

  async updateDisplayName(displayName: string): Promise<Me> {
    const me = await firstValueFrom(this.http.patch<Me>(`${this.api}/me`, { displayName }));
    this.meState.set(me);
    return me;
  }

  async updatePreferences(changes: Partial<Preferences>): Promise<Me> {
    const me = await firstValueFrom(this.http.patch<Me>(`${this.api}/me/preferences`, changes));
    this.meState.set(me);
    return me;
  }

  async downloadExport(): Promise<void> {
    const blob = await firstValueFrom(this.http.get(`${this.api}/me/export`, { responseType: 'blob' }));
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'apana-mis-datos.json';
    link.click();
    URL.revokeObjectURL(url);
  }

  async deleteAccount(): Promise<void> {
    await firstValueFrom(
      this.http.delete<void>(`${this.api}/me`, { body: { confirmation: DELETE_CONFIRMATION } }),
    );
    this.clear();
  }

  clear(): void {
    this.meState.set(null);
  }
}
