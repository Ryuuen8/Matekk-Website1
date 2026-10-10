import { PrismaService } from '../prisma/prisma.service.js';
import { GradebookService } from './gradebook.service.js';
import { vi } from 'vitest';

describe('GradebookService', () => {
  it('merges assessment updates without replacing previously saved results', async () => {
    let savedData: Record<string, unknown> | null = null;
    const findUnique = vi.fn(async () => savedData ? { data: savedData } : null);
    const upsert = vi.fn(async ({ update }: {
      update: { data: Record<string, unknown> };
    }) => {
      savedData = update.data;
      return { data: savedData, updatedAt: new Date() };
    });
    const prisma = {
      userGradebook: { findUnique, upsert },
    } as unknown as PrismaService;
    const programAccess = { assertEnrollment: vi.fn(async () => undefined) };
    const service = new GradebookService(prisma, programAccess as never);

    await service.save(12, 'ccna', {
      assessments: {
        'quiz:1.0:1': { id: 'quiz:1.0:1', score: 8 },
      },
    });
    await service.save(12, 'ccna', {
      assessments: {
        'exam:attempt-1': { id: 'exam:attempt-1', score: 40 },
      },
    });

    expect(savedData).toEqual({
      assessments: {
        'quiz:1.0:1': { id: 'quiz:1.0:1', score: 8 },
        'exam:attempt-1': { id: 'exam:attempt-1', score: 40 },
      },
    });
    expect(findUnique).toHaveBeenCalledTimes(2);
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(programAccess.assertEnrollment).toHaveBeenCalledTimes(2);
  });

  it('records an assessment by ID without replacing other assessments', async () => {
    let savedData: Record<string, unknown> | null = {
      assessments: {
        'quiz:1': { id: 'quiz:1', score: 8 },
      },
    };
    const findUnique = vi.fn(async () => ({ data: savedData }));
    const upsert = vi.fn(async ({ update }: {
      update: { data: Record<string, unknown> };
    }) => {
      savedData = update.data;
      return { data: savedData, updatedAt: new Date() };
    });
    const service = new GradebookService(
      { userGradebook: { findUnique, upsert } } as unknown as PrismaService,
      { assertEnrollment: vi.fn(async () => undefined) } as never,
    );

    await service.recordAssessment(12, 'ccna', {
      id: 'attempt-1',
      type: 'exam',
      score: 40,
    });

    expect(savedData).toEqual({
      assessments: {
        'quiz:1': { id: 'quiz:1', score: 8 },
        'attempt-1': { id: 'attempt-1', type: 'exam', score: 40 },
      },
    });
    expect(findUnique).toHaveBeenCalledOnce();
    expect(upsert).toHaveBeenCalledOnce();
  });

  it('rejects assessments without a stable ID', async () => {
    const service = new GradebookService(
      { userGradebook: { findUnique: vi.fn(), upsert: vi.fn() } } as unknown as PrismaService,
      { assertEnrollment: vi.fn(async () => undefined) } as never,
    );

    await expect(service.recordAssessment(12, 'ccna', { score: 40 }))
      .rejects.toThrow('A gradebook assessment must include an ID.');
  });

  it('checks course enrollment before reading a gradebook', async () => {
    const assertEnrollment = vi.fn(async () => undefined);
    const findUnique = vi.fn(async () => null);
    const service = new GradebookService(
      { userGradebook: { findUnique } } as unknown as PrismaService,
      { assertEnrollment } as never,
    );

    await service.findOne(12, 'ccna');

    expect(assertEnrollment).toHaveBeenCalledWith(12, 'ccna');
    expect(findUnique).toHaveBeenCalled();
  });

  it('does not read or write a gradebook when enrollment is denied', async () => {
    const findUnique = vi.fn();
    const upsert = vi.fn();
    const service = new GradebookService(
      { userGradebook: { findUnique, upsert } } as unknown as PrismaService,
      {
        assertEnrollment: vi.fn(async () => {
          throw new Error('not enrolled');
        }),
      } as never,
    );

    await expect(service.findOne(12, 'ccna')).rejects.toThrow('not enrolled');
    await expect(service.save(12, 'ccna', { assessments: {} })).rejects.toThrow('not enrolled');
    expect(findUnique).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });
});
