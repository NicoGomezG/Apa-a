import { Component, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { NgbDropdownModule } from '@ng-bootstrap/ng-bootstrap';
import { filter } from 'rxjs';
import { AuthService } from '../core/auth/auth.service';
import { ProfileService } from '../core/profile/profile.service';
import { apiErrorMessage } from '../core/http-errors';
import { NAV_ITEMS, SETTINGS_ITEM } from './navigation';

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, NgbDropdownModule],
  templateUrl: './shell.html',
  styleUrl: './shell.scss',
})
export class Shell {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  protected readonly profile = inject(ProfileService);

  protected readonly navItems = NAV_ITEMS;
  protected readonly settingsItem = SETTINGS_ITEM;
  protected readonly mobileItems = NAV_ITEMS.filter((item) => item.mobile);
  protected readonly moreItems = [...NAV_ITEMS.filter((item) => !item.mobile), SETTINGS_ITEM];

  protected readonly moreOpen = signal(false);
  protected readonly loadError = signal<string | null>(null);
  protected readonly displayName = computed(() => this.profile.me()?.displayName ?? this.auth.email() ?? '');
  protected readonly initials = computed(() => {
    const source = this.profile.me()?.displayName ?? this.auth.email() ?? '?';
    return source
      .split(/[\s@.]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]!.toUpperCase())
      .join('');
  });

  constructor() {
    void this.loadProfile();
    this.router.events.pipe(filter((event) => event instanceof NavigationEnd)).subscribe(() => this.moreOpen.set(false));
  }

  protected async loadProfile(): Promise<void> {
    this.loadError.set(null);
    try {
      await this.profile.load();
    } catch (error) {
      this.loadError.set(apiErrorMessage(error, 'No pudimos cargar tu perfil.'));
    }
  }

  protected async signOut(): Promise<void> {
    await this.auth.signOut();
    this.profile.clear();
    await this.router.navigateByUrl('/auth/ingresar');
  }
}
