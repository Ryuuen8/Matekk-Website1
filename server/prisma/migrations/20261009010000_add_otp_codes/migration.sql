CREATE TABLE "OtpCode" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OtpCode_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OtpCode_email_purpose_consumedAt_createdAt_idx"
ON "OtpCode"("email", "purpose", "consumedAt", "createdAt");
