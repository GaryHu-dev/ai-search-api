import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';
import { Env } from '../../core/config/env.validation';

export interface GoogleProfile {
  email: string;
  sub: string; // Google's stable user id
  name?: string;
}

// Verifies a Google ID token minted on the client. We take the API-first route
// (client sends us an id token) rather than a server-side redirect flow, which
// keeps the backend stateless and avoids an OAuth session.
@Injectable()
export class GoogleVerifier {
  private readonly clientId?: string;
  private readonly client?: OAuth2Client;

  constructor(config: ConfigService<Env, true>) {
    this.clientId = config.get('GOOGLE_CLIENT_ID', { infer: true });
    this.client = this.clientId ? new OAuth2Client(this.clientId) : undefined;
  }

  async verify(idToken: string): Promise<GoogleProfile> {
    if (!this.client || !this.clientId) {
      throw new ServiceUnavailableException('Google sign-in is not configured');
    }

    const ticket = await this.client.verifyIdToken({
      idToken,
      audience: this.clientId,
    });
    const payload = ticket.getPayload();

    if (!payload?.email || payload.email_verified !== true) {
      throw new UnauthorizedException('Google account could not be verified');
    }

    return { email: payload.email, sub: payload.sub, name: payload.name };
  }
}
