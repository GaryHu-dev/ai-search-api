import { ApiProperty } from '@nestjs/swagger';
import { Notification } from '@prisma/client';

// Concrete class for Swagger; runtime value is mapped from the Prisma row.
export class NotificationResponse {
  @ApiProperty() id!: string;
  @ApiProperty() type!: string;
  @ApiProperty() title!: string;
  @ApiProperty() body!: string;
  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true })
  data!: Record<string, unknown> | null;
  @ApiProperty({ nullable: true }) readAt!: Date | null;
  @ApiProperty() createdAt!: Date;

  static from(n: Notification): NotificationResponse {
    return {
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      data: (n.data as Record<string, unknown> | null) ?? null,
      readAt: n.readAt,
      createdAt: n.createdAt,
    };
  }
}
