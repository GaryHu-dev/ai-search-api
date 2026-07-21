import { PasswordService } from '../password.service';

describe('PasswordService', () => {
  const service = new PasswordService();

  it('produces a verifiable hash that is not the plaintext', async () => {
    const hash = await service.hash('correct horse battery');
    expect(hash).not.toBe('correct horse battery');
    expect(await service.verify(hash, 'correct horse battery')).toBe(true);
  });

  it('rejects the wrong password', async () => {
    const hash = await service.hash('correct horse battery');
    expect(await service.verify(hash, 'wrong')).toBe(false);
  });

  it('returns false for a malformed hash instead of throwing', async () => {
    expect(await service.verify('not-a-real-hash', 'anything')).toBe(false);
  });
});
