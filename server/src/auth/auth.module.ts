import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { PasswordService } from './password.service.js';
import { UsersModule } from '../users/users.module.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { ActiveAccountGuard } from './guards/active-account.guard.js';
import { JwtStrategy } from './strategies/jwt.strategy.js';
import { EmailModule } from '../email/email.module.js';
import { ConfigService } from '@nestjs/config';
import { LoginRateLimitService } from './login-rate-limit.service.js';
import { OtpService } from './otp/otp.service.js';
import { RateLimitService } from './rate-limit.service.js';

@Module({
  imports: [
    UsersModule,
    EmailModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: config.get('JWT_EXPIRES_IN', '24h'),
          algorithm: 'HS256',
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    LoginRateLimitService,
    OtpService,
    RateLimitService,
    JwtStrategy,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: ActiveAccountGuard },
  ],
  exports: [AuthService, OtpService],
})
export class AuthModule { }
