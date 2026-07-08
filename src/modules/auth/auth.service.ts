import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { User } from '@prisma/client';
import { AuditService } from '../../core/audit/audit.service';
import { normaliseEmail } from '../../core/common/utils/normalise-email';
import { Env } from '../../core/config/env.validation';
import { PrismaService } from '../../core/prisma/prisma.service';
import { GoogleVerifier } from '../../integrations/google/google.verifier';
import { UsersService } from '../users/users.service';
import { AuthTokens } from './auth.types';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly google: GoogleVerifier,
    private readonly audit: AuditService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async register(dto: RegisterDto): Promise<AuthTokens> {
    const email = normaliseEmail(dto.email);

    if (await this.users.findByEmail(email)) {
      throw new ConflictException('An account with this email already exists');
    }

    const passwordHash = await this.passwords.hash(dto.password);

    // Tenant, user, and password credential are created together so a failure
    // can't leave a half-registered account behind.
    const user = await this.prisma.$transaction(async (tx) => {
      const created = await this.users.createUserWithTenant(
        { email, displayName: dto.displayName },
        tx,
      );
      await tx.loginMethod.create({
        data: { userId: created.id, provider: 'PASSWORD', passwordHash },
      });
      return created;
    });

    await this.audit.record({
      action: 'auth.register',
      tenantId: user.tenantId,
      actorUserId: user.id,
      targetType: 'user',
      targetId: user.id,
    });

    return this.tokens.issue(user);
  }

  async login(dto: LoginDto): Promise<AuthTokens> {
    const email = normaliseEmail(dto.email);
    const found = await this.users.findByEmail(email);
    const user = found && !found.deletedAt ? found : null;

    if (user?.lockedUntil && user.lockedUntil > new Date()) {
      throw new HttpException(
        'Account temporarily locked after too many failed attempts',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const method = user
      ? await this.prisma.loginMethod.findUnique({
          where: { userId_provider: { userId: user.id, provider: 'PASSWORD' } },
        })
      : null;

    const passwordOk = method?.passwordHash
      ? await this.passwords.verify(method.passwordHash, dto.password)
      : false;

    if (!user || !passwordOk) {
      if (user) {
        await this.registerFailedLogin(user);
      }
      // One message for both "no such account" and "wrong password", so the
      // endpoint can't be used to discover which emails are registered.
      throw new UnauthorizedException('Invalid email or password');
    }

    // A successful login clears any accumulated failures and lock.
    if (user.failedLoginAttempts > 0 || user.lockedUntil) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginAttempts: 0, lockedUntil: null },
      });
    }

    await this.audit.record({
      action: 'auth.login',
      tenantId: user.tenantId,
      actorUserId: user.id,
      metadata: { method: 'password' },
    });

    return this.tokens.issue(user);
  }

  // Counts a failed attempt and locks the account once the threshold is hit.
  private async registerFailedLogin(user: User): Promise<void> {
    const attempts = user.failedLoginAttempts + 1;
    const max = this.config.get('LOGIN_MAX_ATTEMPTS', { infer: true });

    if (attempts >= max) {
      const minutes = this.config.get('LOGIN_LOCK_MINUTES', { infer: true });
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: 0,
          lockedUntil: new Date(Date.now() + minutes * 60_000),
        },
      });
      await this.audit.record({
        action: 'auth.locked',
        tenantId: user.tenantId,
        actorUserId: user.id,
        targetType: 'user',
        targetId: user.id,
      });
    } else {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginAttempts: attempts },
      });
    }
  }

  refresh(refreshToken: string): Promise<AuthTokens> {
    return this.tokens.rotate(refreshToken);
  }

  logout(refreshToken: string): Promise<void> {
    return this.tokens.revoke(refreshToken);
  }

  async loginWithGoogle(idToken: string): Promise<AuthTokens> {
    const profile = await this.google.verify(idToken);
    const email = normaliseEmail(profile.email);
    const existing = await this.users.findByEmail(email);

    if (existing?.deletedAt) {
      throw new UnauthorizedException('This account is no longer active');
    }

    // Same email = same person: reuse the existing account, or create a fresh
    // one for a first-time Google user.
    const user =
      existing ??
      (await this.prisma.$transaction(async (tx) => {
        const created = await this.users.createUserWithTenant(
          { email, displayName: profile.name },
          tx,
        );
        await tx.loginMethod.create({
          data: {
            userId: created.id,
            provider: 'GOOGLE',
            providerAccountId: profile.sub,
          },
        });
        return created;
      }));

    // If they already had an account (e.g. registered with a password first),
    // link this Google identity to it so future Google logins recognise them.
    if (existing) {
      await this.prisma.loginMethod.upsert({
        where: { userId_provider: { userId: user.id, provider: 'GOOGLE' } },
        create: {
          userId: user.id,
          provider: 'GOOGLE',
          providerAccountId: profile.sub,
        },
        update: { providerAccountId: profile.sub },
      });
    }

    await this.audit.record({
      action: existing ? 'auth.login' : 'auth.register',
      tenantId: user.tenantId,
      actorUserId: user.id,
      targetType: 'user',
      targetId: user.id,
      metadata: { method: 'google' },
    });

    return this.tokens.issue(user);
  }
}
