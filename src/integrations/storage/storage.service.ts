import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Readable } from 'node:stream';
import { Env } from '../../core/config/env.validation';

// Thin wrapper over any S3-compatible object store. Local development points at
// MinIO; production points at Cloudflare R2 — identical API, only the endpoint
// and credentials differ. Unconfigured, file features are simply disabled
// rather than crashing the app.
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly client?: S3Client;
  private readonly bucket?: string;
  private readonly isProduction: boolean;

  constructor(config: ConfigService<Env, true>) {
    const endpoint = config.get('STORAGE_ENDPOINT', { infer: true });
    const accessKeyId = config.get('STORAGE_ACCESS_KEY_ID', { infer: true });
    const secretAccessKey = config.get('STORAGE_SECRET_ACCESS_KEY', {
      infer: true,
    });
    this.bucket = config.get('STORAGE_BUCKET', { infer: true });
    this.isProduction =
      config.get('NODE_ENV', { infer: true }) === 'production';

    if (endpoint && accessKeyId && secretAccessKey && this.bucket) {
      this.client = new S3Client({
        endpoint,
        region: config.get('STORAGE_REGION', { infer: true }),
        credentials: { accessKeyId, secretAccessKey },
        forcePathStyle: config.get('STORAGE_FORCE_PATH_STYLE', { infer: true }),
      });
    }
  }

  async onModuleInit(): Promise<void> {
    if (!this.client || !this.bucket) {
      this.logger.warn(
        'Object storage is not configured; file features are disabled.',
      );
      return;
    }
    if (this.isProduction) {
      // Production: verify the bucket exists and fail fast. Never auto-create —
      // that would silently mask a misconfigured bucket name or missing perms.
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } else {
      await this.ensureBucket(this.client, this.bucket);
    }
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    const { client, bucket } = this.require();
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async get(key: string): Promise<Readable> {
    const { client, bucket } = this.require();
    const result = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    );
    return result.Body as Readable;
  }

  async delete(key: string): Promise<void> {
    const { client, bucket } = this.require();
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  }

  private require(): { client: S3Client; bucket: string } {
    if (!this.client || !this.bucket) {
      throw new ServiceUnavailableException('Object storage is not configured');
    }
    return { client: this.client, bucket: this.bucket };
  }

  private async ensureBucket(client: S3Client, bucket: string): Promise<void> {
    try {
      await client.send(new HeadBucketCommand({ Bucket: bucket }));
    } catch {
      await client.send(new CreateBucketCommand({ Bucket: bucket }));
      this.logger.log(`Created storage bucket "${bucket}"`);
    }
  }
}
