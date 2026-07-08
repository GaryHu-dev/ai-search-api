import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Env } from '../config/env.validation';

// API docs at /docs — useful everywhere except production, where we don't expose
// our surface publicly.
export function configureSwagger(
  app: INestApplication,
  config: ConfigService<Env, true>,
): void {
  if (config.get('NODE_ENV', { infer: true }) === 'production') {
    return;
  }

  const document = new DocumentBuilder()
    .setTitle('SaaS API')
    .setDescription('SaaS foundation API')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, document));
}
