import { BadRequestException, InternalServerErrorException, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { CaptchaService } from './captcha.service.js';

describe('CaptchaService', () => {
  let service: CaptchaService;
  const fetchMock = vi.fn<typeof fetch>();
  const getConfig = vi.fn();

  beforeEach(async () => {
    fetchMock.mockReset();
    getConfig.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CaptchaService,
        { provide: ConfigService, useValue: { get: getConfig } },
      ],
    }).compile();
    service = module.get<CaptchaService>(CaptchaService);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('accepts a token when hCaptcha confirms it', async () => {
    getConfig.mockReturnValue('private-secret');
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      success: true,
    }), { status: 200 }));

    await expect(service.verify('captcha-token')).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.hcaptcha.com/siteverify',
      expect.objectContaining({
        method: 'POST',
        body: new URLSearchParams({
          secret: 'private-secret',
          response: 'captcha-token',
        }),
      }),
    );
  });

  it('rejects tokens that hCaptcha does not accept', async () => {
    getConfig.mockReturnValue('private-secret');
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      success: false,
    }), { status: 200 }));
    await expect(service.verify('invalid-token')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('logs hCaptcha error codes without logging the token or secret', async () => {
    getConfig.mockReturnValue('private-secret');
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      success: false,
      'error-codes': ['timeout-or-duplicate'],
    }), { status: 200 }));
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    await expect(service.verify('invalid-token')).rejects.toBeInstanceOf(BadRequestException);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('hCaptcha verification rejected: {"reasons":["provider-rejected"],"errorCodes":["timeout-or-duplicate"]}'),
    );
    expect(warn.mock.calls[0][0]).not.toContain('invalid-token');
    expect(warn.mock.calls[0][0]).not.toContain('private-secret');
    warn.mockRestore();
  });

  it('fails explicitly when the secret is missing', async () => {
    getConfig.mockReturnValue(undefined);

    await expect(service.verify('captcha-token')).rejects.toBeInstanceOf(InternalServerErrorException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects when hCaptcha cannot be reached', async () => {
    getConfig.mockReturnValue('private-secret');
    fetchMock.mockRejectedValue(new Error('hCaptcha is unavailable'));

    await expect(service.verify('captcha-token')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
