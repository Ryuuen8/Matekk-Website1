import {
    Body,
    Controller,
    Post,
    Patch,
    Put,
    Delete,
    HttpCode,
    HttpStatus,
    Request,
    Get,
    Res,
    HttpException,
    Header,
    UnauthorizedException,
    ForbiddenException,
    ServiceUnavailableException,
    UsePipes,
    ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'node:crypto';
import { AuthService } from './auth.service.js';
import { Public } from './decorators/public.decorator.js';
import { AllowPendingAccount } from './decorators/allow-pending.decorator.js';
import type { Request as ExpressRequest, Response } from 'express';
import { RegisterDto } from './dto/register.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { LoginRateLimitService } from './login-rate-limit.service.js';
import { accessTokenCookieOptions, ACCESS_TOKEN_COOKIE } from './auth-cookie.js';
import { RegistrationEmailOtpDto } from './dto/registration-email-otp.dto.js';
import { VerifyRegistrationEmailDto } from './dto/verify-registration-email.dto.js';
import { RateLimitService } from './rate-limit.service.js';
import { VerifyLoginOtpDto } from './dto/verify-login-otp.dto.js';
import { ChangePasswordDto } from './dto/change-password.dto.js';
import { UpdateProfileDto } from './dto/profile.dto.js';
import { ProfilePhotoDto } from './dto/profile-photo.dto.js';
import { OfflineModulePinDto } from './dto/offline-module-pin.dto.js';
import { EnrollmentRequestDto } from './dto/enrollment-request.dto.js';

@Controller('auth')
export class AuthController {
    constructor(
        private readonly authService: AuthService,
        private readonly loginRateLimit: LoginRateLimitService,
        private readonly rateLimit: RateLimitService,
        private readonly configService: ConfigService,
    ) { }

    @Public()
    @Get('programs')
    findRegistrationPrograms() {
        return this.authService.findRegistrationPrograms();
    }

    @Post('enrollment-requests')
    @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
    createEnrollmentRequest(
        @Request() request: ExpressRequest & { user: { userId: number } },
        @Body() dto: EnrollmentRequestDto,
    ) {
        return this.authService.createEnrollmentRequest(request.user.userId, dto);
    }

    @Public()
    @HttpCode(HttpStatus.OK)
    @Post('register/email-otp')
    async requestRegistrationEmailOtp(
        @Body() dto: RegistrationEmailOtpDto,
        @Request() request: ExpressRequest,
    ) {
        const email = dto.email.trim().toLowerCase();
        await this.rateLimit.consume(
            [
                `registration-otp:email:${email}`,
                `registration-otp:ip:${request.ip ?? request.socket.remoteAddress ?? 'unknown'}`,
            ],
            3,
            15 * 60 * 1000,
        );
        const emailSent = await this.authService.requestRegistrationEmailOtp(email);
        return {
            message: emailSent
                ? 'A verification code was sent to your email.'
                : 'A valid verification code was already sent. Please use that code.',
            emailSent,
        };
    }

    @Public()
    @HttpCode(HttpStatus.OK)
    @Post('register/verify-email')
    verifyRegistrationEmail(@Body() dto: VerifyRegistrationEmailDto) {
        return this.authService.verifyRegistrationEmail(dto.email, dto.code);
    }

    @Public()
    @Post('register')
    register(@Body() registerDto: RegisterDto) {
        return this.authService.register(registerDto);
    }

    @Public()
    @HttpCode(HttpStatus.OK)
    @Post('login')
    async signIn(
        @Body() signInDto: LoginDto,
        @Request() request: ExpressRequest,
    ) {
        const allowed = await this.loginRateLimit.consume(
            request.ip ?? request.socket.remoteAddress ?? 'unknown',
            signInDto.username,
        );
        if (!allowed) {
            throw new HttpException(
                'Too many login attempts. Please try again later.',
                HttpStatus.TOO_MANY_REQUESTS,
            );
        }

        return this.authService.signIn(
            signInDto.username,
            signInDto.password,
        );
    }

    @Public()
    @HttpCode(HttpStatus.OK)
    @Post('login/verify-otp')
    async verifySignInOtp(
        @Body() dto: VerifyLoginOtpDto,
        @Request() request: ExpressRequest,
        @Res({ passthrough: true }) response: Response,
    ) {
        const allowed = await this.loginRateLimit.consume(
            request.ip ?? request.socket.remoteAddress ?? 'unknown',
            dto.username,
        );
        if (!allowed) {
            throw new HttpException(
                'Too many login attempts. Please try again later.',
                HttpStatus.TOO_MANY_REQUESTS,
            );
        }

        const { access_token: token } = await this.authService.verifySignInOtp(
            dto.username,
            dto.code,
        );
        response.cookie(ACCESS_TOKEN_COOKIE, token, accessTokenCookieOptions());
        return { message: 'Signed in.' };
    }

    @HttpCode(HttpStatus.OK)
    @Post('logout')
    @AllowPendingAccount()
    async logout(
        @Request() request: ExpressRequest & { user: { userId: number } },
        @Res({ passthrough: true }) response: Response,
    ) {
        await this.authService.invalidateSession(request.user.userId);
        response.clearCookie(ACCESS_TOKEN_COOKIE, accessTokenCookieOptions());
        return { message: 'Signed out.' };
    }

    @Header('Cache-Control', 'no-store')
    @HttpCode(HttpStatus.OK)
    @Post('offline-pin/verify')
    @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
    async verifyOfflineModulePin(
        @Body() pinDto: OfflineModulePinDto,
        @Request() request: ExpressRequest & { user: { role?: string } },
    ) {
        if (request.user.role?.trim().toLowerCase() !== 'admin') {
            throw new ForbiddenException('Only administrators can set up offline module access.');
        }

        const configuredPin = this.configService.get<string>('OFFLINE_MODULE_PIN');
        if (!configuredPin) {
            throw new ServiceUnavailableException('Offline module PIN is not configured.');
        }

        const allowed = await this.loginRateLimit.consume(
            request.ip ?? request.socket.remoteAddress ?? 'unknown',
            'offline-module-pin',
        );
        if (!allowed) {
            throw new HttpException(
                'Too many offline PIN attempts. Please try again later.',
                HttpStatus.TOO_MANY_REQUESTS,
            );
        }

        const submittedHash = createHash('sha256').update(pinDto.pin).digest();
        const configuredHash = createHash('sha256').update(configuredPin).digest();
        if (!timingSafeEqual(submittedHash, configuredHash)) {
            throw new UnauthorizedException('The shared offline PIN is incorrect.');
        }
        return { message: 'Offline PIN verified.' };
    }

    @Header('Cache-Control', 'no-store')
    @Get('profile')
    @AllowPendingAccount()
    getProfile(@Request() req: ExpressRequest & { user: unknown }) {
        const { username } = req.user as { username: string };
        return this.authService.getProfile(username);
    }

    @Header('Cache-Control', 'no-store')
    @Patch('profile')
    @AllowPendingAccount()
    updateProfile(
        @Request() req: ExpressRequest & { user: { userId: number } },
        @Body() dto: UpdateProfileDto,
    ) {
        return this.authService.updateProfile(req.user.userId, dto);
    }

    @Header('Cache-Control', 'no-store')
    @Get('profile/photo')
    @AllowPendingAccount()
    getProfilePhoto(@Request() req: ExpressRequest & { user: { userId: number } }) {
        return this.authService.getProfilePhoto(req.user.userId);
    }

    @HttpCode(HttpStatus.OK)
    @Put('profile/photo')
    @AllowPendingAccount()
    updateProfilePhoto(
        @Request() req: ExpressRequest & { user: { userId: number } },
        @Body() dto: ProfilePhotoDto,
    ) {
        return this.authService.updateProfilePhoto(req.user.userId, dto);
    }

    @HttpCode(HttpStatus.OK)
    @Delete('profile/photo')
    @AllowPendingAccount()
    removeProfilePhoto(@Request() req: ExpressRequest & { user: { userId: number } }) {
        return this.authService.removeProfilePhoto(req.user.userId);
    }

    @HttpCode(HttpStatus.OK)
    @Patch('change-password')
    @AllowPendingAccount()
    changePassword(
        @Request() req: ExpressRequest & { user: { userId: number } },
        @Body() dto: ChangePasswordDto,
    ) {
        return this.authService.changePassword(req.user.userId, dto);
    }

    @Header('Cache-Control', 'no-store')
    @Get('learning-history')
    @AllowPendingAccount()
    getLearningHistory(@Request() req: ExpressRequest & { user: { userId: number } }) {
        return this.authService.getLearningHistory(req.user.userId);
    }
}
