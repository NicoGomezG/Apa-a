import { Component, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { environment } from '../../../environments/environment.generated';
import { safeRedirect } from '../../core/auth/auth.guards';
import { AuthService } from '../../core/auth/auth.service';

@Component({
  selector: 'app-login',
  imports: [FormsModule, RouterLink],
  template: `
    <main class="apana-auth-page">
      <div class="apana-auth-card">
        <div class="text-center mb-4">
          <a class="apana-brand" routerLink="/"><img src="favicon.svg" alt="" />Apaña</a>
          <p class="text-secondary mt-2 mb-0">Tu vida, más ordenada.</p>
        </div>

        <section class="apana-card p-4">
          <h1 class="h4 mb-3">Ingresa a tu cuenta</h1>

          @if (cuenta() === 'eliminada') {
            <div class="alert alert-success" role="status">Eliminamos tu cuenta y tus datos.</div>
          }
          @if (error(); as message) {
            <div class="alert alert-danger" role="alert">{{ message }}</div>
          }

          <form (ngSubmit)="submit()" class="d-grid gap-3">
            <div>
              <label class="form-label" for="email">Correo</label>
              <input id="email" name="email" type="email" class="form-control" autocomplete="email" required
                     [(ngModel)]="email" />
            </div>
            <div>
              <div class="d-flex justify-content-between align-items-baseline">
                <label class="form-label" for="password">Contraseña</label>
                <a class="small" routerLink="/auth/recuperar">¿La olvidaste?</a>
              </div>
              <input id="password" name="password" type="password" class="form-control" autocomplete="current-password"
                     required [(ngModel)]="password" />
            </div>
            <button class="btn btn-primary btn-lg" type="submit" [disabled]="loading()">
              {{ loading() ? 'Ingresando…' : 'Ingresar' }}
            </button>
          </form>

          @if (googleEnabled) {
            <div class="apana-divider my-3">o</div>
            <button class="btn btn-outline-primary w-100" type="button" (click)="google()" [disabled]="loading()">
              <i class="fa-brands fa-google me-2" aria-hidden="true"></i>Continuar con Google
            </button>
          }
        </section>

        <p class="text-center mt-3">¿No tienes cuenta? <a routerLink="/auth/registro">Créala gratis</a></p>
      </div>
    </main>
  `,
})
export class Login {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly volver = input<string>();
  readonly cuenta = input<string>();

  protected readonly googleEnabled = environment.googleAuthEnabled;
  protected email = '';
  protected password = '';
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  protected async submit(): Promise<void> {
    if (!this.email || !this.password) {
      this.error.set('Ingresa tu correo y tu contraseña.');
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    const result = await this.auth.signIn(this.email.trim(), this.password);
    this.loading.set(false);
    if (!result.ok) {
      this.error.set(result.message);
      return;
    }
    await this.router.navigateByUrl(safeRedirect(this.volver()));
  }

  protected async google(): Promise<void> {
    this.loading.set(true);
    const result = await this.auth.signInWithGoogle();
    if (!result.ok) {
      this.loading.set(false);
      this.error.set(result.message);
    }
  }
}
