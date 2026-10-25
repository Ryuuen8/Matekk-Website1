import { BadRequestException, InternalServerErrorException, ServiceUnavailableException } from '@nestjs/common';
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

  it('accepts a token only when Google confirms its action and score', async () => {
    getConfig.mockReturnValue('private-secret');
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      success: true,
      action: 'contact',
      score: 0.9,
    }), { status: 200 }));

    await expect(service.verify('captcha-token', 'contact')).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledWith(
      'https://www.google.com/recaptcha/api/siteverify',
      expect.objectContaining({
        method: 'POST',
        body: new URLSearchParams({
          secret: 'private-secret',
          response: 'captcha-token',
        }),
      }),
    );
  });

  it('rejects invalid tokens, mismatched actions, and low scores', async () => {
    getConfig.mockReturnValue('private-secret');
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      success: false,
      action: 'contact',
      score: 0.9,
    }), { status: 200 }));
    await expect(service.verify('invalid-token', 'contact')).rejects.toBeInstanceOf(BadRequestException);

    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      success: true,
      action: 'solutions_inquiry',
      score: 0.9,
    }), { status: 200 }));
    await expect(service.verify('captcha-token', 'contact')).rejects.toBeInstanceOf(BadRequestException);

    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      success: true,
      action: 'contact',
      score: 0.4,
    }), { status: 200 }));
    await expect(service.verify('captcha-token', 'contact')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('fails explicitly when the secret is missing', async () => {
    getConfig.mockReturnValue(undefined);

    await expect(service.verify('captcha-token', 'contact')).rejects.toBeInstanceOf(InternalServerErrorException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects when Google cannot be reached', async () => {
    getConfig.mockReturnValue('private-secret');
    fetchMock.mockRejectedValue(new Error('Google is unavailable'));

    await expect(service.verify('captcha-token', 'contact')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
