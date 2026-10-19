import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';

/** Destino del enlace de recuperación. Supabase abre una sesión temporal al llegar acá. */
@Component({
  selector: 'app-new-password',
  imports: [FormsModule, RouterLink],
  template: `
    <main class="apana-auth-page">
      <div class="apana-auth-card">
        <section class="apana-card p-4">
          @if (!auth.initialized()) {
            <div class="text-center"><div class="spinner-border text-primary" role="status"><span class="visually-hidden">Cargando…</span></div></div>
          } @else if (!auth.isAuthenticated()) {
            <h1 class="h4">El enlace no es válido</h1>
            <p>Puede que haya expirado o que ya lo hayas usado.</p>
            <a class="btn btn-primary" routerLink="/auth/recuperar">Pedir uno nuevo</a>
          } @else {
            <h1 class="h4 mb-3">Crea una nueva contraseña</h1>
            @if (error(); as message) {
              <div class="alert alert-danger" role="alert">{{ message }}</div>
            }
            <form (ngSubmit)="submit()" class="d-grid gap-3">
              <div>
                <label class="form-label" for="password">Nueva contraseña</label>
                <input id="password" name="password" type="password" class="form-control" autocomplete="new-password"
                       minlength="8" required [(ngModel)]="password" />
                <div class="form-text">Mínimo 8 caracteres.</div>
              </div>
              <button class="btn btn-primary" type="submit" [disabled]="loading()">Guardar contraseña</button>
            </form>
          }
        </section>
      </div>
    </main>
  `,
})
export class NewPassword {
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected password = '';
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  protected async submit(): Promise<void> {
    if (this.password.length < 8) {
      this.error.set('La contraseña debe tener al menos 8 caracteres.');
      return;
    }
    this.loading.set(true);
    const result = await this.auth.updatePassword(this.password);
    this.loading.set(false);
    if (!result.ok) {
      this.error.set(result.message);
      return;
    }
    await this.router.navigateByUrl('/');
  }
}
