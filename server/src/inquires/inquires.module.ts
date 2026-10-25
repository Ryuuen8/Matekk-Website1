import { Module } from '@nestjs/common';
import { InquiresController } from './inquires.controller.js';
import { InquiresService } from './inquires.service.js';
import { UsersModule } from '../users/users.module.js';
import { CaptchaModule } from '../captcha/captcha.module.js';

@Module({
  imports: [UsersModule, CaptchaModule],
  controllers: [InquiresController],
  providers: [InquiresService]
})
export class InquiresModule { }
