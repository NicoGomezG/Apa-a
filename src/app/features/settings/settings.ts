import { Component, effect, inject, signal, type WritableSignal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { apiErrorMessage } from '../../core/http-errors';
import { DELETE_CONFIRMATION, ProfileService } from '../../core/profile/profile.service';
import { PageHeader } from '../../shared/ui/page-header';

type Status = { kind: 'success' | 'error'; message: string } | null;
type SavingKey = 'profile' | 'preferences' | 'password' | 'export' | 'delete';

const CHILE_TIMEZONES = [
  { value: 'America/Santiago', label: 'Chile continental (Santiago)' },
  { value: 'America/Punta_Arenas', label: 'Magallanes (Punta Arenas)' },
  { value: 'Pacific/Easter', label: 'Isla de Pascua' },
];

@Component({
  selector: 'app-settings',
  imports: [FormsModule, PageHeader],
  templateUrl: './settings.html',
})
export class Settings {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  protected readonly profile = inject(ProfileService);

  protected readonly chileTimezones = CHILE_TIMEZONES;
  protected readonly otherTimezones = Intl.supportedValuesOf('timeZone').filter(
    (zone) => !CHILE_TIMEZONES.some((chile) => chile.value === zone),
  );
  protected readonly currencies = [
    { value: 'CLP', label: 'Peso chileno (CLP)' },
    { value: 'USD', label: 'Dólar estadounidense (USD)' },
    { value: 'EUR', label: 'Euro (EUR)' },
  ];
  protected readonly deletePhrase = DELETE_CONFIRMATION;

  protected displayName = '';
  protected timezone = '';
  protected currency = '';
  protected newPassword = '';
  protected deleteConfirmation = '';

  protected readonly saving = signal<SavingKey | null>(null);
  protected readonly profileStatus = signal<Status>(null);
  protected readonly preferencesStatus = signal<Status>(null);
  protected readonly passwordStatus = signal<Status>(null);
  protected readonly privacyStatus = signal<Status>(null);

  constructor() {
    effect(() => {
      const me = this.profile.me();
      if (!me) return;
      this.displayName = me.displayName ?? '';
      this.timezone = me.preferences.timezone;
      this.currency = me.preferences.currency;
    });
  }

  protected async saveProfile(): Promise<void> {
    await this.run('profile', this.profileStatus, async () => {
      await this.profile.updateDisplayName(this.displayName);
      return 'Guardamos tu nombre.';
    });
  }

  protected async savePreferences(): Promise<void> {
    await this.run('preferences', this.preferencesStatus, async () => {
      await this.profile.updatePreferences({ timezone: this.timezone, currency: this.currency });
      return 'Guardamos tus preferencias.';
    });
  }

  protected async changePassword(): Promise<void> {
    if (this.newPassword.length < 8) {
      this.passwordStatus.set({ kind: 'error', message: 'Usa al menos 8 caracteres.' });
      return;
    }
    this.saving.set('password');
    const result = await this.auth.updatePassword(this.newPassword);
    this.saving.set(null);
    this.passwordStatus.set(
      result.ok ? { kind: 'success', message: 'Actualizamos tu contraseña.' } : { kind: 'error', message: result.message },
    );
    if (result.ok) this.newPassword = '';
  }

  protected async exportData(): Promise<void> {
    await this.run('export', this.privacyStatus, async () => {
      await this.profile.downloadExport();
      return 'Descargamos tus datos en un archivo JSON.';
    });
  }

  protected async deleteAccount(): Promise<void> {
    if (this.deleteConfirmation !== DELETE_CONFIRMATION) return;
    this.saving.set('delete');
    try {
      await this.profile.deleteAccount();
      await this.auth.signOut();
      await this.router.navigate(['/auth/ingresar'], { queryParams: { cuenta: 'eliminada' } });
    } catch (error) {
      this.privacyStatus.set({ kind: 'error', message: apiErrorMessage(error) });
    } finally {
      this.saving.set(null);
    }
  }

  private async run(
    key: SavingKey,
    status: WritableSignal<Status>,
    action: () => Promise<string>,
  ): Promise<void> {
    this.saving.set(key);
    status.set(null);
    try {
      status.set({ kind: 'success', message: await action() });
    } catch (error) {
      status.set({ kind: 'error', message: apiErrorMessage(error) });
    } finally {
      this.saving.set(null);
    }
  }
}
