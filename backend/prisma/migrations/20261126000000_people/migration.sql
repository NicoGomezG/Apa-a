-- CreateTable
CREATE TABLE "app"."contacts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "nickname" VARCHAR(40),
    "birth_day" SMALLINT,
    "birth_month" SMALLINT,
    "birth_year" SMALLINT,
    "phone" VARCHAR(30),
    "email" VARCHAR(254),
    "relationship" VARCHAR(16),
    "notes" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."split_groups" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "date" DATE,
    "currency" CHAR(3) NOT NULL DEFAULT 'CLP',
    "share_token" VARCHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "split_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."split_participants" (
    "id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "contact_id" UUID,
    "is_me" BOOLEAN NOT NULL DEFAULT false,
    "position" SMALLINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "split_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."split_expenses" (
    "id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "description" VARCHAR(120) NOT NULL,
    "date" DATE NOT NULL,
    "payer_id" UUID NOT NULL,
    "mode" VARCHAR(8) NOT NULL,
    "subtotal" BIGINT NOT NULL,
    "tip_percent" SMALLINT NOT NULL DEFAULT 0,
    "tip" BIGINT NOT NULL DEFAULT 0,
    "total" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "split_expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."split_expense_items" (
    "id" UUID NOT NULL,
    "expense_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "description" VARCHAR(120) NOT NULL,
    "quantity" SMALLINT NOT NULL,
    "unit_price" BIGINT NOT NULL,
    "amount" BIGINT NOT NULL,
    "participant_ids" UUID[],
    "position" SMALLINT NOT NULL,

    CONSTRAINT "split_expense_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."split_shares" (
    "expense_id" UUID NOT NULL,
    "participant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "consumption" BIGINT NOT NULL,
    "tip" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "split_shares_pkey" PRIMARY KEY ("expense_id","participant_id")
);

-- CreateTable
CREATE TABLE "app"."split_settlements" (
    "id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "from_id" UUID NOT NULL,
    "to_id" UUID NOT NULL,
    "amount" BIGINT NOT NULL,
    "date" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "split_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contacts_user_id_idx" ON "app"."contacts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "split_groups_share_token_key" ON "app"."split_groups"("share_token");

-- CreateIndex
CREATE INDEX "split_groups_user_id_idx" ON "app"."split_groups"("user_id");

-- CreateIndex
CREATE INDEX "split_participants_group_id_idx" ON "app"."split_participants"("group_id");

-- CreateIndex
CREATE INDEX "split_participants_user_id_idx" ON "app"."split_participants"("user_id");

-- CreateIndex
CREATE INDEX "split_expenses_group_id_idx" ON "app"."split_expenses"("group_id");

-- CreateIndex
CREATE INDEX "split_expenses_user_id_idx" ON "app"."split_expenses"("user_id");

-- CreateIndex
CREATE INDEX "split_expense_items_expense_id_idx" ON "app"."split_expense_items"("expense_id");

-- CreateIndex
CREATE INDEX "split_shares_participant_id_idx" ON "app"."split_shares"("participant_id");

-- CreateIndex
CREATE INDEX "split_settlements_group_id_idx" ON "app"."split_settlements"("group_id");

-- CreateIndex
CREATE INDEX "split_settlements_user_id_idx" ON "app"."split_settlements"("user_id");

-- AddForeignKey
ALTER TABLE "app"."split_participants" ADD CONSTRAINT "split_participants_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "app"."split_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."split_participants" ADD CONSTRAINT "split_participants_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "app"."contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."split_expenses" ADD CONSTRAINT "split_expenses_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "app"."split_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."split_expenses" ADD CONSTRAINT "split_expenses_payer_id_fkey" FOREIGN KEY ("payer_id") REFERENCES "app"."split_participants"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."split_expense_items" ADD CONSTRAINT "split_expense_items_expense_id_fkey" FOREIGN KEY ("expense_id") REFERENCES "app"."split_expenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."split_shares" ADD CONSTRAINT "split_shares_expense_id_fkey" FOREIGN KEY ("expense_id") REFERENCES "app"."split_expenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."split_shares" ADD CONSTRAINT "split_shares_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "app"."split_participants"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."split_settlements" ADD CONSTRAINT "split_settlements_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "app"."split_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."split_settlements" ADD CONSTRAINT "split_settlements_from_id_fkey" FOREIGN KEY ("from_id") REFERENCES "app"."split_participants"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."split_settlements" ADD CONSTRAINT "split_settlements_to_id_fkey" FOREIGN KEY ("to_id") REFERENCES "app"."split_participants"("id") ON DELETE NO ACTION ON UPDATE CASCADE;


-- Endurecimiento (agregado a mano; Prisma no gestiona RLS ni grants).
-- RLS activado SIN políticas y sin acceso para los roles de Supabase:
-- solo el backend lee y escribe estas tablas.
ALTER TABLE "app"."contacts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "app"."split_groups" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "app"."split_participants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "app"."split_expenses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "app"."split_expense_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "app"."split_shares" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "app"."split_settlements" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA "app" FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA "app" FROM authenticated';
  END IF;
END $$;
