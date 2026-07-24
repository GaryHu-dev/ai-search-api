import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

// PrismaModule is @Global, so TENANT_PRISMA is available without importing it.
// NotificationsService is exported so producer modules (e.g. GeoModule) can
// inject it.
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
