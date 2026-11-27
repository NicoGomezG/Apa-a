-- Salud (fase B): recambios cada N días (lentes de contacto…) y medicamentos cada N horas.
-- CreateTable
CREATE TABLE "app"."health_trackers" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "every_days" SMALLINT,
    "every_hours" SMALLINT,
    "start_minute" SMALLINT,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "notes" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "health_trackers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."health_tracker_events" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "tracker_id" UUID NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "day" DATE,
    "dose_number" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "health_tracker_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "health_trackers_user_id_idx" ON "app"."health_trackers"("user_id");

-- CreateIndex
CREATE INDEX "health_tracker_events_user_id_idx" ON "app"."health_tracker_events"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "health_tracker_events_tracker_id_day_key" ON "app"."health_tracker_events"("tracker_id", "day");

-- CreateIndex
CREATE UNIQUE INDEX "health_tracker_events_tracker_id_dose_number_key" ON "app"."health_tracker_events"("tracker_id", "dose_number");

-- AddForeignKey
ALTER TABLE "app"."health_tracker_events" ADD CONSTRAINT "health_tracker_events_tracker_id_fkey" FOREIGN KEY ("tracker_id") REFERENCES "app"."health_trackers"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Un recambio lleva every_days; un medicamento every_hours y hora de inicio.
ALTER TABLE "app"."health_trackers" ADD CONSTRAINT "health_trackers_kind_check" CHECK (
  ("kind" = 'replacement' AND "every_days" BETWEEN 1 AND 730 AND "every_hours" IS NULL AND "start_minute" IS NULL AND "end_date" IS NULL)
  OR ("kind" = 'medication' AND "every_hours" BETWEEN 1 AND 168 AND "every_days" IS NULL AND "start_minute" BETWEEN 0 AND 1439)
);
ALTER TABLE "app"."health_trackers" ADD CONSTRAINT "health_trackers_end_after_start"
  CHECK ("end_date" IS NULL OR "end_date" >= "start_date");
-- "changed" lleva día; "taken"/"skipped" llevan n.º de toma.
ALTER TABLE "app"."health_tracker_events" ADD CONSTRAINT "health_tracker_events_kind_check" CHECK (
  ("kind" = 'changed' AND "day" IS NOT NULL AND "dose_number" IS NULL)
  OR ("kind" IN ('taken', 'skipped') AND "day" IS NULL AND "dose_number" >= 0)
);

-- RLS: el schema app solo lo usa el backend; nadie más entra por la Data API.
ALTER TABLE "app"."health_trackers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "app"."health_tracker_events" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA "app" FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA "app" FROM authenticated';
  END IF;
END $$;
