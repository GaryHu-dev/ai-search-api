import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '../../../core/config/env.validation';
import { StorageService } from '../storage.service';

describe('StorageService (unconfigured)', () => {
  const config = { get: jest.fn(() => undefined) };
  const service = new StorageService(
    config as unknown as ConfigService<Env, true>,
  );

  it('starts without error and disables file features', async () => {
    await expect(service.onModuleInit()).resolves.toBeUndefined();
  });

  it('rejects put/get/delete when storage is not configured', async () => {
    await expect(
      service.put('k', Buffer.from('x'), 'text/plain'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(service.get('k')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    await expect(service.delete('k')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
