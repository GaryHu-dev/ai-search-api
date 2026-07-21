import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

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
  @IsUUID()
  cursor?: string;
}

// Adds sorting and free-text search to cursor pagination. Reuse on any list
// endpoint; each endpoint decides which fields are sortable/searchable.
export class ListQuery extends PaginationQuery {
  @ApiPropertyOptional({
    description:
      'Sort field; prefix with "-" for descending, e.g. "-createdAt".',
  })
  @IsOptional()
  @IsString()
  sort?: string;

  @ApiPropertyOptional({ description: 'Free-text search (endpoint-specific).' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

export type SortOrder = 'asc' | 'desc';

// Translates a `sort` param (e.g. "filename" or "-createdAt") into a Prisma
// orderBy, restricted to an allow-list so callers cannot sort by arbitrary
// (unindexed or sensitive) columns. `id` is appended as a stable tiebreaker, so
// cursor pagination stays deterministic regardless of the chosen sort.
export function parseSort(
  sort: string | undefined,
  allowed: readonly string[],
  fallback: { field: string; order: SortOrder },
): Record<string, SortOrder>[] {
  let field = fallback.field;
  let order: SortOrder = fallback.order;

  if (sort) {
    const descending = sort.startsWith('-');
    const requested = descending ? sort.slice(1) : sort;
    if (allowed.includes(requested)) {
      field = requested;
      order = descending ? 'desc' : 'asc';
    }
  }

  return field === 'id'
    ? [{ id: order }]
    : [{ [field]: order }, { id: 'desc' }];
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
