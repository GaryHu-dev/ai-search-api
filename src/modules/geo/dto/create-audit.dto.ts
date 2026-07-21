import { ApiProperty } from '@nestjs/swagger';
import { IsUrl, MaxLength } from 'class-validator';

export class CreateAuditDto {
  @ApiProperty({ example: 'https://example.com' })
  @MaxLength(2048)
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] })
  url!: string;
}
