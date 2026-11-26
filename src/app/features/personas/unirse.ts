import { HttpErrorResponse } from '@angular/common/http';
import { Component, effect, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { apiErrorMessage } from '../../core/http-errors';
import { PageHeader } from '../../shared/ui/page-header';
import type { InvitePreview } from './people.models';
import { PeopleService } from './people.service';

/** Aceptar una invitación de amistad (/amigos/unirse/:code). Requiere sesión. */
@Component({
  selector: 'app-personas-unirse',
  imports: [PageHeader, RouterLink],
  host: { style: '--apana-section-color: var(--apana-module-personas)' },
  template: `
    <app-page-header title="Invitación de amistad" icon="fa-user-plus" module="personas" />
    <section class="apana-card" style="max-width: 36rem">
      @if (loading()) {
        <p class="mb-0" role="status">Revisando la invitación…</p>
      } @else if (error(); as message) {
        <h2 class="h5">No pudimos usar esta invitación</h2>
        <p>{{ message }}</p>
        <a class="btn btn-outline-primary" routerLink="/personas/amigos">Ir a Amigos</a>
      } @else if (preview(); as p) {
        @if (p.own) {
          <h2 class="h5">Esta invitación es tuya</h2>
          <p>Envíale el enlace a tu amigo para que la acepte desde su cuenta.</p>
          <a class="btn btn-outline-primary" routerLink="/personas/amigos">Volver a Amigos</a>
        } @else if (p.alreadyFriends) {
          <h2 class="h5">Ya son amigos</h2>
          <p>{{ inviter() }} ya está entre tus amigos en Apaña.</p>
          <a class="btn btn-primary" routerLink="/personas/amigos">Ver mis amigos</a>
        } @else {
          <h2 class="h5">{{ inviter() }} te invita a ser su amigo en Apaña</h2>
          <p>Al aceptar:</p>
          <ul>
            <li>Cada uno ve el nombre y el cumpleaños (día y mes) del otro.</li>
            <li>Si te agrega a un grupo de gastos, verás cuánto debes y podrás avisarle cuando le pagues.</li>
            <li>No ve tus finanzas, tus contactos ni tu correo.</li>
          </ul>
          <div class="d-flex flex-wrap gap-2">
            <button type="button" class="btn btn-primary" (click)="accept()" [disabled]="busy()">
              {{ busy() ? 'Aceptando…' : 'Aceptar' }}
            </button>
            <a class="btn btn-outline-primary" routerLink="/">Ahora no</a>
          </div>
        }
      }
    </section>
  `,
})
export class PersonasUnirse {
  private readonly people = inject(PeopleService);
  private readonly router = inject(Router);

  /** Código de la invitación, desde la ruta. */
  readonly code = input.required<string>();

  protected readonly preview = signal<InvitePreview | null>(null);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  constructor() {
    effect(() => {
      void this.load(this.code());
    });
  }

  protected inviter(): string {
    return this.preview()?.inviterName?.trim() || 'Una persona';
  }

  private async load(code: string): Promise<void> {
    try {
      this.preview.set(await this.people.previewInvite(code));
    } catch (error) {
      this.error.set(this.message(error));
    } finally {
      this.loading.set(false);
    }
  }

  protected async accept(): Promise<void> {
    this.busy.set(true);
    try {
      await this.people.acceptInvite(this.code());
      await this.router.navigate(['/personas/amigos']);
    } catch (error) {
      this.error.set(this.message(error));
      this.busy.set(false);
    }
  }

  private message(error: unknown): string {
    if (error instanceof HttpErrorResponse && error.status === 404) {
      return 'La invitación no existe, ya se usó o venció. Pídele a tu amigo un enlace nuevo.';
    }
    return apiErrorMessage(error, 'Revisa tu conexión e inténtalo de nuevo.');
  }
}
