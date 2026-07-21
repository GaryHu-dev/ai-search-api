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
import { UsersService } from '../users/users.service';
import { AuthTokens } from './auth.types';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { PasswordService } from './password.service';
import { GoogleAuthUser } from './strategies/google.strategy';
import { TokenService } from './token.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
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

    // When the account or its password method is missing, still spend argon2
    // time on a dummy verify so response timing doesn't reveal which emails
    // exist.
    const passwordOk = method?.passwordHash
      ? await this.passwords.verify(method.passwordHash, dto.password)
      : await this.passwords.verifyDummy(dto.password);

    if (!user || !passwordOk) {
      if (user) {
        await this.registerFailedLogin(user);
      }
      // One message for both "no such account" and "wrong password", so the
      // endpoint can't be used to discover which emails are registered.
      throw new UnauthorizedException('Invalid email or password');
    }

    await this.assertTenantActive(user.tenantId);

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
    const max = this.config.get('LOGIN_MAX_ATTEMPTS', { infer: true });

    // Atomic increment so concurrent wrong-password attempts each count (a plain
    // read-then-write would let them all overwrite the same value).
    const { failedLoginAttempts } = await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: { increment: 1 } },
      select: { failedLoginAttempts: true },
    });

    if (failedLoginAttempts >= max) {
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
    }
  }

  // Rejects authentication for a soft-deleted tenant, so deactivating a
  // workspace actually revokes its users' access rather than only hiding data.
  private async assertTenantActive(tenantId: string): Promise<void> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });
    if (!tenant || tenant.deletedAt) {
      throw new UnauthorizedException('This workspace is no longer active');
    }
  }

  refresh(refreshToken: string): Promise<AuthTokens> {
    return this.tokens.rotate(refreshToken);
  }

  logout(refreshToken: string): Promise<void> {
    return this.tokens.revoke(refreshToken);
  }

  // Provisions (or resolves) the user behind a verified Google identity and
  // issues a session for them. The Google profile is proven upstream: either by
  // GoogleStrategy in the server-side redirect flow, or previously by an id-token
  // verifier — this method trusts the { email, googleId } it's handed.
  async issueSessionForGoogleUser(
    profile: GoogleAuthUser,
  ): Promise<AuthTokens> {
    const email = normaliseEmail(profile.email);

    // Resolve by the stable Google account id (`sub`) first: a user's Google
    // email can change, but the sub doesn't. Matching on email would fail to
    // recognise a returning user whose email changed — and then try to create a
    // duplicate Google identity. Email is only a fallback, for linking.
    const linked = await this.prisma.loginMethod.findUnique({
      where: {
        provider_providerAccountId: {
          provider: 'GOOGLE',
          providerAccountId: profile.googleId,
        },
      },
      include: { user: true },
    });

    if (linked) {
      if (linked.user.deletedAt) {
        throw new UnauthorizedException('This account is no longer active');
      }
      await this.assertTenantActive(linked.user.tenantId);
      await this.audit.record({
        action: 'auth.login',
        tenantId: linked.user.tenantId,
        actorUserId: linked.user.id,
        targetType: 'user',
        targetId: linked.user.id,
        metadata: { method: 'google' },
      });
      return this.tokens.issue(linked.user);
    }

    const existing = await this.users.findByEmail(email);
    if (existing?.deletedAt) {
      throw new UnauthorizedException('This account is no longer active');
    }

    // First-time Google user, or an existing account (e.g. password) signing in
    // with Google for the first time.
    const user =
      existing ??
      (await this.prisma.$transaction(async (tx) => {
        const created = await this.users.createUserWithTenant(
          { email, displayName: profile.displayName },
          tx,
        );
        await tx.loginMethod.create({
          data: {
            userId: created.id,
            provider: 'GOOGLE',
            providerAccountId: profile.googleId,
          },
        });
        return created;
      }));

    if (existing) {
      await this.assertTenantActive(user.tenantId);
      // Link this Google identity onto the existing account.
      await this.prisma.loginMethod.upsert({
        where: { userId_provider: { userId: user.id, provider: 'GOOGLE' } },
        create: {
          userId: user.id,
          provider: 'GOOGLE',
          providerAccountId: profile.googleId,
        },
        update: { providerAccountId: profile.googleId },
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
