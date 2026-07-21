import { Module, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Env } from '../../core/config/env.validation';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { PasswordService } from './password.service';
import { GoogleStrategy } from './strategies/google.strategy';
import { TokenService } from './token.service';

// Google sign-in is optional. The strategy is only instantiated (and thus only
// registered with Passport) when the full OAuth client config is present, so the
// app boots fine without it — the /auth/google routes simply return an error at
// request time instead of crashing the process at startup.
const GOOGLE_STRATEGY: Provider = {
  provide: GoogleStrategy,
  inject: [ConfigService],
  useFactory: (config: ConfigService<Env, true>): GoogleStrategy | null => {
    const configured =
      config.get('GOOGLE_CLIENT_ID', { infer: true }) &&
      config.get('GOOGLE_CLIENT_SECRET', { infer: true }) &&
      config.get('GOOGLE_CALLBACK_URL', { infer: true });
    return configured ? new GoogleStrategy(config) : null;
  },
};

@Module({
  imports: [
    UsersModule,
    PassportModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        secret: config.get('JWT_ACCESS_SECRET', { infer: true }),
        signOptions: {
          expiresIn: config.get('JWT_ACCESS_TTL_SECONDS', { infer: true }),
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    PasswordService,
    JwtStrategy,
    GOOGLE_STRATEGY,
  ],
})
export class AuthModule {}
