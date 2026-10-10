-- Store randomized question snapshots and server-graded results for resumable exam attempts.
CREATE TABLE "ExamAttempt" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "examKey" TEXT NOT NULL,
    "questionSet" JSONB NOT NULL,
    "durationSeconds" INTEGER NOT NULL,
    "deadline" TIMESTAMP(3) NOT NULL,
    "score" INTEGER,
    "review" JSONB,
    "submittedAt" TIMESTAMP(3),

    CONSTRAINT "ExamAttempt_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ExamAttempt_userId_examKey_idx" ON "ExamAttempt"("userId", "examKey");

ALTER TABLE "ExamAttempt"
ADD CONSTRAINT "ExamAttempt_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "Users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
