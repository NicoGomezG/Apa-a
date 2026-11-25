import type { Routes } from '@angular/router';
import { authGuard, guestGuard } from './core/auth/auth.guards';

const upcoming = (path: string, title: string) => ({
  path,
  title: `${title} · Apaña`,
  loadComponent: () => import('./features/modules/upcoming-module').then((m) => m.UpcomingModule),
  data: { module: path },
});

export const routes: Routes = [
  {
    path: 'auth',
    children: [
      {
        path: 'ingresar',
        title: 'Ingresar · Apaña',
        canActivate: [guestGuard],
        loadComponent: () => import('./features/auth/login').then((m) => m.Login),
      },
      {
        path: 'registro',
        title: 'Crear cuenta · Apaña',
        canActivate: [guestGuard],
        loadComponent: () => import('./features/auth/register').then((m) => m.Register),
      },
      {
        path: 'recuperar',
        title: 'Recuperar contraseña · Apaña',
        canActivate: [guestGuard],
        loadComponent: () => import('./features/auth/forgot-password').then((m) => m.ForgotPassword),
      },
      {
        path: 'nueva-clave',
        title: 'Nueva contraseña · Apaña',
        loadComponent: () => import('./features/auth/new-password').then((m) => m.NewPassword),
      },
      {
        path: 'callback',
        loadComponent: () => import('./features/auth/auth-callback').then((m) => m.AuthCallback),
      },
      { path: '', pathMatch: 'full', redirectTo: 'ingresar' },
    ],
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./layout/shell').then((m) => m.Shell),
    children: [
      {
        path: '',
        pathMatch: 'full',
        title: 'Inicio · Apaña',
        loadComponent: () => import('./features/dashboard/dashboard').then((m) => m.Dashboard),
      },
      {
        path: 'finanzas',
        loadComponent: () => import('./features/finanzas/finanzas').then((m) => m.Finanzas),
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'resumen' },
          {
            path: 'resumen',
            title: 'Finanzas · Apaña',
            loadComponent: () => import('./features/finanzas/resumen').then((m) => m.FinanzasResumen),
          },
          {
            path: 'movimientos',
            title: 'Movimientos · Finanzas · Apaña',
            loadComponent: () => import('./features/finanzas/movimientos').then((m) => m.FinanzasMovimientos),
          },
          {
            path: 'cuentas',
            title: 'Cuentas · Finanzas · Apaña',
            loadComponent: () => import('./features/finanzas/cuentas').then((m) => m.FinanzasCuentas),
          },
          {
            path: 'suscripciones',
            title: 'Suscripciones · Finanzas · Apaña',
            loadComponent: () => import('./features/finanzas/suscripciones').then((m) => m.FinanzasSuscripciones),
          },
          {
            path: 'importar',
            title: 'Importar · Finanzas · Apaña',
            loadComponent: () => import('./features/finanzas/importar').then((m) => m.FinanzasImportar),
          },
        ],
      },
      {
        path: 'agenda',
        title: 'Agenda · Apaña',
        loadComponent: () => import('./features/agenda/agenda').then((m) => m.Agenda),
      },
      upcoming('personas', 'Personas'),
      upcoming('compras', 'Compras'),
      upcoming('vehiculos', 'Vehículos'),
      upcoming('salud', 'Salud'),
      {
        path: 'ajustes',
        title: 'Ajustes · Apaña',
        loadComponent: () => import('./features/settings/settings').then((m) => m.Settings),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
