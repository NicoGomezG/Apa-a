-- CreateTable
CREATE TABLE "app"."financial_accounts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "institution" VARCHAR(60),
    "last4" VARCHAR(4),
    "currency" CHAR(3) NOT NULL DEFAULT 'CLP',
    "credit_limit" BIGINT,
    "billing_day" SMALLINT,
    "payment_day" SMALLINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "financial_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."transactions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "description" VARCHAR(200) NOT NULL,
    "amount" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "category" VARCHAR(32),
    "source" VARCHAR(16) NOT NULL DEFAULT 'manual',
    "dedupe_key" VARCHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."installment_plans" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "description" VARCHAR(200) NOT NULL,
    "purchase_date" DATE NOT NULL,
    "original_amount" BIGINT NOT NULL,
    "total_amount" BIGINT NOT NULL,
    "installment_count" SMALLINT NOT NULL,
    "installment_amount" BIGINT NOT NULL,
    "last_installment_amount" BIGINT,
    "first_due_month" DATE NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "category" VARCHAR(32),
    "dedupe_key" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "installment_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."card_statements" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "due_date" DATE NOT NULL,
    "total_billed" BIGINT NOT NULL,
    "minimum_payment" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "card_statements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."subscriptions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "amount" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'CLP',
    "frequency" VARCHAR(8) NOT NULL,
    "start_date" DATE NOT NULL,
    "account_id" UUID,
    "category" VARCHAR(32),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "financial_accounts_user_id_idx" ON "app"."financial_accounts"("user_id");

-- CreateIndex
CREATE INDEX "transactions_user_id_date_idx" ON "app"."transactions"("user_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_account_id_dedupe_key_key" ON "app"."transactions"("account_id", "dedupe_key");

-- CreateIndex
CREATE INDEX "installment_plans_user_id_idx" ON "app"."installment_plans"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "installment_plans_account_id_dedupe_key_key" ON "app"."installment_plans"("account_id", "dedupe_key");

-- CreateIndex
CREATE INDEX "card_statements_user_id_due_date_idx" ON "app"."card_statements"("user_id", "due_date");

-- CreateIndex
CREATE UNIQUE INDEX "card_statements_account_id_period_end_key" ON "app"."card_statements"("account_id", "period_end");

-- CreateIndex
CREATE INDEX "subscriptions_user_id_idx" ON "app"."subscriptions"("user_id");

-- AddForeignKey
ALTER TABLE "app"."transactions" ADD CONSTRAINT "transactions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "app"."financial_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."installment_plans" ADD CONSTRAINT "installment_plans_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "app"."financial_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."card_statements" ADD CONSTRAINT "card_statements_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "app"."financial_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."subscriptions" ADD CONSTRAINT "subscriptions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "app"."financial_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Endurecimiento (agregado a mano; Prisma no gestiona RLS ni grants).
-- Igual que en la migración inicial: RLS activado SIN políticas y sin acceso
-- para los roles de Supabase. Solo el backend lee y escribe estas tablas.
ALTER TABLE "app"."financial_accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "app"."transactions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "app"."installment_plans" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "app"."card_statements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "app"."subscriptions" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA "app" FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA "app" FROM authenticated';
  END IF;
END $$;
