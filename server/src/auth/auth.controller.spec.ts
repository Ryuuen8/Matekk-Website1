import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { LoginRateLimitService } from './login-rate-limit.service.js';
import {
  ACCESS_TOKEN_COOKIE,
  accessTokenCookieOptions,
} from './auth-cookie.js';

describe('AuthController', () => {
  let controller: AuthController;
  const signIn = vi.fn();
  const consume = vi.fn();

  beforeEach(async () => {
    signIn.mockReset();
    consume.mockReset();
    signIn.mockResolvedValue({ access_token: 'signed-token' });
    consume.mockResolvedValue(true);
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: { signIn } },
        { provide: LoginRateLimitService, useValue: { consume } },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
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
