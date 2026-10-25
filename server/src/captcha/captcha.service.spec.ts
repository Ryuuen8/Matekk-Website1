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

  it('asks Google to verify the submitted token', async () => {
    getConfig.mockReturnValue('private-secret');
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));

    await expect(service.verify('captcha-token')).resolves.toBeUndefined();

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

  it('rejects tokens Google does not accept', async () => {
    getConfig.mockReturnValue('private-secret');
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ success: false }), { status: 200 }));

    await expect(service.verify('invalid-token')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('fails explicitly if the production secret is not configured', async () => {
    getConfig.mockReturnValue(undefined);

    await expect(service.verify('captcha-token')).rejects.toBeInstanceOf(InternalServerErrorException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports verification service failures without accepting the token', async () => {
    getConfig.mockReturnValue('private-secret');
    fetchMock.mockRejectedValue(new Error('Google is unavailable'));

    await expect(service.verify('captcha-token')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
