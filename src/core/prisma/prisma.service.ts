import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

// Thin wrapper that ties the Prisma connection lifecycle to Nest's. We connect
// eagerly on boot so a bad DATABASE_URL fails at startup rather than on the
// first query, and disconnect on shutdown so the pool drains cleanly.
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
