import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { EmailService } from '../../email/email.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { OtpService } from './otp.service.js';

describe('OtpService', () => {
  const deleteMany = vi.fn();
  const create = vi.fn();
  const findFirst = vi.fn();
  const updateMany = vi.fn();
  const sendOtp = vi.fn();
  const secret = 'test-otp-secret-with-sufficient-entropy';

  function createService() {
    return new OtpService(
      {
        otpCode: { deleteMany, create, findFirst, updateMany },
      } as unknown as PrismaService,
      { sendOtp } as unknown as EmailService,
      { getOrThrow: () => secret } as unknown as ConfigService,
    );
  }

  function createRecord(
    code: string,
    options: {
      attempts?: number;
      expiresAt?: Date;
    } = {},
  ) {
    return {
      id: 1,
      codeHash: createHmac('sha256', secret)
        .update(JSON.stringify(['PASSWORD_RESET', 'user@example.com', code]))
        .digest('hex'),
      expiresAt: options.expiresAt ?? new Date(Date.now() + 60_000),
      attempts: options.attempts ?? 0,
    };
  }

  beforeEach(() => {
    deleteMany.mockReset().mockResolvedValue({ count: 0 });
    create.mockReset().mockResolvedValue({ id: 1 });
    findFirst.mockReset();
    updateMany.mockReset().mockResolvedValue({ count: 1 });
    sendOtp.mockReset().mockResolvedValue(undefined);
  });

  it('stores a hash and emails a six-digit code to a normalized address', async () => {
    const service = createService();

    await expect(service.request(' User@Example.com ', 'PASSWORD_RESET')).resolves.toBe(true);

    expect(deleteMany).toHaveBeenCalledWith({
      where: { email: 'user@example.com', purpose: 'PASSWORD_RESET' },
    });
    const createOptions = create.mock.calls[0][0];
    expect(createOptions.data).toMatchObject({
      email: 'user@example.com',
      purpose: 'PASSWORD_RESET',
    });
    expect(createOptions.data.codeHash).toMatch(/^[a-f0-9]{64}$/);
    const [email, code, expiresInMinutes] = sendOtp.mock.calls[0];
    expect(email).toBe('user@example.com');
    expect(code).toMatch(/^\d{6}$/);
    expect(expiresInMinutes).toBe(5);
  });

  it('reuses a valid unexpired code instead of sending another email', async () => {
    findFirst.mockResolvedValue({ id: 1 });
    const service = createService();

    await expect(service.request(' User@Example.com ', 'LOGIN')).resolves.toBe(false);

    expect(findFirst).toHaveBeenCalledWith({
      where: {
        email: 'user@example.com',
        purpose: 'LOGIN',
        consumedAt: null,
        expiresAt: { gt: expect.any(Date) },
        attempts: { lt: 5 },
      },
      select: { id: true },
    });
    expect(deleteMany).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(sendOtp).not.toHaveBeenCalled();
  });

  it('removes the stored code and rethrows when email delivery fails', async () => {
    const deliveryError = new Error('Email delivery failed.');
    sendOtp.mockRejectedValue(deliveryError);
    const service = createService();

    await expect(
      service.request('user@example.com', 'PASSWORD_RESET'),
    ).rejects.toBe(deliveryError);
    expect(deleteMany).toHaveBeenNthCalledWith(2, { where: { id: 1 } });
  });

  it('counts invalid attempts without consuming the code', async () => {
    findFirst.mockResolvedValue(createRecord('123456'));
    const service = createService();

    await expect(
      service.verify(' USER@example.com ', 'PASSWORD_RESET', '000000'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 1,
          consumedAt: null,
          attempts: 0,
        }),
        data: { attempts: { increment: 1 } },
      }),
    );
  });

  it('consumes a matching code exactly once', async () => {
    findFirst.mockResolvedValue(createRecord('123456', { attempts: 2 }));
    const service = createService();

    await expect(
      service.verify('user@example.com', 'PASSWORD_RESET', '123456'),
    ).resolves.toMatchObject({ verificationToken: expect.any(String) });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 1,
          consumedAt: null,
          attempts: 2,
        }),
        data: expect.objectContaining({
          consumedAt: expect.any(Date),
          attempts: { increment: 1 },
          verificationHash: expect.stringMatching(/^[a-f0-9]{64}$/),
          verifiedUntil: expect.any(Date),
        }),
      }),
    );
  });

  it('allows registration proof to be consumed once', async () => {
    findFirst.mockResolvedValue(createRecord('123456'));
    const service = createService();
    const { verificationToken } = await service.verify(
      'user@example.com',
      'PASSWORD_RESET',
      '123456',
    );

    await expect(
      service.consumeVerification(
        'user@example.com',
        'PASSWORD_RESET',
        verificationToken,
      ),
    ).resolves.toBeUndefined();
    const proofHash = createHmac('sha256', secret)
      .update(JSON.stringify([
        'verification',
        'PASSWORD_RESET',
        'user@example.com',
        verificationToken,
      ]))
      .digest('hex');
    expect(updateMany).toHaveBeenLastCalledWith({
      where: {
        email: 'user@example.com',
        purpose: 'PASSWORD_RESET',
        verificationHash: proofHash,
        verifiedUntil: { gt: expect.any(Date) },
      },
      data: { verificationHash: null, verifiedUntil: null },
    });
  });

  it('rejects a missing or expired registration proof', async () => {
    updateMany.mockResolvedValue({ count: 0 });
    const service = createService();

    await expect(
      service.consumeVerification(
        'user@example.com',
        'REGISTRATION',
        'invalid-proof-token',
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects expired codes without attempting to consume them', async () => {
    findFirst.mockResolvedValue(
      createRecord('123456', {
        expiresAt: new Date(Date.now() - 1),
      }),
    );
    const service = createService();

    await expect(
      service.verify('user@example.com', 'PASSWORD_RESET', '123456'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('rejects a code if another request updated it concurrently', async () => {
    findFirst.mockResolvedValue(createRecord('123456'));
    updateMany.mockResolvedValue({ count: 0 });
    const service = createService();

    await expect(
      service.verify('user@example.com', 'PASSWORD_RESET', '123456'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
