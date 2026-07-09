import { ApiProperty } from '@nestjs/swagger';
import { Audit } from '@prisma/client';
import { Finding } from '../geo.types';

// Concrete class for Swagger; runtime value is mapped from the Prisma row.
export class AuditResponse {
  @ApiProperty() id!: string;
  @ApiProperty() url!: string;
  @ApiProperty({ enum: ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'] })
  status!: string;
  @ApiProperty({ type: 'array', items: { type: 'object' }, nullable: true })
  findings!: Finding[] | null;
  @ApiProperty({ nullable: true }) error!: string | null;
  @ApiProperty() createdAt!: Date;

  static from(a: Audit): AuditResponse {
    return {
      id: a.id,
      url: a.url,
      status: a.status,
      findings: (a.findings as unknown as Finding[] | null) ?? null,
      error: a.error,
      createdAt: a.createdAt,
    };
  }
}
