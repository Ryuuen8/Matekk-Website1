import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CaptchaController } from './captcha.controller.js';
import { CaptchaService } from './captcha.service.js';

@Module({
  imports: [ConfigModule],
  controllers: [CaptchaController],
  providers: [CaptchaService],
  exports: [CaptchaService],
})
export class CaptchaModule {}
