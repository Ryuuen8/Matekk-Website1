import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { EmailService } from '../email/email.service.js';

export type User = {
    userId: number;
    username: string;
    password: string;
    role: string;
    active_status: boolean;
    sessionVersion: number;
    pending_status?: string;
    email?: string;
    first_name?: string;
    last_name?: string;
    birth_date?: Date;
    gender?: string | null;
    city_province?: string;
    phone_number?: string | null;
    profile_photo?: string | null;
    expiration_date?: Date | null;
    module_enrolled?: string;
    course_enrolled?: string[];
};

function getEnrolledProgramNames(
    enrollments: Array<{
        program: { name: string; parentId: number | null; modules: Array<{ name: string }> };
    }>,
    legacyPrograms: string | null | undefined,
): string | undefined {
    const names = [...new Set(
        enrollments
            .flatMap(({ program }) => program.parentId === null
                ? [program.name, ...program.modules.map((module) => module.name)]
                : [program.name])
            .map((name) => name.trim())
            .filter(Boolean),
    )];

    return names.length > 0 ? names.join(', ') : legacyPrograms || undefined;
}

@Injectable()
export class UsersService {
    private readonly logger = new Logger(UsersService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly emailService: EmailService,
    ) {}

    async findAll(): Promise<Omit<User, 'password' | 'sessionVersion'>[]> {
        const databaseUsers = await this.prisma.users.findMany({
            select: {
                id: true,
                username: true,
                email: true,
                role: true,
                active_status: true,
                expiration_date: true,
                programs_enrolled: true,
                enrollments: {
                    select: {
                        program: {
                            select: {
                                name: true,
                                parentId: true,
                                modules: { select: { name: true } },
                            },
                        },
                    },
                },
            },
        });

        return databaseUsers.map((user) => ({
                userId: user.id,
                username: user.username,
                email: user.email ?? undefined,
                role: user.role,
                active_status: user.active_status,
                expiration_date: user.expiration_date ?? null,
                pending_status: user.active_status ? 'Active' : 'Pending',
                module_enrolled: getEnrolledProgramNames(user.enrollments, user.programs_enrolled),
            }));
    }

    async approve(
        userId: number,
    ): Promise<{ userId: number; active_status: true; expiration_date: Date | null }> {
        const user = await this.prisma.users.findUnique({
            where: { id: userId },
            select: {
                active_status: true,
                expiration_date: true,
                role: true,
                email: true,
                first_name: true,
                last_name: true,
                username: true,
            },
        });
        if (!user) {
            throw new NotFoundException('User not found.');
        }

        const isAdmin = user.role.trim().toLowerCase() === 'admin';
        const expirationDate = isAdmin
            ? null
            : user.active_status
                ? user.expiration_date
                : addMonthsClamped(new Date(), 3);

        // Only send approval email when the account transitions from pending to active.
        const result = user.active_status
            ? { count: 0 }
            : await this.prisma.users.updateMany({
                where: { id: userId, active_status: false },
                data: { active_status: true, expiration_date: expirationDate },
            });

        if (!user.active_status && result.count > 0) {
            if (!user.email) {
                this.logger.warn('Approved user has no email address; approval email was not sent.');
            } else {
                try {
                    const name = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username;
                    await this.emailService.sendUserStatusEmail({ name, email: user.email }, 'accepted');
                } catch (error) {
                    this.logger.error(
                        'Unable to send account approval email.',
                        error instanceof Error ? error.stack : String(error),
                    );
                }
            }
        }

        return { userId, active_status: true, expiration_date: expirationDate };
    }

