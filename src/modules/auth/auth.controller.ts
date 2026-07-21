import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiCreatedResponse,
  ApiExcludeEndpoint,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { SkipResponseEnvelope } from '../../core/common/decorators/skip-response-envelope.decorator';
import { Env } from '../../core/config/env.validation';
import { AuthService } from './auth.service';
import { AuthTokens } from './auth.types';
import { AuthTokensResponse } from './dto/auth-tokens.response';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';
import { GoogleAuthGuard } from './google-auth.guard';
import { GoogleAuthUser } from './strategies/google.strategy';

// Credential endpoints are rate-limited more tightly than the global default to
// blunt brute-force and credential-stuffing attempts.
const CREDENTIAL_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService<Env, true>,
  ) {}

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

  // Backend-driven Google sign-in (authorization-code / redirect flow). The
  // frontend only navigates the browser here; the guard redirects to Google's
  // consent screen. Empty body — control never returns to this handler.
  @Get('google')
  @SkipResponseEnvelope()
  @UseGuards(GoogleAuthGuard)
  @ApiExcludeEndpoint()
  google(): void {
    // Passport handles the redirect to Google.
  }

  // Google redirects the browser back here with an authorization code. Passport
  // exchanges it and populates `request.user`; we mint our own token pair and
  // hand it to the frontend in the URL *fragment* (never the query string, so
  // the tokens don't land in server logs, proxies, or the Referer header). On
  // any failure we bounce back with an error fragment instead of a raw 401.
  //
  // @Res() takes over the response so we can 302 directly; @SkipResponseEnvelope
  // keeps the interceptor from trying to wrap the redirect.
  @Get('google/callback')
  @SkipResponseEnvelope()
  @UseGuards(GoogleAuthGuard)
  @ApiExcludeEndpoint()
  async googleCallback(
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const target = this.config.get('GOOGLE_POST_LOGIN_REDIRECT', {
      infer: true,
    });
    const user = req.user as GoogleAuthUser | undefined;

    if (!user) {
      res.redirect(`${target}#error=google_auth_failed`);
      return;
    }

    try {
      const tokens = await this.auth.issueSessionForGoogleUser(user);
      const fragment = new URLSearchParams({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        tokenType: tokens.tokenType,
        expiresIn: String(tokens.expiresIn),
      }).toString();
      res.redirect(`${target}#${fragment}`);
    } catch {
      // e.g. the account or its workspace has since been deactivated.
      res.redirect(`${target}#error=google_auth_failed`);
    }
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
