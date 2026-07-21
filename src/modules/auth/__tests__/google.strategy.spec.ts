import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Profile } from 'passport-google-oauth20';
import { Env } from '../../../core/config/env.validation';
import { GoogleStrategy } from '../strategies/google.strategy';

// A minimal ConfigService that satisfies the strategy's constructor (super()
// needs clientID/secret/callback to be present).
const config = {
  get: jest.fn(
    (key: string) =>
      ({
        GOOGLE_CLIENT_ID: 'client-id',
        GOOGLE_CLIENT_SECRET: 'client-secret',
        GOOGLE_CALLBACK_URL: 'http://localhost:3000/v1/auth/google/callback',
      })[key],
  ),
} as unknown as ConfigService<Env, true>;

const profile = (verified: boolean): Profile =>
  ({
    id: 'g-1',
    displayName: 'Jane Doe',
    emails: [{ value: 'jane@example.com', verified }],
    _json: { email_verified: verified },
  }) as unknown as Profile;

describe('GoogleStrategy', () => {
  const strategy = new GoogleStrategy(config);

  it('accepts a verified Google email and returns the provisioned identity', () => {
    const done = jest.fn();

    strategy.validate('access', 'refresh', profile(true), done);

    expect(done).toHaveBeenCalledWith(null, {
      email: 'jane@example.com',
      googleId: 'g-1',
      displayName: 'Jane Doe',
    });
  });

  it('rejects an unverified Google email', () => {
    const done = jest.fn();

    strategy.validate('access', 'refresh', profile(false), done);

    const [error, user] = done.mock.calls[0];
    expect(error).toBeInstanceOf(UnauthorizedException);
    expect(user).toBe(false);
  });
});
