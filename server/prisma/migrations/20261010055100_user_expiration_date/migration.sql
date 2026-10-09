ALTER TABLE "Users"
ADD COLUMN "expiration_date" TIMESTAMP(3);

UPDATE "Users"
SET "expiration_date" = CURRENT_TIMESTAMP + INTERVAL '3 months'
WHERE "active_status" = true;
