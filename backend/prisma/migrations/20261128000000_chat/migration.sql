-- Chat entre amigos y en grupos de gastos.
-- CreateTable
CREATE TABLE "app"."chat_messages" (
    "id" UUID NOT NULL,
    "thread_key" VARCHAR(120) NOT NULL,
    "group_id" UUID,
    "author_id" UUID NOT NULL,
    "body" VARCHAR(2000) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app"."chat_reads" (
    "user_id" UUID NOT NULL,
    "thread_key" VARCHAR(120) NOT NULL,
    "group_id" UUID,
    "last_read_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "chat_reads_pkey" PRIMARY KEY ("user_id","thread_key")
);

-- CreateIndex
CREATE INDEX "chat_messages_thread_key_created_at_idx" ON "app"."chat_messages"("thread_key", "created_at");

-- CreateIndex
CREATE INDEX "chat_messages_author_id_idx" ON "app"."chat_messages"("author_id");

-- AddForeignKey
ALTER TABLE "app"."chat_messages" ADD CONSTRAINT "chat_messages_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "app"."split_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app"."chat_reads" ADD CONSTRAINT "chat_reads_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "app"."split_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- La conversación de grupo siempre apunta a su grupo (y cae con él); la de amigos nunca.
ALTER TABLE "app"."chat_messages" ADD CONSTRAINT "chat_messages_thread_group" CHECK (
  ("group_id" IS NULL AND "thread_key" LIKE 'friend:%') OR
  ("group_id" IS NOT NULL AND "thread_key" = 'group:' || "group_id"::text)
);

-- RLS: el schema app solo lo usa el backend; nadie más entra por la Data API.
ALTER TABLE "app"."chat_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "app"."chat_reads" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA "app" FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA "app" FROM authenticated';
  END IF;
END $$;
