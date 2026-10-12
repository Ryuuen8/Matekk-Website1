import { GradebookController } from './gradebook.controller.js';
import { vi } from 'vitest';

describe('GradebookController', () => {
  function createController() {
    const gradebookService = {
      findOne: vi.fn(),
      save: vi.fn(),
      saveAssessment: vi.fn(),
    };
    return {
      controller: new GradebookController(gradebookService as never),
      gradebookService,
    };
  }

  it('saves gradebook data through the PUT route', async () => {
    const { controller, gradebookService } = createController();
    const data = { assessments: { 'quiz:1:attempt-1': { id: 'quiz:1:attempt-1' } } };

    await controller.save({ userId: 7 }, 'ccna', { data });

    expect(gradebookService.save).toHaveBeenCalledWith(7, 'ccna', data);
    expect(gradebookService.saveAssessment).not.toHaveBeenCalled();
  });

  it('saves an individual assessment through the POST assessment route', async () => {
    const { controller, gradebookService } = createController();
    const assessment = {
      id: 'quiz:1:attempt-1',
      score: 8,
      maxScore: 10,
      submittedAt: 123,
    };

    await controller.saveAssessment(
      { userId: 7 },
      'ccna',
      { assessment },
    );

    expect(gradebookService.saveAssessment).toHaveBeenCalledWith(7, 'ccna', assessment);
    expect(gradebookService.save).not.toHaveBeenCalled();
  });
});
