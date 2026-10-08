import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { LoginRateLimitService } from './login-rate-limit.service.js';
import { RateLimitService } from './rate-limit.service.js';
import {
  ACCESS_TOKEN_COOKIE,
  accessTokenCookieOptions,
} from './auth-cookie.js';

describe('AuthController', () => {
  let controller: AuthController;
  const signIn = vi.fn();
  const invalidateSession = vi.fn();
  const consume = vi.fn();
  const consumeOtpRateLimit = vi.fn();
  const requestRegistrationEmailOtp = vi.fn();
  const verifyRegistrationEmail = vi.fn();

  beforeEach(async () => {
    signIn.mockReset();
    invalidateSession.mockReset();
    consume.mockReset();
    consumeOtpRateLimit.mockReset();
    requestRegistrationEmailOtp.mockReset();
    verifyRegistrationEmail.mockReset();
    signIn.mockResolvedValue({ access_token: 'signed-token' });
    invalidateSession.mockResolvedValue(undefined);
    consume.mockResolvedValue(true);
    consumeOtpRateLimit.mockResolvedValue(undefined);
    requestRegistrationEmailOtp.mockResolvedValue(undefined);
    verifyRegistrationEmail.mockResolvedValue({ verificationToken: 'proof' });
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: {
            signIn,
            invalidateSession,
            requestRegistrationEmailOtp,
            verifyRegistrationEmail,
          },
        },
        { provide: LoginRateLimitService, useValue: { consume } },
        { provide: RateLimitService, useValue: { consume: consumeOtpRateLimit } },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('rate-limits and sends registration email verification codes', async () => {
    await expect(controller.requestRegistrationEmailOtp(
      { email: ' Student@Example.com ' },
      { ip: '192.0.2.1', socket: { remoteAddress: '192.0.2.1' } } as never,
    )).resolves.toEqual({
      message: 'A verification code was sent to your email.',
    });

    expect(consumeOtpRateLimit).toHaveBeenCalledWith(
      [
        'registration-otp:email:student@example.com',
        'registration-otp:ip:192.0.2.1',
      ],
      3,
      15 * 60 * 1000,
    );
    expect(requestRegistrationEmailOtp).toHaveBeenCalledWith('student@example.com');
  });

  it('returns a verification proof after checking the registration code', async () => {
    await expect(controller.verifyRegistrationEmail(
      { email: 'student@example.com', code: '123456' },
    )).resolves.toEqual({ verificationToken: 'proof' });

    expect(verifyRegistrationEmail).toHaveBeenCalledWith(
      'student@example.com',
      '123456',
    );
  });

  it('sets the HttpOnly session cookie after a rate-limited login succeeds', async () => {
    const cookie = vi.fn();
    const response = { cookie };

    await expect(
      controller.signIn(
        { username: 'student', password: 'password' },
        { ip: '192.0.2.1', socket: { remoteAddress: '192.0.2.1' } } as never,
        response as never,
      ),
    ).resolves.toEqual({ message: 'Signed in.' });

    expect(consume).toHaveBeenCalledWith('192.0.2.1', 'student');
    expect(signIn).toHaveBeenCalledWith('student', 'password');
    expect(cookie).toHaveBeenCalledWith(
      ACCESS_TOKEN_COOKIE,
      'signed-token',
      expect.objectContaining({ httpOnly: true, sameSite: 'lax' }),
    );
  });

  it('allows production session cookies to be sent cross-origin over HTTPS', () => {
    vi.stubEnv('NODE_ENV', 'production');
    try {
      expect(accessTokenCookieOptions()).toMatchObject({
        httpOnly: true,
        secure: true,
        sameSite: 'none',
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('invalidates the authenticated account session on logout', async () => {
    const clearCookie = vi.fn();

    await expect(controller.logout(
      { user: { userId: 12 } } as never,
      { clearCookie } as never,
    )).resolves.toEqual({ message: 'Signed out.' });

    expect(invalidateSession).toHaveBeenCalledWith(12);
    expect(clearCookie).toHaveBeenCalledWith(
      ACCESS_TOKEN_COOKIE,
      expect.objectContaining({ path: '/' }),
    );
  });

  it('does not authenticate when the rate limit is exceeded', async () => {
    consume.mockResolvedValue(false);

    await expect(
      controller.signIn(
        { username: 'student', password: 'password' },
        { ip: '192.0.2.1', socket: { remoteAddress: '192.0.2.1' } } as never,
        { cookie: vi.fn() } as never,
      ),
    ).rejects.toThrow('Too many login attempts.');

    expect(signIn).not.toHaveBeenCalled();
  });
});
