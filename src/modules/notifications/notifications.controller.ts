import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Page } from '../../core/common/pagination';
import { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ListNotificationsQuery } from './dto/list-notifications.query';
import { NotificationResponse } from './dto/notification.response';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  // Static routes are declared before the ':id' param route so they can never
  // be shadowed by it.
  @Get()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListNotificationsQuery,
  ): Promise<Page<NotificationResponse>> {
    const page = await this.notifications.list(
      user.userId,
      query,
      query.unread ?? false,
    );
    return {
      items: page.items.map((n) => NotificationResponse.from(n)),
      nextCursor: page.nextCursor,
    };
  }

  @Get('unread-count')
  async unreadCount(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ count: number }> {
    return { count: await this.notifications.unreadCount(user.userId) };
  }

  @Post('read-all')
  @HttpCode(200) // marks existing rows read; nothing is created
  async readAll(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ count: number }> {
    return this.notifications.markAllRead(user.userId);
  }

  @Patch(':id/read')
  async markRead(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<NotificationResponse> {
    return NotificationResponse.from(
      await this.notifications.markRead(user.userId, id),
    );
  }
}
