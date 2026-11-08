import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type HcaptchaVerificationResponse = {
  success?: boolean;
  'error-codes'?: unknown;
};

@Injectable()
export class CaptchaService {
  private readonly logger = new Logger(CaptchaService.name);

  constructor(private readonly config: ConfigService) {}

  async verify(captchaToken: string): Promise<void> {
    const secret = this.config.get<string>('HCAPTCHA_SECRET_KEY')?.trim();
    if (!secret) {
      throw new InternalServerErrorException('CAPTCHA verification is not configured.');
    }

    let response: Response;
    try {
      response = await fetch('https://api.hcaptcha.com/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ secret, response: captchaToken }),
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      throw new ServiceUnavailableException('CAPTCHA verification is temporarily unavailable.');
    }

    if (!response.ok) {
      throw new ServiceUnavailableException('CAPTCHA verification is temporarily unavailable.');
    }

    let result: HcaptchaVerificationResponse;
    try {
      const body: unknown = await response.json();
      if (!body || typeof body !== 'object' || !('success' in body)) {
        throw new Error('Invalid CAPTCHA verification response.');
      }
      result = body as HcaptchaVerificationResponse;
    } catch {
      throw new ServiceUnavailableException('CAPTCHA verification returned an invalid response.');
    }

    if (result.success !== true) {
      const errorCodes = Array.isArray(result['error-codes'])
        ? result['error-codes'].filter(
          (code): code is string => typeof code === 'string' && /^[a-z0-9-]{1,64}$/i.test(code),
        )
        : [];
      const reasons = ['provider-rejected'];
      this.logger.warn(`hCaptcha verification rejected: ${JSON.stringify({ reasons, errorCodes })}`);
      throw new BadRequestException('CAPTCHA verification failed. Please complete it again.');
    }
  }
}
