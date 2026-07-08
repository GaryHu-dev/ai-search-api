import { Module } from '@nestjs/common';
import { StorageService } from './storage.service';

// Infrastructure module: exposes StorageService to whichever feature needs
// object storage (currently Files).
@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
