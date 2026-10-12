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
    return this.savePayload(user.userId, this.validateProgramKey(programKey), body);
  }

  @Post(':programKey/assessments')
  saveAssessment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('programKey') programKey: string,
    @Body() body: SaveGradebookDto,
  ) {
    return this.savePayload(user.userId, this.validateProgramKey(programKey), body);
  }

  private savePayload(
    userId: number,
    programKey: string,
    body: SaveGradebookDto,
  ) {
    if (body.data && body.assessment) {
      throw new BadRequestException('Provide either gradebook data or one assessment, not both.');
    }
    if (body.data) {
      return this.gradebookService.save(userId, programKey, body.data);
    }
    if (body.assessment) {
      return this.gradebookService.saveAssessment(userId, programKey, body.assessment);
    }
    throw new BadRequestException('Provide gradebook data or one assessment to save.');
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
