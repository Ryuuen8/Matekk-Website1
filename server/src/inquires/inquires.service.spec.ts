import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { InquiresService } from './inquires.service.js';

describe('InquiresService', () => {
  let service: InquiresService;
  const findUnique = vi.fn();
  const updateMany = vi.fn();
  const transaction = vi.fn();

  beforeEach(async () => {
    updateMany.mockReset();
    findUnique.mockReset();
    transaction.mockReset();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InquiresService,
        {
          provide: PrismaService,
          useValue: { inquires: { findUnique, updateMany }, $transaction: transaction },
        },
      ],
    }).compile();

    service = module.get<InquiresService>(InquiresService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
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
