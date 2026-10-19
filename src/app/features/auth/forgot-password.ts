import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';

@Component({
  selector: 'app-forgot-password',
  imports: [FormsModule, RouterLink],
  template: `
    <main class="apana-auth-page">
      <div class="apana-auth-card">
        <section class="apana-card p-4">
          @if (sent()) {
            <h1 class="h4">Revisa tu correo</h1>
            <p class="mb-0">
              Si existe una cuenta con <strong>{{ email }}</strong>, te llegará un enlace para crear una nueva contraseña.
            </p>
          } @else {
            <h1 class="h4">Recupera tu contraseña</h1>
            <p class="text-secondary">Te enviaremos un enlace a tu correo.</p>
            @if (error(); as message) {
              <div class="alert alert-danger" role="alert">{{ message }}</div>
            }
            <form (ngSubmit)="submit()" class="d-grid gap-3">
              <div>
                <label class="form-label" for="email">Correo</label>
                <input id="email" name="email" type="email" class="form-control" autocomplete="email" required
                       [(ngModel)]="email" />
              </div>
              <button class="btn btn-primary" type="submit" [disabled]="loading()">Enviar enlace</button>
            </form>
          }
        </section>
        <p class="text-center mt-3"><a routerLink="/auth/ingresar">Volver a ingresar</a></p>
      </div>
    </main>
  `,
})
export class ForgotPassword {
  private readonly auth = inject(AuthService);

  protected email = '';
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly sent = signal(false);

  protected async submit(): Promise<void> {
    if (!this.email.trim()) {
      this.error.set('Ingresa tu correo.');
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    const result = await this.auth.sendPasswordReset(this.email.trim());
    this.loading.set(false);
    if (result.ok) this.sent.set(true);
    else this.error.set(result.message);
  }
}
