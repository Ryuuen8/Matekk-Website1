import { IsEmail, IsIn, IsOptional, IsString, Length, MaxLength } from 'class-validator';

export class CreateInquirtDto {
    @IsString()
    @Length(1, 4096)
    captchaToken: string;

    @IsIn(['Training Inquiry', 'ICT Solutions Inquiry'])
    inquiry_type: 'Training Inquiry' | 'ICT Solutions Inquiry';

    @IsString()
    @Length(1, 160)
    name: string;

    @IsEmail()
    @MaxLength(254)
    email: string;

    @IsString()
    @Length(1, 40)
    phone: string;

    @IsString()
    @Length(1, 200)
    subject: string;

    @IsString()
    @Length(1, 5000)
    message: string;

    @IsOptional()
    @IsString()
    @MaxLength(120)
    funding?: string;

    @IsOptional()
    @IsString()
    @MaxLength(120)
    attendees?: string;

    @IsOptional()
    @IsString()
    @MaxLength(200)
    course?: string;

    @IsOptional()
    @IsString()
    @MaxLength(200)
    service_interest?: string;

    @IsOptional()
    @IsString()
    @MaxLength(120)
    project_scale?: string;

    @IsOptional()
    @IsString()
    @MaxLength(120)
    timeline?: string;

    @IsOptional()
    @IsString()
    @MaxLength(120)
    budget?: string;

    @IsOptional()
    @IsString()
    @MaxLength(5000)
    project_desc?: string;

    @IsOptional()
    @IsString()
    @MaxLength(5000)
    tech_specs?: string;
}