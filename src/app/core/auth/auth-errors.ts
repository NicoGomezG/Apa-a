import type { AuthError } from '@supabase/supabase-js';

const MESSAGES: Record<string, string> = {
  invalid_credentials: 'El correo o la contraseña no coinciden.',
  email_not_confirmed: 'Todavía no confirmas tu correo. Revisa tu bandeja de entrada.',
  user_already_exists: 'Ya existe una cuenta con ese correo.',
  email_exists: 'Ya existe una cuenta con ese correo.',
  weak_password: 'La contraseña es muy débil. Usa al menos 8 caracteres y combina letras y números.',
  same_password: 'La nueva contraseña debe ser distinta de la anterior.',
  over_request_rate_limit: 'Demasiados intentos. Espera un momento y vuelve a intentarlo.',
  over_email_send_rate_limit: 'Ya te enviamos un correo hace poco. Espera unos minutos antes de pedir otro.',
  email_address_invalid: 'Ese correo no parece válido.',
  signup_disabled: 'El registro está deshabilitado por ahora.',
  session_expired: 'Tu sesión expiró. Vuelve a ingresar.',
  flow_state_expired: 'El enlace expiró. Pide uno nuevo.',
  otp_expired: 'El enlace expiró. Pide uno nuevo.',
};

export function authErrorMessage(error: Pick<AuthError, 'code'> | null | undefined): string {
  return (error?.code && MESSAGES[error.code]) || 'No pudimos completar la operación. Intenta de nuevo.';
}
