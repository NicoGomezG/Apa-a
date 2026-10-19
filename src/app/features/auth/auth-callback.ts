import { Component, inject, signal, type OnInit } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';

/** Retorno desde Google o desde el correo de confirmación (flujo PKCE). */
@Component({
  selector: 'app-auth-callback',
  imports: [RouterLink],
  template: `
    <main class="apana-auth-page">
      <div class="apana-auth-card text-center">
        @if (failed()) {
          <section class="apana-card p-4">
            <h1 class="h4">No pudimos completar el ingreso</h1>
            <p>El enlace pudo haber expirado. Intenta de nuevo.</p>
            <a class="btn btn-primary" routerLink="/auth/ingresar">Volver a ingresar</a>
          </section>
        } @else {
          <div class="spinner-border text-primary" role="status">
            <span class="visually-hidden">Ingresando…</span>
          </div>
        }
      </div>
    </main>
  `,
})
export class AuthCallback implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  protected readonly failed = signal(false);

  async ngOnInit(): Promise<void> {
    await this.auth.ready;
    if (this.auth.isAuthenticated()) {
      await this.router.navigateByUrl('/', { replaceUrl: true });
    } else {
      this.failed.set(true);
    }
  }
}
