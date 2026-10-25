import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CaptchaService } from '../captcha/captcha.service.js';
import { InquiresService } from './inquires.service.js';

describe('InquiresService', () => {
  let service: InquiresService;
  const findUnique = vi.fn();
  const updateMany = vi.fn();
  const transaction = vi.fn();
  const createInquiry = vi.fn();
  const verifyCaptcha = vi.fn();

  beforeEach(async () => {
    updateMany.mockReset();
    findUnique.mockReset();
    transaction.mockReset();
    createInquiry.mockReset();
    verifyCaptcha.mockReset();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InquiresService,
        { provide: CaptchaService, useValue: { verify: verifyCaptcha } },
        {
          provide: PrismaService,
          useValue: { inquires: { create: createInquiry, findUnique, updateMany }, $transaction: transaction },
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

  it('does not store an inquiry if CAPTCHA verification fails', async () => {
    verifyCaptcha.mockRejectedValue(new Error('CAPTCHA rejected'));

    await expect(service.create({
      captchaToken: 'invalid-token',
      inquiry_type: 'Training Inquiry',
      name: 'A learner',
      email: 'learner@example.com',
      phone: '09171234567',
      subject: 'Training',
      message: 'Please send details.',
    })).rejects.toThrow('CAPTCHA rejected');
    expect(createInquiry).not.toHaveBeenCalled();
  });

  it('accepts an inquiry by marking it resolved', async () => {
    findUnique.mockResolvedValue({
      id: 42,
      inquiry_type: 'Training Inquiry',
      project_desc: null,
      status: true,
    });
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
    findUnique.mockResolvedValue(null);

    await expect(service.accept(404)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('enrolls the requested student and resolves the request atomically', async () => {
    findUnique.mockResolvedValue({
      id: 42,
      inquiry_type: 'Enrollment Request',
      project_desc: 'Account ID: 12; Program ID: 4',
      status: true,
    });
    const userFindUnique = vi.fn(async () => ({ id: 12 }));
    const programFindUnique = vi.fn(async () => ({ id: 4, parentId: null }));
    const enrollmentFindMany = vi.fn(async () => []);
    const enrollmentCreate = vi.fn(async () => ({ userId: 12, programId: 4 }));
    const inquiryUpdate = vi.fn(async () => ({ id: 42, status: false }));
    transaction.mockImplementation(async (callback) => callback({
      users: { findUnique: userFindUnique },
      program: { findUnique: programFindUnique },
      enrollment: { findMany: enrollmentFindMany, create: enrollmentCreate },
      inquires: { update: inquiryUpdate },
    }));

    await expect(service.accept(42)).resolves.toEqual({
      inquiryId: 42,
      status: false,
    });

    expect(enrollmentCreate).toHaveBeenCalledWith({
      data: { userId: 12, programId: 4 },
    });
    expect(inquiryUpdate).toHaveBeenCalledWith({
      where: { id: 42 },
      data: { status: false },
    });
  });

  it('keeps an enrollment request open when the student already has overlapping access', async () => {
    findUnique.mockResolvedValue({
      id: 42,
      inquiry_type: 'Enrollment Request',
      project_desc: 'Account ID: 12; Program ID: 4',
      status: true,
    });
    transaction.mockImplementation(async (callback) => callback({
      users: { findUnique: vi.fn(async () => ({ id: 12 })) },
      program: { findUnique: vi.fn(async () => ({ id: 4, parentId: null })) },
      enrollment: {
        findMany: vi.fn(async () => [{ program: { id: 6, parentId: 4 } }]),
        create: vi.fn(),
      },
      inquires: { update: vi.fn() },
    }));

    await expect(service.accept(42)).rejects.toBeInstanceOf(ConflictException);
  });
});
