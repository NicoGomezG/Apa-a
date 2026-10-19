import { Component, computed, input } from '@angular/core';
import { PageHeader } from '../../shared/ui/page-header';
import { UPCOMING_MODULES } from '../../layout/navigation';

/** Pantalla honesta para módulos que todavía no existen: dice qué viene y en qué fase. */
@Component({
  selector: 'app-upcoming-module',
  imports: [PageHeader],
  template: `
    @if (info(); as module) {
      <app-page-header [title]="module.title" [icon]="module.icon" [module]="module.key" [subtitle]="module.summary" />
      <section class="apana-card" [style.--apana-section-color]="'var(--apana-module-' + module.key + ')'">
        <h2 class="apana-section-title">
          <i class="fa-solid fa-person-digging" aria-hidden="true"></i>
          Estamos construyendo este módulo
        </h2>
        <p class="text-secondary">Llega en la fase {{ module.phase }} del desarrollo. Incluirá:</p>
        <ul class="mb-0">
          @for (feature of module.features; track feature) {
            <li>{{ feature }}</li>
          }
        </ul>
      </section>
    }
  `,
})
export class UpcomingModule {
  /** Viene de la data de la ruta (withComponentInputBinding). */
  readonly module = input.required<string>();
  protected readonly info = computed(() => UPCOMING_MODULES[this.module()] ?? null);
}
