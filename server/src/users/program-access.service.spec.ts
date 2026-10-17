import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProgramAccessService } from './program-access.service.js';

describe('ProgramAccessService', () => {
  const findFirst = vi.fn();
  const programFindMany = vi.fn();
  const userFindUnique = vi.fn();
  const service = new ProgramAccessService({
    enrollment: { findFirst },
    program: { findMany: programFindMany },
    users: { findUnique: userFindUnique },
  } as unknown as PrismaService);

  beforeEach(() => {
    findFirst.mockReset();
    programFindMany.mockReset();
    userFindUnique.mockReset().mockResolvedValue({ role: 'Student' });
  });

  it('allows an enrolled module and a learner enrolled in its parent program', async () => {
    programFindMany.mockResolvedValue([
      {
        id: 22,
        name: 'CCNA Automation',
        parentId: 10,
        parent: { name: 'CCNA' },
        training: null,
      },
    ]);
    findFirst.mockResolvedValue({ programId: 10 });

    await expect(service.assertEnrollment(7, 'ccna-automation')).resolves.toBeUndefined();
    expect(findFirst).toHaveBeenCalledWith({
      where: { userId: 7, OR: [{ programId: 22 }, { programId: 10 }] },
      select: { programId: true },
    });
  });

  it('allows a direct enrollment in the requested program', async () => {
    programFindMany.mockResolvedValue([
      { id: 10, name: 'CCNA', parentId: null, parent: null, training: { name: 'Cisco' } },
    ]);
    findFirst.mockResolvedValue({ programId: 10 });

    await expect(service.assertEnrollment(7, 'ccna')).resolves.toBeUndefined();
  });

  it.each([
    ['Network+', 'comptia-network-plus'],
    ['Security+', 'comptia-security-plus'],
  ])('resolves CompTIA training keys for %s gradebooks', async (name, programKey) => {
    programFindMany.mockResolvedValue([
      { id: 31, name, parentId: null, parent: null, training: { name: 'CompTIA' } },
    ]);
    findFirst.mockResolvedValue({ programId: 31 });

    await expect(service.assertEnrollment(7, programKey)).resolves.toBeUndefined();
    expect(findFirst).toHaveBeenCalledWith({
      where: { userId: 7, OR: [{ programId: 31 }] },
      select: { programId: true },
    });
  });

  it('only allows a module bank associated with the requested program', async () => {
    programFindMany.mockResolvedValue([
      { id: 31, name: 'Network+', parentId: null, parent: null, training: { name: 'CompTIA' } },
      { id: 32, name: 'Security+', parentId: null, parent: null, training: { name: 'CompTIA' } },
    ]);
    findFirst.mockResolvedValue({ programId: 31 });

    await expect(service.assertQuestionModuleEnrollment(
      7,
      'comptia-network-plus',
      'CompTIA Network+',
    )).resolves.toBeUndefined();

    await expect(service.assertQuestionModuleEnrollment(
      7,
      'comptia-network-plus',
      'CompTIA Security+',
    )).rejects.toBeInstanceOf(NotFoundException);
    expect(findFirst).toHaveBeenCalledTimes(1);
  });

  it('allows admins to access a program gradebook without learner enrollment', async () => {
    programFindMany.mockResolvedValue([
      { id: 10, name: 'CCNA', parentId: null, parent: null, training: { name: 'Cisco' } },
    ]);
    userFindUnique.mockResolvedValue({ role: ' Admin ' });

    await expect(service.assertEnrollment(7, 'ccna')).resolves.toBeUndefined();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('rejects users without enrollment in the requested program', async () => {
    programFindMany.mockResolvedValue([
      {
        id: 22,
        name: 'CCNA Automation',
        parentId: 10,
        parent: { name: 'CCNA' },
        training: null,
      },
    ]);
    findFirst.mockResolvedValue(null);

    await expect(service.assertEnrollment(7, 'ccna-automation'))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects keys that do not resolve to a program', async () => {
    programFindMany.mockResolvedValue([]);

    await expect(service.assertEnrollment(7, 'ccna-automation'))
      .rejects.toBeInstanceOf(NotFoundException);
    expect(findFirst).not.toHaveBeenCalled();
  });
});
