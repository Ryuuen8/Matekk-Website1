import { IsDateString, IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class UpdateProfileDto {
    @IsOptional() @IsString() @MinLength(3) @MaxLength(30) @Matches(/^[a-zA-Z0-9._-]+$/)
    username?: string;

    @IsOptional() @IsString() @MaxLength(80)
    first_name?: string;

    @IsOptional() @IsString() @MaxLength(80)
    last_name?: string;

    @IsOptional() @IsEmail() @MaxLength(254)
    email?: string | null;

    @IsOptional() @IsDateString()
    birth_date?: string;

    @IsOptional() @IsString() @MaxLength(40)
    gender?: string | null;

    @IsOptional() @IsString() @MaxLength(120)
    city_province?: string;

    @IsOptional() @IsString() @MaxLength(30)
    phone_number?: string | null;
}