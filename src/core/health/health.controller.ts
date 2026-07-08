import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { SkipResponseEnvelope } from '../common/decorators/skip-response-envelope.decorator';
import { PrismaHealthIndicator } from './prisma.health';

// Health endpoints are deliberately unversioned: orchestrators and uptime
// monitors point at a stable URL that must not move when the API bumps to /v2.
// They also skip the response envelope so probes see Terminus's raw output, and
// the rate limiter so a busy monitoring fleet can't throttle liveness checks.
@ApiTags('health')
@SkipThrottle()
@SkipResponseEnvelope()
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prisma: PrismaHealthIndicator,
  ) {}

  // Liveness: is the process up and answering? A failure here tells the
  // orchestrator to restart the container.
  @Get('live')
  @HealthCheck()
  live() {
    return this.health.check([]);
  }

  // Readiness: can this instance actually serve traffic (i.e. reach the
  // database)? A failure here tells the load balancer to stop routing to it,
  // without killing the process.
  @Get('ready')
  @HealthCheck()
  ready() {
    return this.health.check([() => this.prisma.pingCheck('database')]);
  }
}
