ALTER TABLE "Questions"
ADD COLUMN "question_type" TEXT NOT NULL DEFAULT 'single',
ADD COLUMN "match_items" JSONB;
