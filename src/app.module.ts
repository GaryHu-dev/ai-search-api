import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuditModule } from './core/audit/audit.module';
import { AllExceptionsFilter } from './core/common/filters/all-exceptions.filter';
import { ResponseEnvelopeInterceptor } from './core/common/interceptors/response-envelope.interceptor';
import { TimeoutInterceptor } from './core/common/interceptors/timeout.interceptor';
import { TenantContextInterceptor } from './core/tenancy/tenant-context.interceptor';
import { AppConfigModule } from './core/config/config.module';
import { HealthModule } from './core/health/health.module';
import { JobsModule } from './core/jobs/jobs.module';
import { AppLoggerModule } from './core/logger/logger.module';
import { AuthModule } from './modules/auth/auth.module';
import { FilesModule } from './modules/files/files.module';
import { GeoModule } from './modules/geo/geo.module';
import { UsersModule } from './modules/users/users.module';
import { PrismaModule } from './core/prisma/prisma.module';

// Composition root. Config and logging come first because everything else
// depends on them; Prisma is global; feature modules follow.
@Module({
  imports: [
    AppConfigModule,
    AppLoggerModule,
    PrismaModule,
    AuditModule,
    // Global baseline rate limit; credential routes tighten it further. Storage
    // is in-memory, which is correct for a single instance — running multiple
    // replicas will need a shared store (Redis).
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    HealthModule,
    JobsModule,
    UsersModule,
    AuthModule,
    FilesModule,
    GeoModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor },
    { provide: APP_INTERCEPTOR, useClass: TimeoutInterceptor },
    { provide: APP_INTERCEPTOR, useClass: ResponseEnvelopeInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
