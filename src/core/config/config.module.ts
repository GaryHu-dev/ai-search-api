import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './env.validation';

// Wraps @nestjs/config with our fail-fast validation and exposes configuration
// application-wide, so feature modules read settings through a typed
// ConfigService instead of touching process.env directly.
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
  ],
})
export class AppConfigModule {}
