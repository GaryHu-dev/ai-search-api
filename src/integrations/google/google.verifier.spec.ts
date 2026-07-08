import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '../../core/config/env.validation';
import { GoogleVerifier } from './google.verifier';

describe('GoogleVerifier', () => {
  it('reports unavailable when no client id is configured', async () => {
    const config = { get: jest.fn(() => undefined) };
    const verifier = new GoogleVerifier(
      config as unknown as ConfigService<Env, true>,
    );

    await expect(verifier.verify('any-token')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
