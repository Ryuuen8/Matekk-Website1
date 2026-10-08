ALTER TABLE "OtpCode"
ADD COLUMN "verificationHash" TEXT,
ADD COLUMN "verifiedUntil" TIMESTAMP(3);
