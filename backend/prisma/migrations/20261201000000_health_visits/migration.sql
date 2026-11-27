-- Salud (fase A): consultas con especialistas y su próximo control.
-- CreateTable
CREATE TABLE "app"."health_visits" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "specialty" VARCHAR(60) NOT NULL,
    "professional" VARCHAR(80),
    "place" VARCHAR(120),
    "visit_date" DATE NOT NULL,
    "repeat_months" SMALLINT,
    "next_date" DATE,
    "next_done" BOOLEAN NOT NULL DEFAULT false,
    "notes" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "health_visits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "health_visits_user_id_idx" ON "app"."health_visits"("user_id");

ALTER TABLE "app"."health_visits" ADD CONSTRAINT "health_visits_repeat_months_check"
  CHECK ("repeat_months" IS NULL OR "repeat_months" IN (1, 6, 12));
ALTER TABLE "app"."health_visits" ADD CONSTRAINT "health_visits_next_after_visit"
  CHECK ("next_date" IS NULL OR "next_date" >= "visit_date");

-- RLS: el schema app solo lo usa el backend; nadie más entra por la Data API.
ALTER TABLE "app"."health_visits" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA "app" FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA "app" FROM authenticated';
  END IF;
END $$;
