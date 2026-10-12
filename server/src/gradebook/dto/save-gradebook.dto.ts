import { IsObject, IsOptional } from 'class-validator';

export class SaveGradebookDto {
  @IsOptional()
  @IsObject()
  data?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  assessment?: Record<string, unknown>;
}
