import { Controller, Get, Header } from '@nestjs/common';
import { QuestionsService } from './questions.service.js';

// The CCNA question bank (the "Questions" table) for students taking the exams.
// No AdminGuard here: the app-wide guards already require a signed-in, approved account.
@Controller('questions/bank')
export class QuestionBankController {
  constructor(private readonly questionsService: QuestionsService) {}

  @Get()
  @Header('Cache-Control', 'private, max-age=300')
  findBank() {
    return this.questionsService.findBank();
  }
}
