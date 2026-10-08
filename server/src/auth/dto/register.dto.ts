import { Type } from 'class-transformer';
import { IsDateString, IsEmail, IsInt, IsOptional, IsString, Length, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
    @IsString() @Length(3, 30)
    username: string;

    @IsEmail()
    email: string;

    @IsString() @Length(40, 100)
    verificationToken: string;

    @IsString() @MinLength(10) @MaxLength(128)
    password: string;

    @Type(() => Number)
    @IsInt()
    programId: number;

    @IsString() @Length(1, 80)
    firstName: string;

    @IsString() @Length(1, 80)
    lastName: string;

    @IsOptional() @IsDateString()
    birthdate?: string;

    @IsOptional() @IsString() @MaxLength(40)
    gender?: string;

    @IsOptional() @IsString() @MaxLength(120)
    city?: string;
}