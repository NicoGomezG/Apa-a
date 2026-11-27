-- Teléfono propio en el perfil; los amigos lo ven solo si share_phone = true.
-- profiles ya tiene RLS activado y los REVOKE (migración inicial): no hace falta repetirlo.

-- AlterTable
ALTER TABLE "app"."profiles" ADD COLUMN     "phone" VARCHAR(30),
ADD COLUMN     "share_phone" BOOLEAN NOT NULL DEFAULT false;
