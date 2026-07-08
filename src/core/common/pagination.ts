import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

// Cursor-based pagination: resilient to inserts/deletes between pages (unlike
// offset pagination) and cheap on indexed columns. The cursor is an opaque id;
// callers pass back `nextCursor` to fetch the following page.
export class PaginationQuery {
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;

  @ApiPropertyOptional({ description: 'Return items after this id.' })
  @IsOptional()
  @IsString()
  cursor?: string;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
