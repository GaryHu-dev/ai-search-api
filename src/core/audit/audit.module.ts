import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';

// Global: audit recording is genuinely cross-cutting, so feature modules inject
// AuditService without importing this module each time.
@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
