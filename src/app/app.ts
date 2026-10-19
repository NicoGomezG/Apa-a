import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { isSupabaseConfigured } from './core/supabase';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  template: `
    @if (configured) {
      <router-outlet />
    } @else {
      <main class="apana-auth-page">
        <section class="apana-card apana-auth-card">
          <h1 class="h5">Falta configurar Supabase</h1>
          <p class="mb-0">
            Define <code>NG_APP_SUPABASE_URL</code> y <code>NG_APP_SUPABASE_PUBLISHABLE_KEY</code>
            en el archivo <code>.env</code> de la raíz (o en Vercel) y vuelve a iniciar.
          </p>
        </section>
      </main>
    }
  `,
})
export class App {
  protected readonly configured = isSupabaseConfigured();
}
