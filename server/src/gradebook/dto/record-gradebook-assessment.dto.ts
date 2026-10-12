import { IsObject } from 'class-validator';

export class RecordGradebookAssessmentDto {
  @IsObject()
  assessment: Record<string, unknown>;
}
