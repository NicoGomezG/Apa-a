-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "app";

-- CreateTable
CREATE TABLE "app"."profiles" (
    "id" UUID NOT NULL,
    "display_name" VARCHAR(80),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."user_preferences" (
    "user_id" UUID NOT NULL,
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'America/Santiago',
    "locale" VARCHAR(16) NOT NULL DEFAULT 'es-CL',
    "currency" CHAR(3) NOT NULL DEFAULT 'CLP',
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "app"."audit_logs" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "action" VARCHAR(64) NOT NULL,
    "entity_type" VARCHAR(64),
    "entity_id" UUID,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_logs_user_id_created_at_idx" ON "app"."audit_logs"("user_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "app"."user_preferences" ADD CONSTRAINT "user_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app"."profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Endurecimiento (agregado a mano; Prisma no gestiona RLS ni grants).
-- El schema `app` no se expone por la Data API de Supabase y solo lo usa el
-- backend. Igual se activa RLS SIN políticas y se revoca el acceso a los roles
-- de Supabase como segunda barrera: si alguien expusiera el schema por error,
-- `anon` y `authenticated` no podrían leer nada.
ALTER TABLE "app"."profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "app"."user_preferences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "app"."audit_logs" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON SCHEMA "app" FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA "app" FROM anon';
    EXECUTE 'REVOKE ALL ON SCHEMA "app" FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA "app" FROM authenticated';
    EXECUTE 'REVOKE ALL ON SCHEMA "app" FROM authenticated';
  END IF;
END $$;
