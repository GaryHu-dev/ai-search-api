import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Env } from '../../core/config/env.validation';
import { PrismaService } from '../../core/prisma/prisma.service';
import { TokenService } from './token.service';

describe('TokenService', () => {
  const jwt = { signAsync: jest.fn() };
  const prisma = {
    refreshToken: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  };
  const config = {
    get: jest.fn(
      (key: string) =>
        ({ JWT_ACCESS_TTL_SECONDS: 900, REFRESH_TOKEN_TTL_DAYS: 30 })[key],
    ),
  };
  let service: TokenService;

  const subject = { id: 'u1', tenantId: 't1', email: 'jane@example.com' };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TokenService(
      jwt as unknown as JwtService,
      config as unknown as ConfigService<Env, true>,
      prisma as unknown as PrismaService,
    );
  });

  it('issues an access token and stores only a hash of the refresh token', async () => {
    jwt.signAsync.mockResolvedValue('access-token');
    prisma.refreshToken.create.mockResolvedValue({});

    const tokens = await service.issue(subject);

    expect(tokens.accessToken).toBe('access-token');
    expect(tokens.tokenType).toBe('Bearer');
    expect(tokens.expiresIn).toBe(900);
    expect(tokens.refreshToken).toEqual(expect.any(String));

    const stored = prisma.refreshToken.create.mock.calls[0][0].data;
    expect(stored.userId).toBe('u1');
    // What we persist must not be the raw token a client holds.
    expect(stored.tokenHash).not.toBe(tokens.refreshToken);
    expect(stored.expiresAt).toBeInstanceOf(Date);
  });

  it('rejects rotating an unknown refresh token', async () => {
    prisma.refreshToken.findUnique.mockResolvedValue(null);
    await expect(service.rotate('nope')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects rotating an expired refresh token', async () => {
    prisma.refreshToken.findUnique.mockResolvedValue({
      id: 'r1',
      userId: 'u1',
      expiresAt: new Date(Date.now() - 1000),
      revokedAt: null,
      user: { id: 'u1', deletedAt: null },
    });
    await expect(service.rotate('old')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('treats reuse of a revoked token as theft and revokes the whole family', async () => {
    prisma.refreshToken.findUnique.mockResolvedValue({
      id: 'r1',
      userId: 'u1',
      expiresAt: new Date(Date.now() + 10_000),
      revokedAt: new Date(),
      user: { id: 'u1', deletedAt: null },
    });

    await expect(service.rotate('spent')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 'u1', revokedAt: null }),
      }),
    );
  });

  it('rejects rotation when the owner is soft-deleted', async () => {
    prisma.refreshToken.findUnique.mockResolvedValue({
      id: 'r1',
      userId: 'u1',
      expiresAt: new Date(Date.now() + 10_000),
      revokedAt: null,
      user: { id: 'u1', deletedAt: new Date(), tenant: { deletedAt: null } },
    });
    await expect(service.rotate('valid')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rotates a valid token: revokes the old and issues a new pair', async () => {
    prisma.refreshToken.findUnique.mockResolvedValue({
      id: 'r1',
      userId: 'u1',
      expiresAt: new Date(Date.now() + 10_000),
      revokedAt: null,
      user: {
        id: 'u1',
        tenantId: 't1',
        email: 'jane@example.com',
        deletedAt: null,
        tenant: { deletedAt: null },
      },
    });
    // The old token is claimed atomically; count === 1 means this call won.
    prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });
    prisma.refreshToken.create.mockResolvedValue({});
    jwt.signAsync.mockResolvedValue('new-access');

    const tokens = await service.rotate('valid');

    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'r1', revokedAt: null },
        data: expect.objectContaining({ revokedAt: expect.any(Date) }),
      }),
    );
    expect(tokens.accessToken).toBe('new-access');
  });

  it('rejects rotation when the token was already claimed concurrently', async () => {
    prisma.refreshToken.findUnique.mockResolvedValue({
      id: 'r1',
      userId: 'u1',
      expiresAt: new Date(Date.now() + 10_000),
      revokedAt: null,
      user: {
        id: 'u1',
        tenantId: 't1',
        email: 'jane@example.com',
        deletedAt: null,
        tenant: { deletedAt: null },
      },
    });
    // A concurrent request already flipped revokedAt, so this claim matches no row.
    prisma.refreshToken.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.rotate('valid')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(jwt.signAsync).not.toHaveBeenCalled();
  });

  it('revoke marks the presented token revoked', async () => {
    prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });
    await service.revoke('some-token');
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ revokedAt: expect.any(Date) }),
      }),
    );
  });
});
