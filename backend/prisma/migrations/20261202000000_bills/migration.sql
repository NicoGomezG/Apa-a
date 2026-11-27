-- Finanzas: cuentas fijas (agua, luz, internet…) y su pago de cada mes.
-- CreateTable
CREATE TABLE "app"."bills" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "kind" VARCHAR(24) NOT NULL,
    "company" VARCHAR(60),
    "amount" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'CLP',
    "due_day" SMALLINT NOT NULL,
    "every_months" SMALLINT NOT NULL DEFAULT 1,
    "start_month" DATE NOT NULL,
    "account_id" UUID,
    "autopay" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "bills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."bill_payments" (
    "id" UUID NOT NULL,
    "bill_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "period" DATE NOT NULL,
    "amount" BIGINT NOT NULL,
    "paid_on" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bill_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bills_user_id_idx" ON "app"."bills"("user_id");

-- CreateIndex
CREATE INDEX "bill_payments_user_id_idx" ON "app"."bill_payments"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "bill_payments_bill_id_period_key" ON "app"."bill_payments"("bill_id", "period");

-- AddForeignKey
ALTER TABLE "app"."bills" ADD CONSTRAINT "bills_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "app"."financial_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."bill_payments" ADD CONSTRAINT "bill_payments_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "app"."bills"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "app"."bills" ADD CONSTRAINT "bills_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "app"."bills" ADD CONSTRAINT "bills_due_day_check" CHECK ("due_day" BETWEEN 1 AND 31);
ALTER TABLE "app"."bills" ADD CONSTRAINT "bills_every_months_check" CHECK ("every_months" IN (1, 2, 12));
ALTER TABLE "app"."bills" ADD CONSTRAINT "bills_start_month_first_day" CHECK (EXTRACT(DAY FROM "start_month") = 1);
ALTER TABLE "app"."bill_payments" ADD CONSTRAINT "bill_payments_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "app"."bill_payments" ADD CONSTRAINT "bill_payments_period_first_day" CHECK (EXTRACT(DAY FROM "period") = 1);

-- RLS: el schema app solo lo usa el backend; nadie más entra por la Data API.
ALTER TABLE "app"."bills" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "app"."bill_payments" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA "app" FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA "app" FROM authenticated';
  END IF;
END $$;
