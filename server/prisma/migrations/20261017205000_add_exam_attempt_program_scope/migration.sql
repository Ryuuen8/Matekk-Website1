ALTER TABLE "ExamAttempt"
ADD COLUMN "programKey" TEXT,
ADD COLUMN "module" TEXT;

CREATE INDEX "ExamAttempt_userId_programKey_examKey_idx"
ON "ExamAttempt"("userId", "programKey", "examKey");
