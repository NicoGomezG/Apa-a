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
    // Enlace de solo lectura para invitados: sin sesión.
    path: 'compartido/:token',
    title: 'Gastos compartidos · Apaña',
    loadComponent: () => import('./features/public/compartido').then((m) => m.Compartido),
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
            path: 'cuentas-fijas',
            title: 'Cuentas fijas · Finanzas · Apaña',
            loadComponent: () => import('./features/finanzas/cuentas-fijas').then((m) => m.FinanzasCuentasFijas),
          },
          {
            path: 'deudas',
            title: 'Deudas · Finanzas · Apaña',
            loadComponent: () => import('./features/finanzas/deudas').then((m) => m.FinanzasDeudas),
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
      {
        path: 'personas',
        loadComponent: () => import('./features/personas/personas').then((m) => m.Personas),
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'contactos' },
          {
            path: 'contactos',
            title: 'Contactos · Personas · Apaña',
            loadComponent: () => import('./features/personas/contactos').then((m) => m.PersonasContactos),
          },
          {
            path: 'gastos',
            title: 'Gastos compartidos · Personas · Apaña',
            loadComponent: () => import('./features/personas/gastos').then((m) => m.PersonasGastos),
          },
          {
            path: 'gastos/:id',
            title: 'Grupo · Gastos compartidos · Apaña',
            loadComponent: () => import('./features/personas/grupo').then((m) => m.PersonasGrupo),
          },
          {
            path: 'compartidos/:id',
            title: 'Grupo compartido contigo · Apaña',
            loadComponent: () => import('./features/personas/compartido-conmigo').then((m) => m.PersonasCompartidoConmigo),
          },
          {
            path: 'amigos',
            title: 'Amigos · Personas · Apaña',
            loadComponent: () => import('./features/personas/amigos').then((m) => m.PersonasAmigos),
          },
          {
            path: 'mensajes',
            title: 'Mensajes · Personas · Apaña',
            loadComponent: () => import('./features/personas/mensajes').then((m) => m.PersonasMensajes),
          },
          {
            path: 'mensajes/:kind/:id',
            title: 'Conversación · Personas · Apaña',
            loadComponent: () => import('./features/personas/mensajes').then((m) => m.PersonasConversacion),
          },
        ],
      },
      {
        // Enlace de invitación de amistad. Sin sesión, el guard lleva a ingresar y vuelve acá.
        path: 'amigos/unirse/:code',
        title: 'Invitación de amistad · Apaña',
        loadComponent: () => import('./features/personas/unirse').then((m) => m.PersonasUnirse),
      },
      upcoming('compras', 'Compras'),
      upcoming('vehiculos', 'Vehículos'),
      {
        path: 'salud',
        title: 'Salud · Apaña',
        loadComponent: () => import('./features/salud/salud').then((m) => m.Salud),
      },
      {
        path: 'ajustes',
        title: 'Ajustes · Apaña',
        loadComponent: () => import('./features/settings/settings').then((m) => m.Settings),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
