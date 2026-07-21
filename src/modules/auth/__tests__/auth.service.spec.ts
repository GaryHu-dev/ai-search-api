import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../../../core/audit/audit.service';
import { Env } from '../../../core/config/env.validation';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { UsersService } from '../../users/users.service';
import { AuthService } from '../auth.service';
import { TokenService } from '../token.service';

describe('AuthService', () => {
  const users = { findByEmail: jest.fn(), createUserWithTenant: jest.fn() };
  const passwords = {
    hash: jest.fn(),
    verify: jest.fn(),
    verifyDummy: jest.fn(),
  };
  const tokens = { issue: jest.fn() };
  const prisma = {
    $transaction: jest.fn(),
    loginMethod: { findUnique: jest.fn(), upsert: jest.fn() },
    user: { update: jest.fn() },
    tenant: { findUnique: jest.fn() },
  };
  const audit = { record: jest.fn() };
  const config = {
    get: jest.fn(
      (key: string) => ({ LOGIN_MAX_ATTEMPTS: 5, LOGIN_LOCK_MINUTES: 15 })[key],
    ),
  };
  let service: AuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AuthService(
      prisma as unknown as PrismaService,
      users as unknown as UsersService,
      passwords,
      tokens as unknown as TokenService,
      audit as unknown as AuditService,
      config as unknown as ConfigService<Env, true>,
    );
  });

  describe('register', () => {
    it('rejects when the email is already taken', async () => {
      users.findByEmail.mockResolvedValue({ id: 'existing' });

      await expect(
        service.register({
          email: 'jane@example.com',
          password: 'password123',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('normalises the email before checking for duplicates', async () => {
      users.findByEmail.mockResolvedValue(null);
      passwords.hash.mockResolvedValue('hashed');
      prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
        fn({ loginMethod: { create: jest.fn().mockResolvedValue({}) } }),
      );
      users.createUserWithTenant.mockResolvedValue({
        id: 'u1',
        tenantId: 't1',
        email: 'jane@example.com',
      });
      tokens.issue.mockResolvedValue({ accessToken: 'a' });

      await service.register({
        email: '  JANE@example.com  ',
        password: 'password123',
      });

      expect(users.findByEmail).toHaveBeenCalledWith('jane@example.com');
      expect(tokens.issue).toHaveBeenCalled();
    });
  });

  describe('login', () => {
    it('rejects an unknown email without revealing that it is unknown', async () => {
      users.findByEmail.mockResolvedValue(null);

      await expect(
        service.login({ email: 'nobody@example.com', password: 'whatever1' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(passwords.verify).not.toHaveBeenCalled();
      expect(tokens.issue).not.toHaveBeenCalled();
    });

    it('rejects a wrong password and counts the failed attempt', async () => {
      users.findByEmail.mockResolvedValue({
        id: 'u1',
        deletedAt: null,
        failedLoginAttempts: 0,
        lockedUntil: null,
      });
      prisma.loginMethod.findUnique.mockResolvedValue({
        passwordHash: 'hashed',
      });
      passwords.verify.mockResolvedValue(false);
      prisma.user.update.mockResolvedValue({ failedLoginAttempts: 1 });

      await expect(
        service.login({ email: 'jane@example.com', password: 'wrong' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(tokens.issue).not.toHaveBeenCalled();
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { failedLoginAttempts: { increment: 1 } },
        select: { failedLoginAttempts: true },
      });
    });

    it('locks the account once the max failed attempts is reached', async () => {
      users.findByEmail.mockResolvedValue({
        id: 'u1',
        tenantId: 't1',
        deletedAt: null,
        failedLoginAttempts: 4, // next failure hits the max of 5
        lockedUntil: null,
      });
      prisma.loginMethod.findUnique.mockResolvedValue({
        passwordHash: 'hashed',
      });
      passwords.verify.mockResolvedValue(false);
      // Atomic increment returns the new count; 5 hits the max and triggers a lock.
      prisma.user.update.mockResolvedValue({ failedLoginAttempts: 5 });

      await expect(
        service.login({ email: 'jane@example.com', password: 'wrong' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'u1' },
          data: expect.objectContaining({
            failedLoginAttempts: 0,
            lockedUntil: expect.any(Date),
          }),
        }),
      );
    });

    it('rejects login while the account is locked', async () => {
      users.findByEmail.mockResolvedValue({
        id: 'u1',
        deletedAt: null,
        failedLoginAttempts: 0,
        lockedUntil: new Date(Date.now() + 60_000),
      });

      await expect(
        service.login({ email: 'jane@example.com', password: 'whatever' }),
      ).rejects.toThrow(/locked/i);
      expect(passwords.verify).not.toHaveBeenCalled();
    });

    it('issues tokens on a correct password', async () => {
      const user = {
        id: 'u1',
        tenantId: 't1',
        email: 'jane@example.com',
        deletedAt: null,
        failedLoginAttempts: 0,
        lockedUntil: null,
      };
      users.findByEmail.mockResolvedValue(user);
      prisma.loginMethod.findUnique.mockResolvedValue({
        passwordHash: 'hashed',
      });
      passwords.verify.mockResolvedValue(true);
      prisma.tenant.findUnique.mockResolvedValue({ id: 't1', deletedAt: null });
      tokens.issue.mockResolvedValue({ accessToken: 'a' });

      await service.login({
        email: 'jane@example.com',
        password: 'password123',
      });

      expect(tokens.issue).toHaveBeenCalledWith(user);
    });
  });

  describe('issueSessionForGoogleUser', () => {
    it('creates a new account for a first-time Google user', async () => {
      users.findByEmail.mockResolvedValue(null);
      prisma.loginMethod.findUnique.mockResolvedValue(null);
      prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
        fn({ loginMethod: { create: jest.fn().mockResolvedValue({}) } }),
      );
      users.createUserWithTenant.mockResolvedValue({
        id: 'u1',
        tenantId: 't1',
        email: 'new@example.com',
      });
      tokens.issue.mockResolvedValue({ accessToken: 'a' });

      await service.issueSessionForGoogleUser({
        email: 'new@example.com',
        googleId: 'g-1',
        displayName: 'New',
      });

      expect(users.createUserWithTenant).toHaveBeenCalled();
      expect(tokens.issue).toHaveBeenCalled();
    });

    it('links Google to an existing account (same email = same person)', async () => {
      users.findByEmail.mockResolvedValue({
        id: 'u1',
        tenantId: 't1',
        email: 'jane@example.com',
        deletedAt: null,
      });
      prisma.loginMethod.findUnique.mockResolvedValue(null);
      prisma.tenant.findUnique.mockResolvedValue({ id: 't1', deletedAt: null });
      prisma.loginMethod.upsert.mockResolvedValue({});
      tokens.issue.mockResolvedValue({ accessToken: 'a' });

      await service.issueSessionForGoogleUser({
        email: 'jane@example.com',
        googleId: 'g-1',
      });

      expect(prisma.loginMethod.upsert).toHaveBeenCalled();
      expect(users.createUserWithTenant).not.toHaveBeenCalled();
      expect(tokens.issue).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'u1' }),
      );
    });

    it('resolves a returning user by their stable Google id', async () => {
      prisma.loginMethod.findUnique.mockResolvedValue({
        user: {
          id: 'u1',
          tenantId: 't1',
          email: 'jane@example.com',
          deletedAt: null,
        },
      });
      prisma.tenant.findUnique.mockResolvedValue({ id: 't1', deletedAt: null });
      tokens.issue.mockResolvedValue({ accessToken: 'a' });

      await service.issueSessionForGoogleUser({
        email: 'jane@example.com',
        googleId: 'g-1',
      });

      expect(users.findByEmail).not.toHaveBeenCalled();
      expect(tokens.issue).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'u1' }),
      );
    });

    it('rejects a soft-deleted account', async () => {
      prisma.loginMethod.findUnique.mockResolvedValue(null);
      users.findByEmail.mockResolvedValue({ id: 'u1', deletedAt: new Date() });

      await expect(
        service.issueSessionForGoogleUser({
          email: 'gone@example.com',
          googleId: 'g-1',
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(tokens.issue).not.toHaveBeenCalled();
    });
  });
});
