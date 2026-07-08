import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { LoggerModule } from 'nestjs-pino';
import { Env } from '../config/env.validation';

// Structured (JSON) logging via Pino. Every request gets a correlation id that
// ties its log lines together and is echoed back to the caller, so a support
// report can be traced to the exact request that produced it.
@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const isDevelopment =
          config.get('NODE_ENV', { infer: true }) === 'development';

        return {
          pinoHttp: {
            level: config.get('LOG_LEVEL', { infer: true }),
            genReqId: (req: IncomingMessage, res: ServerResponse) => {
              const header = req.headers['x-request-id'];
              const id =
                (Array.isArray(header) ? header[0] : header) ?? randomUUID();
              res.setHeader('x-request-id', id);
              return id;
            },
            // Attach the authenticated user's identity to each request log so
            // observability can be filtered by user or tenant. Populated by the
            // JWT guard; absent on unauthenticated requests.
            customProps: (req) => {
              const user = (
                req as { user?: { userId?: string; tenantId?: string } }
              ).user;
              return { userId: user?.userId, tenantId: user?.tenantId };
            },
            // Keep credentials out of the logs entirely.
            redact: ['req.headers.authorization', 'req.headers.cookie'],
            // Human-readable output locally; raw JSON in every other
            // environment so log aggregators can parse it.
            transport: isDevelopment
              ? { target: 'pino-pretty', options: { singleLine: true } }
              : undefined,
          },
        };
      },
    }),
  ],
})
export class AppLoggerModule {}
