import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { Env } from '../../core/config/env.validation';
import { StorageModule } from '../../integrations/storage/storage.module';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';

@Module({
  imports: [
    StorageModule,
    // Cap the multipart body size — multer buffers uploads into memory, so an
    // unbounded upload is a memory-exhaustion DoS. Oversize uploads are rejected
    // by multer and surfaced as 413 by the global exception filter.
    MulterModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        limits: { fileSize: config.get('MAX_UPLOAD_BYTES', { infer: true }) },
      }),
    }),
  ],
  controllers: [FilesController],
  providers: [FilesService],
})
export class FilesModule {}
