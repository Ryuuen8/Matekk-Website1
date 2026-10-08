import { IsEmail, Matches } from 'class-validator';

export class VerifyRegistrationEmailDto {
  @IsEmail()
  email: string;

  @Matches(/^\d{6}$/)
  code: string;
}
