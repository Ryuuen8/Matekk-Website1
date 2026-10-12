import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { RecordGradebookAssessmentDto } from './dto/record-gradebook-assessment.dto.js';
import type { SaveGradebookDto } from './dto/save-gradebook.dto.js';
import { GradebookService } from './gradebook.service.js';

interface AuthenticatedUser {
  userId: number;
}

@Controller('gradebook')
export class GradebookController {
  constructor(private readonly gradebookService: GradebookService) {}

  @Get(':programKey')
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('programKey') programKey: string,
  ) {
    return this.gradebookService.findOne(user.userId, this.validateProgramKey(programKey));
  }

  @Put(':programKey')
  save(
    @CurrentUser() user: AuthenticatedUser,
    @Param('programKey') programKey: string,
    @Body() body: SaveGradebookDto,
  ) {
    return this.gradebookService.save(
      user.userId,
      this.validateProgramKey(programKey),
      body?.data,
    );
  }

  @Post(':programKey/assessments')
  saveAssessment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('programKey') programKey: string,
    @Body() body: RecordGradebookAssessmentDto,
  ) {
    return this.gradebookService.saveAssessment(
      user.userId,
      this.validateProgramKey(programKey),
      body.assessment,
    );
  }

  private validateProgramKey(programKey: string): string {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(programKey)) {
      throw new BadRequestException(
        'Program key must be a lowercase slug containing letters, numbers, and hyphens.',
      );
    }

    return programKey;
  }
}
