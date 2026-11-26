-- Personas etapa 3: amigos con cuenta, cumpleaños propio y grupos compartidos con amigos.
-- AlterTable
ALTER TABLE "app"."profiles" ADD COLUMN     "birth_day" SMALLINT,
ADD COLUMN     "birth_month" SMALLINT,
ADD COLUMN     "birth_year" SMALLINT;

-- AlterTable
ALTER TABLE "app"."contacts" ADD COLUMN     "friend_user_id" UUID;

-- AlterTable
ALTER TABLE "app"."split_participants" ADD COLUMN     "linked_user_id" UUID,
ADD COLUMN     "reminded_at" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "app"."split_settlements" ADD COLUMN     "confirmed" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "reported_by" UUID;

-- CreateTable
CREATE TABLE "app"."friend_invites" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "friend_invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."friendships" (
    "id" UUID NOT NULL,
    "user_a_id" UUID NOT NULL,
    "user_b_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "friendships_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "friend_invites_code_key" ON "app"."friend_invites"("code");

-- CreateIndex
CREATE INDEX "friend_invites_user_id_idx" ON "app"."friend_invites"("user_id");

-- CreateIndex
CREATE INDEX "friendships_user_b_id_idx" ON "app"."friendships"("user_b_id");

-- CreateIndex
CREATE UNIQUE INDEX "friendships_user_a_id_user_b_id_key" ON "app"."friendships"("user_a_id", "user_b_id");

-- CreateIndex
CREATE UNIQUE INDEX "contacts_user_id_friend_user_id_key" ON "app"."contacts"("user_id", "friend_user_id");

-- CreateIndex
CREATE INDEX "split_participants_linked_user_id_idx" ON "app"."split_participants"("linked_user_id");


-- Un solo registro por par de amigos, siempre en el mismo orden.
ALTER TABLE "app"."friendships" ADD CONSTRAINT "friendships_ordered_pair" CHECK ("user_a_id" < "user_b_id");

-- RLS: el schema app solo lo usa el backend; nadie más entra por la Data API.
ALTER TABLE "app"."friend_invites" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "app"."friendships" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA "app" FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA "app" FROM authenticated';
  END IF;
END $$;
