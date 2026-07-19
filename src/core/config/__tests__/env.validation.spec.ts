import { validateEnv } from '../env.validation';

describe('validateEnv', () => {
  const validEnv = {
    NODE_ENV: 'test',
    PORT: '3000',
    LOG_LEVEL: 'info',
    DATABASE_URL: 'postgresql://app:app@localhost:5432/app',
    JWT_ACCESS_SECRET: 'x'.repeat(32),
  };

  it('accepts a well-formed environment and coerces PORT to a number', () => {
    const env = validateEnv(validEnv);

    expect(env.PORT).toBe(3000);
    expect(typeof env.PORT).toBe('number');
    expect(env.NODE_ENV).toBe('test');
  });

  it('refuses GEO_ALLOW_PRIVATE_URLS=true in production', () => {
    expect(() =>
      validateEnv({
        ...validEnv,
        NODE_ENV: 'production',
        GEO_ALLOW_PRIVATE_URLS: 'true',
      }),
    ).toThrow(/GEO_ALLOW_PRIVATE_URLS/);
  });

  it('allows GEO_ALLOW_PRIVATE_URLS=true outside production', () => {
    expect(() =>
      validateEnv({
        ...validEnv,
        NODE_ENV: 'development',
        GEO_ALLOW_PRIVATE_URLS: 'true',
      }),
    ).not.toThrow();
  });

  it('applies defaults for the optional variables', () => {
    const env = validateEnv({
      DATABASE_URL: validEnv.DATABASE_URL,
      JWT_ACCESS_SECRET: validEnv.JWT_ACCESS_SECRET,
    });

    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.JWT_ACCESS_TTL_SECONDS).toBe(900);
    expect(env.REFRESH_TOKEN_TTL_DAYS).toBe(30);
  });

  it('refuses to boot when DATABASE_URL is missing', () => {
    expect(() =>
      validateEnv({ JWT_ACCESS_SECRET: validEnv.JWT_ACCESS_SECRET }),
    ).toThrow(/DATABASE_URL/);
  });

  it('refuses to boot when the JWT secret is too short', () => {
    expect(() =>
      validateEnv({ ...validEnv, JWT_ACCESS_SECRET: 'too-short' }),
    ).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('refuses to boot on an unknown LOG_LEVEL', () => {
    expect(() => validateEnv({ ...validEnv, LOG_LEVEL: 'verbose' })).toThrow(
      /LOG_LEVEL/,
    );
  });
});
