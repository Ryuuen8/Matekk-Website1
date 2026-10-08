import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service.js';
import { EmailService } from '../../email/email.service.js';

const OTP_TTL_MS = 5 * 60 * 1000;
const VERIFICATION_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

export type OtpPurpose = string;

@Injectable()
export class OtpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
  ) {}

  private hash(email: string, purpose: OtpPurpose, code: string): Buffer {
    return createHmac('sha256', this.config.getOrThrow<string>('OTP_SECRET'))
      .update(JSON.stringify([purpose, email, code]))
      .digest();
  }

  private hashVerificationToken(
    email: string,
    purpose: OtpPurpose,
    token: string,
  ): string {
    return createHmac('sha256', this.config.getOrThrow<string>('OTP_SECRET'))
      .update(JSON.stringify(['verification', purpose, email, token]))
      .digest('hex');
  }

  async request(email: string, purpose: OtpPurpose): Promise<void> {
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedPurpose = purpose.trim();
    if (!normalizedEmail || !normalizedPurpose) {
      throw new BadRequestException('An email and OTP purpose are required.');
    }

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);

    await this.prisma.otpCode.deleteMany({
      where: { email: normalizedEmail, purpose: normalizedPurpose },
    });
    const record = await this.prisma.otpCode.create({
      data: {
        email: normalizedEmail,
        purpose: normalizedPurpose,
        codeHash: this.hash(normalizedEmail, normalizedPurpose, code).toString(
          'hex',
        ),
        expiresAt,
      },
      select: { id: true },
    });

    try {
      await this.email.sendOtp(normalizedEmail, code, OTP_TTL_MS / 60000);
    } catch (error) {
      await this.prisma.otpCode.deleteMany({ where: { id: record.id } });
      throw error;
    }
  }

  async verify(
    email: string,
    purpose: OtpPurpose,
    code: string,
  ): Promise<{ verificationToken: string }> {
    const fail = () => new UnauthorizedException('Invalid or expired code');
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedPurpose = purpose.trim();
    const now = new Date();
    if (!normalizedEmail || !normalizedPurpose) {
      throw fail();
    }

    const record = await this.prisma.otpCode.findFirst({
      where: {
        email: normalizedEmail,
        purpose: normalizedPurpose,
        consumedAt: null,
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!record || record.expiresAt <= now || record.attempts >= MAX_ATTEMPTS) {
      throw fail();
    }

    const expected = Buffer.from(record.codeHash, 'hex');
    const actual = this.hash(normalizedEmail, normalizedPurpose, code);
    if (
      expected.length !== actual.length ||
      !timingSafeEqual(expected, actual)
    ) {
      const { count } = await this.prisma.otpCode.updateMany({
        where: {
          id: record.id,
          consumedAt: null,
          attempts: record.attempts,
          expiresAt: { gt: now },
        },
        data: { attempts: { increment: 1 } },
      });
      if (count === 0) {
        throw fail();
      }
      throw fail();
    }

    const verificationToken = randomBytes(32).toString('base64url');
    const { count } = await this.prisma.otpCode.updateMany({
      where: {
        id: record.id,
        consumedAt: null,
        attempts: record.attempts,
        expiresAt: { gt: now },
      },
      data: {
        consumedAt: now,
        attempts: { increment: 1 },
        verificationHash: this.hashVerificationToken(
          normalizedEmail,
          normalizedPurpose,
          verificationToken,
        ),
        verifiedUntil: new Date(now.getTime() + VERIFICATION_TTL_MS),
      },
    });
    if (count === 0) {
      throw fail();
    }
    return { verificationToken };
  }

  async consumeVerification(
    email: string,
    purpose: OtpPurpose,
    verificationToken: string,
  ): Promise<void> {
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedPurpose = purpose.trim();
    if (!normalizedEmail || !normalizedPurpose || !verificationToken) {
      throw new UnauthorizedException('Email verification is required.');
    }

    const { count } = await this.prisma.otpCode.updateMany({
      where: {
        email: normalizedEmail,
        purpose: normalizedPurpose,
        verificationHash: this.hashVerificationToken(
          normalizedEmail,
          normalizedPurpose,
          verificationToken,
        ),
        verifiedUntil: { gt: new Date() },
      },
      data: {
        verificationHash: null,
        verifiedUntil: null,
      },
    });
    if (count !== 1) {
      throw new UnauthorizedException('Email verification is missing or expired.');
    }
  }
}
