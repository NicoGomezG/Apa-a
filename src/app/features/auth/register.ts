import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { environment } from '../../../environments/environment.generated';
import { AuthService } from '../../core/auth/auth.service';

@Component({
  selector: 'app-register',
  imports: [FormsModule, RouterLink],
  template: `
    <main class="apana-auth-page">
      <div class="apana-auth-card">
        <div class="text-center mb-4">
          <a class="apana-brand" routerLink="/"><img src="favicon.svg" alt="" />Apaña</a>
          <p class="text-secondary mt-2 mb-0">La app que te apaña con todo.</p>
        </div>

        <section class="apana-card p-4">
          @if (sent()) {
            <h1 class="h4">Revisa tu correo</h1>
            <p class="mb-0">
              Si <strong>{{ email }}</strong> no tenía cuenta, te enviamos un enlace para confirmarla.
              Ábrelo desde este mismo dispositivo.
            </p>
          } @else {
            <h1 class="h4 mb-3">Crea tu cuenta</h1>
            @if (error(); as message) {
              <div class="alert alert-danger" role="alert">{{ message }}</div>
            }
            <form (ngSubmit)="submit()" class="d-grid gap-3">
              <div>
                <label class="form-label" for="name">Nombre</label>
                <input id="name" name="name" class="form-control" autocomplete="name" maxlength="80" required
                       [(ngModel)]="name" />
              </div>
              <div>
                <label class="form-label" for="email">Correo</label>
                <input id="email" name="email" type="email" class="form-control" autocomplete="email" required
                       [(ngModel)]="email" />
              </div>
              <div>
                <label class="form-label" for="password">Contraseña</label>
                <input id="password" name="password" type="password" class="form-control" autocomplete="new-password"
                       minlength="8" required [(ngModel)]="password" />
                <div class="form-text">Mínimo 8 caracteres.</div>
              </div>
              <button class="btn btn-primary btn-lg" type="submit" [disabled]="loading()">
                {{ loading() ? 'Creando…' : 'Crear cuenta' }}
              </button>
            </form>

            @if (googleEnabled) {
              <div class="apana-divider my-3">o</div>
              <button class="btn btn-outline-primary w-100" type="button" (click)="google()" [disabled]="loading()">
                <i class="fa-brands fa-google me-2" aria-hidden="true"></i>Continuar con Google
              </button>
            }
          }
        </section>

        <p class="text-center mt-3">¿Ya tienes cuenta? <a routerLink="/auth/ingresar">Ingresa</a></p>
      </div>
    </main>
  `,
})
export class Register {
  private readonly auth = inject(AuthService);

  protected readonly googleEnabled = environment.googleAuthEnabled;
  protected name = '';
  protected email = '';
  protected password = '';
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly sent = signal(false);

  protected async submit(): Promise<void> {
    if (!this.name.trim() || !this.email.trim()) {
      this.error.set('Completa tu nombre y tu correo.');
      return;
    }
    if (this.password.length < 8) {
      this.error.set('La contraseña debe tener al menos 8 caracteres.');
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    const result = await this.auth.signUp(this.email.trim(), this.password, this.name.trim());
    this.loading.set(false);
    if (result.ok) {
      // Mismo mensaje exista o no la cuenta: no revelamos qué correos están registrados.
      this.sent.set(true);
    } else {
      this.error.set(result.message);
    }
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
