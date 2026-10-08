import { IsEmail } from 'class-validator';

export class RegistrationEmailOtpDto {
  @IsEmail()
  email: string;
}
