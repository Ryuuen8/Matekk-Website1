import { Module } from '@nestjs/common';
import { GradebookController } from './gradebook.controller.js';
import { GradebookService } from './gradebook.service.js';
import { UsersModule } from '../users/users.module.js';

@Module({
  imports: [UsersModule],
  controllers: [GradebookController],
  providers: [GradebookService],
  exports: [GradebookService],
})
export class GradebookModule {}
