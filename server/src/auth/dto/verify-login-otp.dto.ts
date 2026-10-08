import { IsString, Length, Matches } from 'class-validator';

export class VerifyLoginOtpDto {
  @IsString()
  @Length(1, 128)
  username: string;

  @IsString()
  @Matches(/^\d{6}$/)
  code: string;
}
