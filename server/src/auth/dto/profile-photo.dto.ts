import { IsString, MaxLength, Matches } from 'class-validator';

export class ProfilePhotoDto {
    @IsString()
    @MaxLength(2_800_000)
    @Matches(/^data:image\/(?:jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/)
    photoDataUrl: string;
}