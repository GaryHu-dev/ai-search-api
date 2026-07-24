import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { ListQuery } from '../../../core/common/pagination';

// ListQuery (cursor + sort + search) plus an unread filter. `unread=true` in the
// query string arrives as a string, so coerce it before validation.
export class ListNotificationsQuery extends ListQuery {
  @ApiPropertyOptional({ description: 'Only return unread notifications.' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  unread?: boolean;
}
