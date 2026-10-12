import { BadRequestException } from '@nestjs/common';
import { GradebookController } from './gradebook.controller.js';
import { vi } from 'vitest';

describe('GradebookController', () => {
  const user = { userId: 7 };
  const programKey = 'ccna';
  const data = { assessments: { 'quiz:1': { id: 'quiz:1' } } };
  const assessment = { id: 'quiz:1', score: 8, maxScore: 10, submittedAt: 123 };

  function createController() {
    const gradebookService = {
      save: vi.fn().mockResolvedValue({ data }),
      saveAssessment: vi.fn().mockResolvedValue({ data }),
    };
    return {
      controller: new GradebookController(gradebookService as never),
      gradebookService,
    };
  }

  it('accepts gradebook data on both save routes', async () => {
    const { controller, gradebookService } = createController();

    await controller.save(user, programKey, { data });
    await controller.saveAssessment(user, programKey, { data });

    expect(gradebookService.save).toHaveBeenCalledTimes(2);
    expect(gradebookService.save).toHaveBeenCalledWith(user.userId, programKey, data);
    expect(gradebookService.saveAssessment).not.toHaveBeenCalled();
  });

  it('accepts one assessment on both save routes', async () => {
    const { controller, gradebookService } = createController();

    await controller.save(user, programKey, { assessment });
    await controller.saveAssessment(user, programKey, { assessment });

    expect(gradebookService.saveAssessment).toHaveBeenCalledTimes(2);
    expect(gradebookService.saveAssessment).toHaveBeenCalledWith(
      user.userId,
      programKey,
      assessment,
    );
    expect(gradebookService.save).not.toHaveBeenCalled();
  });

  it('rejects missing or conflicting payloads', () => {
    const { controller } = createController();

    expect(() => controller.save(user, programKey, {})).toThrow(BadRequestException);
    expect(() => controller.saveAssessment(user, programKey, { data, assessment }))
      .toThrow(BadRequestException);
  });
});
