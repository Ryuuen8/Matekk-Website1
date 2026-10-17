import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

function toProgramSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\+/g, ' plus ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function toLegacyProgramSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

@Injectable()
export class ProgramAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async assertEnrollment(userId: number, programKey: string): Promise<void> {
    const programs = await this.prisma.program.findMany({
      select: {
        id: true,
        name: true,
        parentId: true,
        parent: { select: { name: true, training: { select: { name: true } } } },
        training: { select: { name: true } },
      },
    });
    const program = this.findProgramByKey(programs, programKey);
    if (!program) {
      throw new NotFoundException('Program not found.');
    }

    await this.assertProgramEnrollment(userId, program.id, program.parentId);
  }

  async assertQuestionModuleEnrollment(
    userId: number,
    programKey: string,
    moduleName: string,
  ): Promise<void> {
    const programs = await this.prisma.program.findMany({
      select: {
        id: true,
        name: true,
        parentId: true,
        parent: { select: { name: true, training: { select: { name: true } } } },
        training: { select: { name: true } },
      },
    });
    const program = this.findProgramByKey(programs, programKey);
    if (!program) {
      throw new NotFoundException('Program not found.');
    }

    const permittedPrograms = program.parentId === null
      ? programs.filter((candidate) => candidate.parentId === program.id || candidate.id === program.id)
      : [program];
    const permittedModuleNames = permittedPrograms.flatMap((candidate) => {
      const trainingName = candidate.training?.name ??
        candidate.parent?.training?.name ??
        program.training?.name;
      return [
        candidate.name,
        ...(trainingName ? [`${trainingName} ${candidate.name}`] : []),
      ];
    });
    const normalizedModuleName = moduleName.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
    const isLegacyCcnaModule = programKey === 'ccna' &&
      /^ccna part \d+$/i.test(moduleName.trim());
    if (
      !isLegacyCcnaModule &&
      !permittedModuleNames.some((name) =>
        name.replace(/\s+/g, ' ').toLocaleLowerCase() === normalizedModuleName,
      )
    ) {
      throw new NotFoundException('Question module not found in this program.');
    }

    await this.assertProgramEnrollment(userId, program.id, program.parentId);
  }

  private findProgramByKey<T extends {
    id: number;
    name: string;
    parentId: number | null;
    parent: { name: string; training?: { name: string } | null } | null;
    training: { name: string } | null;
  }>(programs: T[], programKey: string): T | undefined {
    return programs.find((candidate) => {
      const acceptedKeys = new Set([
        toProgramSlug(candidate.name),
        toLegacyProgramSlug(candidate.name),
        ...(candidate.parent
          ? [
              toProgramSlug(`${candidate.parent.name} ${candidate.name}`),
              toLegacyProgramSlug(`${candidate.parent.name} ${candidate.name}`),
            ]
          : []),
        ...(candidate.training
          ? [
              toProgramSlug(`${candidate.training.name} ${candidate.name}`),
              toLegacyProgramSlug(`${candidate.training.name} ${candidate.name}`),
            ]
          : []),
      ]);
      return acceptedKeys.has(programKey);
    });
  }

  private async assertProgramEnrollment(
    userId: number,
    programId: number,
    parentId: number | null,
  ): Promise<void> {
    const user = await this.prisma.users.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (user?.role.trim().toLowerCase() === 'admin') {
      return;
    }

    const enrollment = await this.prisma.enrollment.findFirst({
      where: {
        userId,
        OR: [
          { programId },
          ...(parentId === null ? [] : [{ programId: parentId }]),
        ],
      },
      select: { programId: true },
    });

    if (!enrollment) {
      throw new ForbiddenException('Enrollment in this program is required.');
    }
  }
}
