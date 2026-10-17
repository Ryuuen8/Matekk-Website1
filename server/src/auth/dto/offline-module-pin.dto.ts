import { IsString, Matches } from 'class-validator';

export class OfflineModulePinDto {
  @IsString()
  @Matches(/^\d{4,6}$/)
  pin: string;
}
