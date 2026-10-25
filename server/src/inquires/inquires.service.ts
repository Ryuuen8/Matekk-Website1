import { Injectable, NotFoundException } from '@nestjs/common';
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
