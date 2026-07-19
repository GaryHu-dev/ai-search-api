import { Injectable } from '@nestjs/common';
import {
  HealthIndicatorResult,
  HealthIndicatorService,
} from '@nestjs/terminus';
import { JobsService } from '../jobs/jobs.service';

// Reports whether the background-job subsystem (pg-boss) is running. Now that
// async audits are user-facing, a stopped queue must fail readiness rather than
// silently never processing submissions.
@Injectable()
export class JobsHealthIndicator {
  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    private readonly jobs: JobsService,
  ) {}

  check(key: string): HealthIndicatorResult {
    const indicator = this.healthIndicatorService.check(key);
    return this.jobs.isHealthy() ? indicator.up() : indicator.down();
  }
}
