import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProgramAccessService } from '../users/program-access.service.js';

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

@Injectable()
export class GradebookService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly programAccess: ProgramAccessService,
  ) {}

  async findOne(userId: number, programKey: string) {
    await this.programAccess.assertEnrollment(userId, programKey);
    return this.prisma.userGradebook.findUnique({
      where: {
        userId_programKey: {
          userId,
          programKey,
        },
      },
      select: {
        data: true,
        updatedAt: true,
      },
    });
  }

  async save(userId: number, programKey: string, data: unknown) {
    await this.programAccess.assertEnrollment(userId, programKey);
    if (!isJsonObject(data)) {
      throw new BadRequestException('Gradebook data must be a JSON object.');
    }

    let jsonData: Prisma.InputJsonObject;
    try {
      const serialized = JSON.stringify(data);
      jsonData = JSON.parse(serialized) as Prisma.InputJsonObject;
    } catch {
      throw new BadRequestException('Gradebook data must contain valid JSON values.');
    }

    if (isJsonObject(jsonData.assessments)) {
      return this.mergeAssessments(userId, programKey, jsonData);
    }

    return this.prisma.userGradebook.upsert({
      where: {
        userId_programKey: {
          userId,
          programKey,
        },
      },
      create: {
        userId,
        programKey,
        data: jsonData,
      },
      update: { data: jsonData },
      select: {
        data: true,
        updatedAt: true,
      },
    });
  }

  async recordAssessment(
    userId: number,
    programKey: string,
    assessment: Record<string, unknown>,
  ) {
    if (typeof assessment.id !== 'string' || !assessment.id) {
      throw new BadRequestException('A gradebook assessment must include an ID.');
    }

    let jsonAssessment: Prisma.InputJsonObject;
    try {
      jsonAssessment = JSON.parse(JSON.stringify(assessment)) as Prisma.InputJsonObject;
    } catch {
      throw new BadRequestException('Gradebook assessments must contain valid JSON values.');
    }

    return this.mergeAssessments(userId, programKey, {
      assessments: { [assessment.id]: jsonAssessment },
    });
  }

  private async mergeAssessments(
    userId: number,
    programKey: string,
    data: Prisma.InputJsonObject,
  ) {
    const existing = await this.prisma.userGradebook.findUnique({
      where: { userId_programKey: { userId, programKey } },
      select: { data: true },
    });
    const existingData = isJsonObject(existing?.data) ? existing.data : {};
    const existingAssessments = isJsonObject(existingData.assessments)
      ? existingData.assessments
      : {};
    const jsonData: Prisma.InputJsonObject = {
      ...existingData,
      ...data,
      assessments: {
        ...existingAssessments,
        ...(data.assessments as Prisma.InputJsonObject),
      },
    };

    return this.prisma.userGradebook.upsert({
      where: { userId_programKey: { userId, programKey } },
      create: { userId, programKey, data: jsonData },
      update: { data: jsonData },
      select: { data: true, updatedAt: true },
    });
  }
}
