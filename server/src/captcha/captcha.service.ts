import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type RecaptchaVerificationResponse = {
  success?: boolean;
};

@Injectable()
export class CaptchaService {
  constructor(private readonly config: ConfigService) {}

  async verify(captchaToken: string): Promise<void> {
    const secret = this.config.get<string>('RECAPTCHA_SECRET_KEY')?.trim();
    if (!secret) {
      throw new InternalServerErrorException('CAPTCHA verification is not configured.');
    }

    let response: Response;
    try {
      response = await fetch('https://www.google.com/recaptcha/api/siteverify', {
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

    let result: RecaptchaVerificationResponse;
    try {
      const body: unknown = await response.json();
      if (!body || typeof body !== 'object' || !('success' in body)) {
        throw new Error('Invalid CAPTCHA verification response.');
      }
      result = body as RecaptchaVerificationResponse;
    } catch {
      throw new ServiceUnavailableException('CAPTCHA verification returned an invalid response.');
    }

    if (result.success !== true) {
      throw new BadRequestException('CAPTCHA verification failed. Please complete it again.');
    }
  }
}
