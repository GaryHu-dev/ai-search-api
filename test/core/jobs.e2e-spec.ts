import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../../src/app.module';
import { RefreshTokenCleanupJob } from '../../src/core/jobs/refresh-token-cleanup.job';
import { PrismaService } from '../../src/core/prisma/prisma.service';

// Booting the app already proves pg-boss connects and registers its queue,
// worker, and schedule without error. This additionally exercises the real job
// logic against Postgres.
describe('Background jobs (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let job: RefreshTokenCleanupJob;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    job = app.get(RefreshTokenCleanupJob);
  });

  afterAll(async () => {
    await app.close();
  });

  it('purges expired refresh tokens but keeps valid ones', async () => {
    const user = await prisma.user.create({
      data: { email: `${randomUUID()}@jobs.test`, tenant: { create: {} } },
    });

    const expired = await prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: randomUUID(),
        expiresAt: new Date(Date.now() - 60_000),
      },
    });
    const active = await prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: randomUUID(),
        expiresAt: new Date(Date.now() + 60 * 60_000),
      },
    });

    await job.purgeStale();

    expect(
      await prisma.refreshToken.findUnique({ where: { id: expired.id } }),
    ).toBeNull();
    expect(
      await prisma.refreshToken.findUnique({ where: { id: active.id } }),
    ).not.toBeNull();

    // Tidy up (cascades to the remaining token).
    await prisma.user.delete({ where: { id: user.id } });
  });
});
