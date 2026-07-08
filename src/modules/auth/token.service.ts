import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';
import { Env } from '../../core/config/env.validation';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AuthTokens, JwtPayload } from './auth.types';

interface TokenSubject {
  id: string;
  tenantId: string;
  email: string;
}

// Issues and manages the access/refresh token pair.
//
// Access tokens are stateless JWTs — fast to verify, impossible to revoke early,
// so they're kept short-lived. Refresh tokens are the revocable half: opaque
// random strings we store only as a hash, rotated on every use, with reuse
// treated as a compromise.
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
    private readonly prisma: PrismaService,
  ) {}

  async issue(subject: TokenSubject): Promise<AuthTokens> {
    const payload: JwtPayload = {
      sub: subject.id,
      tenantId: subject.tenantId,
      email: subject.email,
    };

    const accessToken = await this.jwt.signAsync(payload);
    const refreshToken = await this.createRefreshToken(subject.id);

    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: this.config.get('JWT_ACCESS_TTL_SECONDS', { infer: true }),
    };
  }

  // The presented refresh token is single-use: we revoke it and mint a fresh
  // pair. Presenting an already-revoked token means it leaked, so we revoke the
  // user's whole token family and force a re-login.
  async rotate(presented: string): Promise<AuthTokens> {
    const tokenHash = this.hashToken(presented);
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!record || record.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (record.revokedAt) {
      await this.revokeAllForUser(record.userId);
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (record.user.deletedAt) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    await this.prisma.refreshToken.update({
      where: { id: record.id },
      data: { revokedAt: new Date() },
    });

    return this.issue({
      id: record.user.id,
      tenantId: record.user.tenantId,
      email: record.user.email,
    });
  }

  async revoke(presented: string): Promise<void> {
    const tokenHash = this.hashToken(presented);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async createRefreshToken(userId: string): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    const ttlDays = this.config.get('REFRESH_TOKEN_TTL_DAYS', { infer: true });
    const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);

    await this.prisma.refreshToken.create({
      data: { userId, tokenHash: this.hashToken(token), expiresAt },
    });

    return token;
  }

  // Refresh tokens are high-entropy random strings, so a fast one-way hash is
  // enough to make a database leak useless. Slow password hashing isn't needed
  // (or wanted) on the token-refresh hot path.
  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
