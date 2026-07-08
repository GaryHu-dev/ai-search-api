import { INestApplication, VersioningType } from '@nestjs/common';

// URI versioning from day one, so a future breaking change ships as /v2 rather
// than forcing every client to migrate at once.
export function configureVersioning(app: INestApplication): void {
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
}