    async findOne(username: string): Promise<User | undefined> {
        const databaseUser = await this.prisma.users.findFirst({
            where: { username: { equals: username.trim(), mode: 'insensitive' } },
            select: {
                id: true,
                username: true,
                password: true,
                role: true,
                active_status: true,
                expiration_date: true,
                sessionVersion: true,
                email: true,
                first_name: true,
                last_name: true,
                birth_date: true,
                gender: true,
                city_province: true,
                phone_number: true,
                profile_photo: true,
                programs_enrolled: true,
                enrollments: {
                    select: {
                        program: {
                            select: {
                                name: true,
                                parentId: true,
                                modules: { select: { name: true } },
                            },
                        },
                    },
                },
            },
        });

        if (!databaseUser) {
            return undefined;
        }

        return {
            userId: databaseUser.id,
            username: databaseUser.username,
            password: databaseUser.password,
            role: databaseUser.role,
            active_status: databaseUser.active_status,
            expiration_date: databaseUser.expiration_date ?? null,
            sessionVersion: databaseUser.sessionVersion,
            pending_status: databaseUser.active_status ? 'Active' : 'Pending',
            email: databaseUser.email ?? undefined,
            first_name: databaseUser.first_name,
            last_name: databaseUser.last_name,
            birth_date: databaseUser.birth_date,
            gender: databaseUser.gender,
            city_province: databaseUser.city_province,
            phone_number: databaseUser.phone_number,
            profile_photo: databaseUser.profile_photo,
            module_enrolled: getEnrolledProgramNames(
                databaseUser.enrollments,
                databaseUser.programs_enrolled,
            ),
        };
    }

    async findById(userId: number): Promise<User | undefined> {
        const databaseUser = await this.prisma.users.findUnique({
            where: { id: userId },
            select: {
                id: true,
                username: true,
                password: true,
                role: true,
                active_status: true,
                expiration_date: true,
                sessionVersion: true,
                email: true,
                first_name: true,
                last_name: true,
                birth_date: true,
                gender: true,
                city_province: true,
                phone_number: true,
                profile_photo: true,
                programs_enrolled: true,
                enrollments: {
                    select: {
                        program: {
                            select: {
                                name: true,
                                parentId: true,
                                modules: { select: { name: true } },
                            },
                        },
                    },
                },
            },
        });

        if (!databaseUser) return undefined;

        return {
            userId: databaseUser.id,
            username: databaseUser.username,
            password: databaseUser.password,
            role: databaseUser.role,
            active_status: databaseUser.active_status,
            expiration_date: databaseUser.expiration_date ?? null,
            sessionVersion: databaseUser.sessionVersion,
            pending_status: databaseUser.active_status ? 'Active' : 'Pending',
            email: databaseUser.email ?? undefined,
            first_name: databaseUser.first_name,
            last_name: databaseUser.last_name,
            birth_date: databaseUser.birth_date,
            gender: databaseUser.gender,
            city_province: databaseUser.city_province,
            phone_number: databaseUser.phone_number,
            profile_photo: databaseUser.profile_photo,
            module_enrolled: getEnrolledProgramNames(
                databaseUser.enrollments,
                databaseUser.programs_enrolled,
            ),
        };
    }

    async findAuthUserById(
        userId: number,
    ): Promise<{
        userId: number;
        username: string;
        active_status: boolean;
        sessionVersion: number;
        expiration_date: Date | null;
        role: string;
    } | undefined> {
        const databaseUser = await this.prisma.users.findUnique({
            where: { id: userId },
            select: {
                id: true,
                username: true,
                active_status: true,
                sessionVersion: true,
                expiration_date: true,
                role: true,
            },
        });

        if (!databaseUser) {
            return undefined;
        }

        return {
            userId: databaseUser.id,
            username: databaseUser.username,
            active_status: databaseUser.active_status,
            sessionVersion: databaseUser.sessionVersion,
            expiration_date: databaseUser.expiration_date,
            role: databaseUser.role,
        };
    }
}

function addMonthsClamped(date: Date, months: number): Date {
    const result = new Date(date);
    const dayOfMonth = result.getUTCDate();
    result.setUTCDate(1);
    result.setUTCMonth(result.getUTCMonth() + months);
    const lastDayOfMonth = new Date(Date.UTC(
        result.getUTCFullYear(),
        result.getUTCMonth() + 1,
        0,
    )).getUTCDate();
    result.setUTCDate(Math.min(dayOfMonth, lastDayOfMonth));
    return result;
}
