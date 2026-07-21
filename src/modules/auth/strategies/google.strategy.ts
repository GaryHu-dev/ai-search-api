import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Profile, Strategy, VerifyCallback } from 'passport-google-oauth20';
import { Env } from '../../../core/config/env.validation';

// The minimal identity we carry out of the OAuth dance. Attached to
// `request.user` by Passport, then handed to AuthService to provision a session.
export interface GoogleAuthUser {
  email: string;
  googleId: string; // Google's stable account id (`sub`)
  displayName?: string;
}

// The server-side (authorization-code / redirect) half of Google sign-in. The
// browser is redirected to Google by the guard; Google calls us back at
// GOOGLE_CALLBACK_URL, Passport exchanges the code for a profile, and validate()
// turns that profile into the identity the callback route issues tokens for.
//
// Registered only when GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET +
// GOOGLE_CALLBACK_URL are all set (see AuthModule); the module never constructs
// this strategy otherwise, so the config values are guaranteed present here.
@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(config: ConfigService<Env, true>) {
    super({
      clientID: config.get('GOOGLE_CLIENT_ID', { infer: true }),
      clientSecret: config.get('GOOGLE_CLIENT_SECRET', { infer: true }),
      callbackURL: config.get('GOOGLE_CALLBACK_URL', { infer: true }),
      scope: ['email', 'profile'],
    });
  }

  // Runs after Google returns a verified profile. We refuse to sign in an
  // unverified email — otherwise anyone could claim someone else's address by
  // registering it (unverified) on their own Google account.
  validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ): void {
    const email = profile.emails?.[0];
    const verified =
      email?.verified === true || profile._json?.email_verified === true;

    if (!email?.value || !verified) {
      done(
        new UnauthorizedException('Google account could not be verified'),
        false,
      );
      return;
    }

    const user: GoogleAuthUser = {
      email: email.value,
      googleId: profile.id,
      displayName: profile.displayName,
    };
    done(null, user);
  }
}
