import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { File, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { ListQuery, Page, parseSort } from '../../core/common/pagination';
import {
  TENANT_PRISMA,
  TenantPrismaClient,
} from '../../core/prisma/prisma.module';
import { StorageService } from '../../integrations/storage/storage.service';

// Fields callers may sort by; anything else falls back to the default.
const SORTABLE_FIELDS = ['createdAt', 'filename', 'size'] as const;

export interface UploadInput {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

// Uses the tenant-scoped Prisma client: the reads and deletes below carry no
// `tenantId`, because the tenant-scope extension injects it from the request
// context. A file belonging to another tenant is simply invisible here.
@Injectable()
export class FilesService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly prisma: TenantPrismaClient,
    private readonly storage: StorageService,
  ) {}

  async upload(
    tenantId: string,
    uploadedById: string,
    input: UploadInput,
  ): Promise<File> {
    // Tenant-prefixed key namespaces each tenant's objects within the bucket.
    const key = `${tenantId}/${randomUUID()}`;
    await this.storage.put(key, input.buffer, input.mimetype);

    // tenantId is a required column, so it's set explicitly here; the extension
    // reinforces it. (Forgetting it on a create fails loudly, not silently.)
    return this.prisma.file.create({
      data: {
        tenantId,
        uploadedById,
        key,
        filename: input.originalname,
        contentType: input.mimetype,
        size: input.size,
      },
    });
  }

  async list(query: ListQuery): Promise<Page<File>> {
    // Filtering (search by filename) and sorting are optional; the tenant filter
    // is injected automatically by the tenant-scope extension.
    const where: Prisma.FileWhereInput = query.search
      ? { filename: { contains: query.search, mode: 'insensitive' } }
      : {};

    // Fetch one extra row to tell whether a further page exists.
    const rows = await this.prisma.file.findMany({
      where,
      orderBy: parseSort(query.sort, SORTABLE_FIELDS, {
        field: 'createdAt',
        order: 'desc',
      }),
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > query.limit;
    const items = hasMore ? rows.slice(0, query.limit) : rows;
    const nextCursor = hasMore ? items[items.length - 1].id : null;
    return { items, nextCursor };
  }

  async download(id: string): Promise<{ file: File; stream: Readable }> {
    const file = await this.getOwned(id);
    const stream = await this.storage.get(file.key);
    return { file, stream };
  }

  async remove(id: string): Promise<void> {
    const file = await this.getOwned(id);
    await this.storage.delete(file.key);
    await this.prisma.file.delete({ where: { id: file.id } });
  }

  private async getOwned(id: string): Promise<File> {
    const file = await this.prisma.file.findFirst({ where: { id } });
    if (!file) {
      throw new NotFoundException('File not found');
    }
    return file;
  }
}
