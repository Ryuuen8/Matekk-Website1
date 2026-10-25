import {
    BadRequestException,
    ConflictException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { CreateInquirtDto } from './dto/create-inquirt.dto.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CaptchaService } from '../captcha/captcha.service.js';

@Injectable()
export class InquiresService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly captchaService: CaptchaService,
    ) { }

    async create(data: CreateInquirtDto) {
        const { captchaToken, ...inquiry } = data;
        const action = data.inquiry_type === 'Training Inquiry'
            ? 'training_inquiry'
            : 'solutions_inquiry';
        await this.captchaService.verify(captchaToken, action);
        return this.prisma.inquires.create({ data: inquiry });
    }

    findAll() {
        return this.prisma.inquires.findMany();
    }

    async accept(inquiryId: number): Promise<{ inquiryId: number; status: false }> {
        const inquiry = await this.prisma.inquires.findUnique({
            where: { id: inquiryId },
        });
        if (!inquiry) {
            throw new NotFoundException('Inquiry not found.');
        }
        if (!inquiry.status) {
            return { inquiryId, status: false };
        }

        if (inquiry.inquiry_type === 'Enrollment Request') {
            const metadata = /^Account ID: ([1-9]\d*); Program ID: ([1-9]\d*)$/.exec(
                inquiry.project_desc ?? '',
            );
            if (!metadata) {
                throw new BadRequestException('The enrollment request has invalid account or program details.');
            }

            const userId = Number(metadata[1]);
            const programId = Number(metadata[2]);
            if (!Number.isSafeInteger(userId) || !Number.isSafeInteger(programId)) {
                throw new BadRequestException('The enrollment request has invalid account or program details.');
            }

            await this.prisma.$transaction(async (transaction) => {
                const [user, program, existingEnrollments] = await Promise.all([
                    transaction.users.findUnique({
                        where: { id: userId },
                        select: { id: true },
                    }),
                    transaction.program.findUnique({
                        where: { id: programId },
                        select: { id: true, parentId: true },
                    }),
                    transaction.enrollment.findMany({
                        where: { userId },
                        include: { program: { select: { id: true, parentId: true } } },
                    }),
                ]);
                if (!user || !program) {
                    throw new NotFoundException('The student or requested program was not found.');
                }

                const overlappingEnrollment = existingEnrollments.some(({ program: enrolled }) =>
                    enrolled.id === program.id
                    || (program.parentId === null && enrolled.parentId === program.id)
                    || (program.parentId !== null && enrolled.id === program.parentId),
                );
                if (overlappingEnrollment) {
                    throw new ConflictException('The student is already enrolled in this program or its modules.');
                }

                await transaction.enrollment.create({
                    data: { userId, programId },
                });
                await transaction.inquires.update({
                    where: { id: inquiryId },
                    data: { status: false },
                });
            });

            return { inquiryId, status: false };
        }

        const result = await this.prisma.inquires.updateMany({
            where: { id: inquiryId },
            data: { status: false },
        });
        if (result.count === 0) {
            throw new NotFoundException('Inquiry not found.');
        }

        return { inquiryId, status: false };
    }
}
