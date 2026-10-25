
import { BadRequestException, ConflictException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { UsersService } from '../users/users.service.js';
import { JwtService } from '@nestjs/jwt';
import { PasswordService } from './password.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RegisterDto } from './dto/register.dto.js';
import { UpdateProfileDto } from './dto/profile.dto.js';
import { ChangePasswordDto } from './dto/change-password.dto.js';
import { ProfilePhotoDto } from './dto/profile-photo.dto.js';
import { EnrollmentRequestDto } from './dto/enrollment-request.dto.js';
import { EmailService } from '../email/email.service.js';
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

    async createEnrollmentRequest(userId: number, dto: EnrollmentRequestDto) {
        const email = dto.email.trim().toLowerCase();
        const phone = dto.phone.trim();
        const [user, program] = await Promise.all([
            this.prisma.users.findUnique({
                where: { id: userId },
                select: {
                    username: true,
                    first_name: true,
                    last_name: true,
                    role: true,
                },
            }),
            this.prisma.program.findUnique({
                where: { id: dto.programId },
                include: {
                    training: { select: { name: true } },
                    parent: {
                        include: { training: { select: { name: true } } },
                    },
                },
            }),
        ]);
        if (!user) throw new UnauthorizedException();
        if (user.role.trim().toLowerCase() === 'admin') {
            throw new BadRequestException('Administrators cannot submit student enrollment requests.');
        }
        if (!program) throw new BadRequestException('Select an available program.');

        const enrollments = await this.prisma.enrollment.findMany({
            where: { userId },
            include: { program: { select: { id: true, parentId: true } } },
        });
        const alreadyEnrolled = enrollments.some(({ program: enrolledProgram }) =>
            enrolledProgram.id === program.id
            || (program.parentId === null && enrolledProgram.parentId === program.id)
            || (program.parentId !== null && enrolledProgram.id === program.parentId),
        );
        if (alreadyEnrolled) {
            throw new ConflictException('You are already enrolled in this program.');
        }

        const projectDescription = `Account ID: ${userId}; Program ID: ${program.id}`;
        const existingRequest = await this.prisma.inquires.findFirst({
            where: {
                inquiry_type: 'Enrollment Request',
                project_desc: projectDescription,
                status: true,
            },
            select: { id: true },
        });
        if (existingRequest) {
            throw new ConflictException('You already have a pending request for this program.');
        }

        const courseName = program.parent
            ? `${program.parent.name} - ${program.name}`
            : program.name;
        const fullName = `${user.first_name} ${user.last_name}`.trim() || user.username;
        await this.prisma.inquires.create({
            data: {
                inquiry_type: 'Enrollment Request',
                name: fullName,
                email,
                phone,
                subject: `Enrollment request: ${courseName}`,
                course: courseName,
                message: `${fullName} requested enrollment in ${courseName}.`,
                project_desc: projectDescription,
            },
        });
        return { message: 'Enrollment request submitted for administrator review.' };
    }

    async requestRegistrationEmailOtp(email: string): Promise<boolean> {
        const normalizedEmail = email.trim().toLowerCase();
        const exists = await this.prisma.users.findFirst({
            where: { email: { equals: normalizedEmail, mode: 'insensitive' } },
            select: { id: true },
        });
        if (exists) {
            throw new ConflictException('An account with this email already exists.');
        }
        return this.otpService.request(normalizedEmail, 'REGISTRATION');
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
    ): Promise<{ requiresOtp: true; maskedEmail: string; emailSent: boolean }> {
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
        const emailSent = await this.otpService.request(normalizedEmail, 'LOGIN');
        const maskedEmail = `${localPart.slice(0, 1)}${'*'.repeat(Math.min(Math.max(localPart.length - 1, 3), 8))}@${domain}`;
        return { requiresOtp: true, maskedEmail, emailSent };
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

        return { access_token: await this.jwtService.signAsync(payload) };
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

    async getProfileById(userId: number) {
        const user = await this.usersService.findById(userId);
        if (!user) throw new UnauthorizedException();

        const { password: _password, sessionVersion: _sessionVersion, ...profile } = user;
        return profile;
    }

    async getProfilePhoto(userId: number) {
        const user = await this.prisma.users.findUnique({
            where: { id: userId },
            select: { profile_photo: true },
        });
        if (!user) throw new UnauthorizedException();
        return { photoDataUrl: user.profile_photo };
    }

    async updateProfile(userId: number, dto: UpdateProfileDto) {
        const normalize = (value: string | null | undefined) =>
            typeof value === 'string' ? value.trim() : value;
        const username = normalize(dto.username);
        const email = normalize(dto.email);
        if (username) {
            const existingUser = await this.prisma.users.findFirst({
                where: { username: { equals: username, mode: 'insensitive' }, NOT: { id: userId } },
                select: { id: true },
            });
            if (existingUser) throw new ConflictException('Username is already in use.');
        }
        if (email) {
            const existingUser = await this.prisma.users.findFirst({
                where: { email: { equals: email, mode: 'insensitive' }, NOT: { id: userId } },
                select: { id: true },
            });
            if (existingUser) throw new ConflictException('Email address is already in use.');
        }

        const data = {
            ...(dto.username !== undefined ? { username: dto.username.trim() } : {}),
            ...(dto.first_name !== undefined ? { first_name: normalize(dto.first_name) ?? '' } : {}),
            ...(dto.last_name !== undefined ? { last_name: normalize(dto.last_name) ?? '' } : {}),
            ...(dto.email !== undefined ? { email } : {}),
            ...(dto.birth_date !== undefined ? { birth_date: new Date(dto.birth_date) } : {}),
            ...(dto.gender !== undefined ? { gender: normalize(dto.gender) || null } : {}),
            ...(dto.city_province !== undefined ? { city_province: normalize(dto.city_province) ?? '' } : {}),
            ...(dto.phone_number !== undefined ? { phone_number: normalize(dto.phone_number) || null } : {}),
        };

        try {
            await this.prisma.users.update({
                where: { id: userId },
                data,
            });
        } catch (error) {
            if (
                error instanceof Prisma.PrismaClientKnownRequestError
                && error.code === 'P2002'
            ) {
                throw new ConflictException('Username or email address is already in use.');
            }
            if (
                error instanceof Prisma.PrismaClientKnownRequestError
                && error.code === 'P2025'
            ) {
                throw new UnauthorizedException();
            }
            throw error;
        }
        return this.getProfileById(userId);
    }

    async updateProfilePhoto(userId: number, dto: ProfilePhotoDto) {
        const commaIndex = dto.photoDataUrl.indexOf(',');
        const mediaType = dto.photoDataUrl.slice(0, commaIndex);
        const encodedImage = dto.photoDataUrl.slice(commaIndex + 1);
        const image = Buffer.from(encodedImage, 'base64');
        const isJpeg = mediaType === 'data:image/jpeg;base64'
            && image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff;
        const isPng = mediaType === 'data:image/png;base64'
            && image.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
        if (
            image.length === 0
            || image.length > 2 * 1024 * 1024
            || image.toString('base64') !== encodedImage
            || (!isJpeg && !isPng)
        ) {
            throw new BadRequestException('Profile photo must be a valid JPG or PNG no larger than 2 MB.');
        }

        try {
            await this.prisma.users.update({
                where: { id: userId },
                data: { profile_photo: dto.photoDataUrl },
                select: { id: true },
            });
        } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
                throw new UnauthorizedException();
            }
            throw error;
        }

        return { message: 'Profile photo updated successfully.' };
    }

    async removeProfilePhoto(userId: number) {
        try {
            await this.prisma.users.update({
                where: { id: userId },
                data: { profile_photo: null },
                select: { id: true },
            });
        } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
                throw new UnauthorizedException();
            }
            throw error;
        }

        return { message: 'Profile photo removed successfully.' };
    }

    async changePassword(userId: number, dto: ChangePasswordDto) {
        const user = await this.prisma.users.findUnique({ where: { id: userId } });
        if (!user) throw new UnauthorizedException();

        const hasArgon2Hash = /^\$argon2(?:id|i|d)\$/.test(user.password);
        const isValidPassword = hasArgon2Hash
            ? await this.passwords.verify(user.password, dto.currentPassword)
            : user.password === dto.currentPassword;
        if (!isValidPassword) throw new UnauthorizedException('Current password is incorrect.');

        await this.prisma.users.update({
            where: { id: userId },
            data: {
                password: await this.passwords.hash(dto.newPassword),
                sessionVersion: { increment: 1 },
            },
        });

        return { message: 'Password updated successfully.' };
    }

    getLearningHistory(userId: number) {
        return this.prisma.enrollment.findMany({
            where: { userId },
            include: {
                program: {
                    include: {
                        training: { select: { name: true } },
                        parent: {
                            select: {
                                id: true,
                                name: true,
                                training: { select: { name: true } },
                            },
                        },
                    },
                },
            },
            orderBy: { enrolledAt: 'desc' },
        });
    }
}