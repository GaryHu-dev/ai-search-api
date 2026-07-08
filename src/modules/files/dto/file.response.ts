import { ApiProperty } from '@nestjs/swagger';
import { File } from '@prisma/client';

export class FileResponse {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  filename!: string;

  @ApiProperty()
  contentType!: string;

  @ApiProperty({ description: 'Size in bytes.' })
  size!: number;

  @ApiProperty()
  createdAt!: Date;

  static from(file: File): FileResponse {
    return {
      id: file.id,
      filename: file.filename,
      contentType: file.contentType,
      size: file.size,
      createdAt: file.createdAt,
    };
  }
}
