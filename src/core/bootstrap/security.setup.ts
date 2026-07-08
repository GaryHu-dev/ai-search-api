import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Application, json, urlencoded } from 'express';
import helmet from 'helmet';
import { Env } from '../config/env.validation';

// Accepts 'true'/'false', a hop count, or a comma-separated list of trusted
// IPs/subnets (whatever Express `trust proxy` understands).
function parseTrustProxy(raw: string): boolean | number | string {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  const asNumber = Number(raw);
  return Number.isNaN(asNumber) ? raw : asNumber;
}

// Security headers, trust-proxy, and hard body-size limits.
export function configureSecurity(
  app: INestApplication,
  config: ConfigService<Env, true>,
): void {
  app.use(helmet());

  // Only trust proxy headers when explicitly configured to match the topology,
  // so X-Forwarded-For can't be forged to poison rate-limit keys or logs.
  const trustProxy = config.get('TRUST_PROXY', { infer: true });
  if (trustProxy !== undefined) {
    const instance = app.getHttpAdapter().getInstance() as Application;
    instance.set('trust proxy', parseTrustProxy(trustProxy));
  }

  const bodyLimit = config.get('BODY_LIMIT', { infer: true });
  app.use(json({ limit: bodyLimit }));
  app.use(urlencoded({ extended: true, limit: bodyLimit }));
}
