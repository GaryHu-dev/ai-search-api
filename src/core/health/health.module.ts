import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { JobsModule } from '../jobs/jobs.module';
import { HealthController } from './health.controller';
import { JobsHealthIndicator } from './jobs.health';
import { PrismaHealthIndicator } from './prisma.health';

@Module({
  imports: [TerminusModule, JobsModule],
  controllers: [HealthController],
  providers: [PrismaHealthIndicator, JobsHealthIndicator],
})
export class HealthModule {}
