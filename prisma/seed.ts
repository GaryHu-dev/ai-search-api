import { hash } from '@node-rs/argon2';
import { PrismaClient } from '@prisma/client';

// Idempotent development seed: creates one demo tenant + account so a fresh
// database is immediately usable. Safe to run repeatedly. Not for production.
const prisma = new PrismaClient();

const DEMO_EMAIL = 'demo@example.com';
const DEMO_PASSWORD = 'password123';

async function main(): Promise<void> {
  const existing = await prisma.user.findUnique({
    where: { email: DEMO_EMAIL },
  });
  if (existing) {
    console.log(`Seed: ${DEMO_EMAIL} already exists — nothing to do.`);
    return;
  }

  await prisma.user.create({
    data: {
      email: DEMO_EMAIL,
      displayName: 'Demo User',
      tenant: { create: { name: 'Demo Workspace' } },
      loginMethods: {
        create: {
          provider: 'PASSWORD',
          passwordHash: await hash(DEMO_PASSWORD),
        },
      },
    },
  });

  console.log(`Seed: created ${DEMO_EMAIL} (password: ${DEMO_PASSWORD}).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
