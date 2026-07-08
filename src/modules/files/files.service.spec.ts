import { NotFoundException } from '@nestjs/common';
import { Readable } from 'node:stream';
import { TenantPrismaClient } from '../../core/prisma/prisma.module';
import { StorageService } from '../../integrations/storage/storage.service';
import { FilesService } from './files.service';

// Tenant scoping itself is enforced by the Prisma tenant-scope extension and
// verified end to end in test/modules/files.e2e-spec.ts. These unit tests cover
// the service's own logic (pagination, storage orchestration, not-found).
describe('FilesService', () => {
  const prisma = {
    file: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    },
  };
  const storage = { put: jest.fn(), get: jest.fn(), delete: jest.fn() };
  let service: FilesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new FilesService(
      prisma as unknown as TenantPrismaClient,
      storage as unknown as StorageService,
    );
  });

  describe('list (cursor pagination)', () => {
    it('returns nextCursor when a further page exists', async () => {
      // Asked for 2, service fetches 3 to detect "more".
      prisma.file.findMany.mockResolvedValue([
        { id: 'a' },
        { id: 'b' },
        { id: 'c' },
      ]);

      const page = await service.list({ limit: 2 });

      expect(page.items.map((f) => f.id)).toEqual(['a', 'b']);
      expect(page.nextCursor).toBe('b');
    });

    it('returns a null cursor on the last page', async () => {
      prisma.file.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);

      const page = await service.list({ limit: 2 });

      expect(page.items).toHaveLength(2);
      expect(page.nextCursor).toBeNull();
    });
  });

  describe('upload', () => {
    it('stores the object under a tenant-prefixed key and records metadata', async () => {
      prisma.file.create.mockResolvedValue({ id: 'f1' });

      await service.upload('t1', 'u1', {
        originalname: 'note.txt',
        mimetype: 'text/plain',
        size: 5,
        buffer: Buffer.from('hello'),
      });

      const putKey = storage.put.mock.calls[0][0];
      expect(putKey).toMatch(/^t1\//);
      expect(prisma.file.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: 't1',
            uploadedById: 'u1',
            filename: 'note.txt',
          }),
        }),
      );
    });
  });

  describe('lookups', () => {
    it('download throws NotFound when the (scoped) file is absent', async () => {
      prisma.file.findFirst.mockResolvedValue(null);
      await expect(service.download('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('remove deletes both the object and the row', async () => {
      prisma.file.findFirst.mockResolvedValue({ id: 'f1', key: 't1/abc' });
      await service.remove('f1');
      expect(storage.delete).toHaveBeenCalledWith('t1/abc');
      expect(prisma.file.delete).toHaveBeenCalledWith({ where: { id: 'f1' } });
    });

    it('download streams the stored object', async () => {
      prisma.file.findFirst.mockResolvedValue({ id: 'f1', key: 't1/abc' });
      storage.get.mockResolvedValue(Readable.from(['data']));
      const result = await service.download('f1');
      expect(storage.get).toHaveBeenCalledWith('t1/abc');
      expect(result.file.id).toBe('f1');
    });
  });
});
