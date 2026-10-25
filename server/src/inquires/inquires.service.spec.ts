import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CaptchaService } from '../captcha/captcha.service.js';
import { InquiresService } from './inquires.service.js';

describe('InquiresService', () => {
  let service: InquiresService;
  const updateMany = vi.fn();
  const createInquiry = vi.fn();
  const verifyCaptcha = vi.fn();

  beforeEach(async () => {
    updateMany.mockReset();
    createInquiry.mockReset();
    verifyCaptcha.mockReset();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InquiresService,
        { provide: CaptchaService, useValue: { verify: verifyCaptcha } },
        {
          provide: PrismaService,
          useValue: { inquires: { create: createInquiry, updateMany } },
        },
      ],
    }).compile();

    service = module.get<InquiresService>(InquiresService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('verifies the matching CAPTCHA action and does not store the token', async () => {
    createInquiry.mockResolvedValue({ id: 1 });
    const inquiry = {
      inquiry_type: 'Training Inquiry' as const,
      captchaToken: 'verified-token',
      name: 'A learner',
      email: 'learner@example.com',
      phone: '09171234567',
      subject: 'Training',
      message: 'Please send details.',
    };

    await expect(service.create(inquiry)).resolves.toEqual({ id: 1 });

    expect(verifyCaptcha).toHaveBeenCalledWith('verified-token', 'training_inquiry');
    expect(createInquiry).toHaveBeenCalledWith({
      data: {
        inquiry_type: 'Training Inquiry',
        name: 'A learner',
        email: 'learner@example.com',
        phone: '09171234567',
        subject: 'Training',
        message: 'Please send details.',
      },
    });
  });

  it('uses the solutions action for ICT inquiries', async () => {
    createInquiry.mockResolvedValue({ id: 2 });

    await service.create({
      inquiry_type: 'ICT Solutions Inquiry',
      captchaToken: 'verified-token',
      name: 'A client',
      email: 'client@example.com',
      phone: '09171234567',
      subject: 'Solutions',
      message: 'Please send details.',
    });

    expect(verifyCaptcha).toHaveBeenCalledWith('verified-token', 'solutions_inquiry');
  });

  it('accepts an inquiry by marking it resolved', async () => {
    updateMany.mockResolvedValue({ count: 1 });

    await expect(service.accept(42)).resolves.toEqual({
      inquiryId: 42,
      status: false,
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 42 },
      data: { status: false },
    });
  });

  it('reports when the inquiry does not exist', async () => {
    updateMany.mockResolvedValue({ count: 0 });

    await expect(service.accept(404)).rejects.toBeInstanceOf(NotFoundException);
  });
});
