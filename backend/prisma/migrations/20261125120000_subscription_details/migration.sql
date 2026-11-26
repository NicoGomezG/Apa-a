-- Datos extra de las suscripciones: correo de la cuenta del servicio y notas.
-- Solo agrega columnas opcionales; no toca datos existentes.
ALTER TABLE "app"."subscriptions" ADD COLUMN "email" VARCHAR(254),
ADD COLUMN "notes" VARCHAR(500);
