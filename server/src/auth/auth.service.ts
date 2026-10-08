
import { BadRequestException, ConflictException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { UsersService } from '../users/users.service.js';
import { JwtService } from '@nestjs/jwt'
import { PasswordService } from './password.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RegisterDto } from './dto/register.dto.js';
import { EmailService } from '../email/email.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { OtpService } from './otp/otp.service.js';

@Injectable()
export class AuthService {
    private readonly logger = new Logger(AuthService.name);

    constructor(private readonly usersService: UsersService,
        private readonly jwtService: JwtService,
        private readonly passwords: PasswordService,
        private readonly prisma: PrismaService,
        private readonly emailService: EmailService,
        private readonly otpService: OtpService,
    ) { }

    findRegistrationPrograms() {
        return this.prisma.program.findMany({
            where: { parentId: null },
            select: {
                id: true,
                name: true,
                training: { select: { id: true, name: true } },
                modules: { select: { id: true, name: true }, orderBy: { name: 'asc' } },
            },
            orderBy: [{ training: { name: 'asc' } }, { name: 'asc' }],
        });
    }

    async requestRegistrationEmailOtp(email: string): Promise<void> {
        const normalizedEmail = email.trim().toLowerCase();
        const exists = await this.prisma.users.findFirst({
            where: { email: { equals: normalizedEmail, mode: 'insensitive' } },
            select: { id: true },
        });
        if (exists) {
            throw new ConflictException('An account with this email already exists.');
        }
        await this.otpService.request(normalizedEmail, 'REGISTRATION');
    }

    verifyRegistrationEmail(email: string, code: string) {
        return this.otpService.verify(email, 'REGISTRATION', code);
    }

    async register(dto: RegisterDto) {
        const normalizedUsername = dto.username.trim();
        const normalizedEmail = dto.email.trim().toLowerCase();
        const normalizedFirstName = dto.firstName.trim();
        const normalizedLastName = dto.lastName.trim();

        if (!normalizedUsername || !normalizedEmail || !normalizedFirstName || !normalizedLastName) {
            throw new BadRequestException('Please complete all required registration fields.');
        }

        const exists = await this.prisma.users.findFirst({
            where: { OR: [{ username: { equals: normalizedUsername, mode: 'insensitive' } }, { email: { equals: normalizedEmail, mode: 'insensitive' } }] }
        });
        if (exists) throw new ConflictException('Username or email already in use');

        await this.otpService.consumeVerification(
            normalizedEmail,
            'REGISTRATION',
            dto.verificationToken,
        );

        const password = await this.passwords.hash(dto.password);

        try {
            await this.prisma.users.create({
                data: {
                    username: normalizedUsername,
                    email: normalizedEmail,
                    password,
                    role: 'Student',
                    programs_enrolled: '',
                    first_name: normalizedFirstName,
                    last_name: normalizedLastName,
                    birth_date: dto.birthdate ? new Date(dto.birthdate) : new Date(),
                    gender: dto.gender ?? null,
                    city_province: dto.city ?? '',
                    active_status: false,
                    pending_status: 'Pending',
                    enrollments: { create: { programId: dto.programId } },
                },
            });
        } catch (error) {
            if (
                error instanceof Prisma.PrismaClientKnownRequestError &&
                error.code === 'P2002'
            ) {
                throw new ConflictException('Username or email already in use');
            }
            throw error;
        }

        const applicant = {
            name: `${normalizedFirstName} ${normalizedLastName}`,
            email: normalizedEmail,
        };
        const notifications = await Promise.allSettled([
            this.emailService.sendUserStatusEmail(applicant, 'pending'),
            this.emailService.sendAdminNotification(applicant),
        ]);
        notifications.forEach((result, index) => {
            if (result.status === 'rejected') {
                const notification = index === 0 ? 'applicant pending-status email' : 'admin registration notification';
                this.logger.error(`Unable to send ${notification}.`, String(result.reason));
            }
        });

        return { message: 'Registration submitted. Please wait for approval.' }
    }

    async signIn(
        username: string,
        pass: string,
    ): Promise<{ requiresOtp: true; maskedEmail: string }> {
        const user = await this.usersService.findOne(username);
        if (!user) {
            throw new UnauthorizedException();
        }

        const hasArgon2Hash = /^\$argon2(?:id|i|d)\$/.test(user.password);
        const isValidPassword = hasArgon2Hash
            ? await this.passwords.verify(user.password, pass)
            : user.password === pass;
        if (!isValidPassword) {
            throw new UnauthorizedException();
        }

        if (!hasArgon2Hash || this.passwords.needsRehash(user.password)) {
            const upgradedPassword = await this.passwords.hash(pass);
            await this.prisma.users.update({
                where: { id: user.userId },
                data: { password: upgradedPassword },
            });
        }

        const normalizedEmail = user.email?.trim().toLowerCase();
        const [localPart, domain] = normalizedEmail?.split('@') ?? [];
        if (!normalizedEmail || !localPart || !domain) {
            throw new UnauthorizedException('Email verification is unavailable for this account.');
        }
        await this.otpService.request(normalizedEmail, 'LOGIN');
        const maskedEmail = `${localPart.slice(0, 1)}${'*'.repeat(Math.min(Math.max(localPart.length - 1, 3), 8))}@${domain}`;
        return { requiresOtp: true, maskedEmail };
    }

    async verifySignInOtp(
        username: string,
        code: string,
    ): Promise<{ access_token: string }> {
        const user = await this.usersService.findOne(username);
        if (!user?.email) {
            throw new UnauthorizedException('Invalid or expired verification code.');
        }
        const { verificationToken } = await this.otpService.verify(
            user.email,
            'LOGIN',
            code,
        );
        await this.otpService.consumeVerification(
            user.email,
            'LOGIN',
            verificationToken,
        );

        const session = await this.prisma.users.update({
            where: { id: user.userId },
            data: { sessionVersion: { increment: 1 } },
            select: { sessionVersion: true },
        });
        const payload = {
            username: user.username,
            sub: user.userId,
            sessionVersion: session.sessionVersion,
        };

        return { access_token: await this.jwtService.signAsync(payload), };
    }

    async invalidateSession(userId: number): Promise<void> {
        await this.prisma.users.update({
            where: { id: userId },
            data: { sessionVersion: { increment: 1 } },
            select: { id: true },
        });
    }

    async getProfile(username: string) {
        const user = await this.usersService.findOne(username);
        if (!user) {
            throw new UnauthorizedException();
        }

        const { password: _password, sessionVersion: _sessionVersion, ...profile } = user;
        return profile;
    }
}
