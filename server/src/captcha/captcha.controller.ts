import { Body, Controller, Post } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator.js';
import { VerifyCaptchaDto } from './captcha.dto.js';
import { CaptchaService } from './captcha.service.js';

@Controller('captcha')
export class CaptchaController {
  constructor(private readonly captchaService: CaptchaService) {}

  @Public()
  @Post('verify')
  async verify(@Body() body: VerifyCaptchaDto): Promise<{ success: true }> {
    await this.captchaService.verify(body.captchaToken, body.captchaAction);
    return { success: true };
  }
}
