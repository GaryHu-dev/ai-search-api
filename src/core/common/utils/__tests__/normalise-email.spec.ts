import { normaliseEmail } from '../normalise-email';

describe('normaliseEmail', () => {
  it('lowercases and trims so the same address always matches', () => {
    expect(normaliseEmail('  JANE@Example.COM ')).toBe('jane@example.com');
  });
});
