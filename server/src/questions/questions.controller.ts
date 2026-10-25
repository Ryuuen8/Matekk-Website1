import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Query,
  Request,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import type { Request as ExpressRequest } from 'express';
import { QuestionsService } from './questions.service.js';
import { CreateQuestionDto, SubmitExamDto } from './dto/questions.dto.js';
import { AdminGuard } from '../auth/guards/admin.guard.js';

@Controller('questions')
export class QuestionsController {
  constructor(private readonly questionsService: QuestionsService) {}

  @Post()
  @UseGuards(AdminGuard)
  createQuestion(@Body() createQuestionDto: CreateQuestionDto) {
    return this.questionsService.create(createQuestionDto);
  }

  @Get()
  @UseGuards(AdminGuard)
  findAll() {
    return this.questionsService.findAll();
  }

  // These routes inherit the global JWT and active-account guards, but not the admin-only bank guard.
  @Post('exams/:examKey/start')
  @Header('Cache-Control', 'no-store')
  startExam(
    @Param('examKey') examKey: string,
    @Request() request: ExpressRequest & { user: { userId: number } },
    @Query('module') moduleName?: string,
    @Query('programKey') programKey?: string,
  ) {
    return this.questionsService.startExam(
      examKey,
      request.user.userId,
      moduleName,
      programKey,
    );
  }

  @Get('exams/:examKey/attempt/:attemptId')
  @Header('Cache-Control', 'no-store')
  resumeExam(
    @Param('examKey') examKey: string,
    @Param('attemptId') attemptId: string,
    @Request() request: ExpressRequest & { user: { userId: number } },
  ) {
    return this.questionsService.resumeExam(examKey, attemptId, request.user.userId);
  }

  @Post('exams/:examKey/attempt/:attemptId/submit')
  @Header('Cache-Control', 'no-store')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  submitExam(
    @Param('examKey') examKey: string,
    @Param('attemptId') attemptId: string,
    @Request() request: ExpressRequest & { user: { userId: number } },
    @Body() submitExamDto: SubmitExamDto,
  ) {
    return this.questionsService.submitExam(
      examKey,
      attemptId,
      request.user.userId,
      submitExamDto.answers,
    );
  }
}
