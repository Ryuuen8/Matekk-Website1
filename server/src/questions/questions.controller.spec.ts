import { Test, TestingModule } from '@nestjs/testing';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { QuestionsController } from './questions.controller.js';
import { QuestionsService } from './questions.service.js';
import { AdminGuard } from '../auth/guards/admin.guard.js';
import { UsersService } from '../users/users.service.js';

describe('QuestionsController', () => {
  let controller: QuestionsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [QuestionsController],
      providers: [
        {
          provide: QuestionsService,
          useValue: { create: () => undefined, findAll: () => [] },
        },
        { provide: UsersService, useValue: { findOne: vi.fn() } },
      ],
    }).compile();

    controller = module.get<QuestionsController>(QuestionsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('restricts question-bank reads and writes to administrators', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, controller.createQuestion)).toContain(AdminGuard);
    expect(Reflect.getMetadata(GUARDS_METADATA, controller.findAll)).toContain(AdminGuard);
  });

  it('leaves student exam attempts available to authenticated accounts without the admin guard', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, controller.startExam)).toBeUndefined();
    expect(Reflect.getMetadata(GUARDS_METADATA, controller.resumeExam)).toBeUndefined();
    expect(Reflect.getMetadata(GUARDS_METADATA, controller.submitExam)).toBeUndefined();
  });
});
