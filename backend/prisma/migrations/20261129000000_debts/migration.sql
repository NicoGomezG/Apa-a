-- Finanzas: deudas (me deben / debo) con abonos.
-- CreateTable
CREATE TABLE "app"."debts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "direction" VARCHAR(12) NOT NULL,
    "contact_id" UUID,
    "person_name" VARCHAR(80) NOT NULL,
    "description" VARCHAR(200),
    "amount" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'CLP',
    "date" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "debts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."debt_payments" (
    "id" UUID NOT NULL,
    "debt_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "amount" BIGINT NOT NULL,
    "date" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "debt_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "debts_user_id_idx" ON "app"."debts"("user_id");

-- CreateIndex
CREATE INDEX "debt_payments_debt_id_idx" ON "app"."debt_payments"("debt_id");

-- CreateIndex
CREATE INDEX "debt_payments_user_id_idx" ON "app"."debt_payments"("user_id");

-- AddForeignKey
ALTER TABLE "app"."debts" ADD CONSTRAINT "debts_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "app"."contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."debt_payments" ADD CONSTRAINT "debt_payments_debt_id_fkey" FOREIGN KEY ("debt_id") REFERENCES "app"."debts"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "app"."debts" ADD CONSTRAINT "debts_direction_check" CHECK ("direction" IN ('owed_to_me', 'i_owe'));
ALTER TABLE "app"."debts" ADD CONSTRAINT "debts_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "app"."debt_payments" ADD CONSTRAINT "debt_payments_amount_positive" CHECK ("amount" > 0);

-- RLS: el schema app solo lo usa el backend; nadie más entra por la Data API.
ALTER TABLE "app"."debts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "app"."debt_payments" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA "app" FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA "app" FROM authenticated';
  END IF;
END $$;
