import { Type } from 'class-transformer';
import { IsEmail, IsInt, IsString, Length, MaxLength, Min } from 'class-validator';

export class EnrollmentRequestDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  programId: number;

  @IsEmail()
  @MaxLength(254)
  email: string;

  @IsString()
  @Length(1, 40)
  phone: string;
}
