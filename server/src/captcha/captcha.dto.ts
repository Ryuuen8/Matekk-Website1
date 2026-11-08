import { IsIn, IsOptional, IsString, Length } from 'class-validator';

export class VerifyCaptchaDto {
  @IsString()
  @Length(1, 4096)
  captchaToken: string;

  @IsOptional()
  @IsIn(['contact'])
  captchaAction: 'contact';
}
