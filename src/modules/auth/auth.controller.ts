import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { AuthTokens } from './auth.types';
import { AuthTokensResponse } from './dto/auth-tokens.response';
import { GoogleLoginDto } from './dto/google-login.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';

// Credential endpoints are rate-limited more tightly than the global default to
// blunt brute-force and credential-stuffing attempts.
const CREDENTIAL_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @Throttle(CREDENTIAL_THROTTLE)
  @ApiCreatedResponse({ type: AuthTokensResponse })
  register(@Body() dto: RegisterDto): Promise<AuthTokens> {
    return this.auth.register(dto);
  }

  @Post('login')
  @HttpCode(200)
  @Throttle(CREDENTIAL_THROTTLE)
  @ApiOkResponse({ type: AuthTokensResponse })
  login(@Body() dto: LoginDto): Promise<AuthTokens> {
    return this.auth.login(dto);
  }

  @Post('google')
  @HttpCode(200)
  @Throttle(CREDENTIAL_THROTTLE)
  @ApiOkResponse({ type: AuthTokensResponse })
  google(@Body() dto: GoogleLoginDto): Promise<AuthTokens> {
    return this.auth.loginWithGoogle(dto.idToken);
  }

  @Post('refresh')
  @HttpCode(200)
  @Throttle(CREDENTIAL_THROTTLE)
  @ApiOkResponse({ type: AuthTokensResponse })
  refresh(@Body() dto: RefreshTokenDto): Promise<AuthTokens> {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(204)
  @Throttle(CREDENTIAL_THROTTLE)
  async logout(@Body() dto: RefreshTokenDto): Promise<void> {
    await this.auth.logout(dto.refreshToken);
  }
}
