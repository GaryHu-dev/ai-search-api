import { INestApplication, ValidationPipe } from '@nestjs/common';

// Validate and shape every incoming payload against its DTO.
export function configureValidation(app: INestApplication): void {
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // strip properties a DTO does not declare
      forbidNonWhitelisted: true, // and reject requests that send them
      transform: true, // hydrate plain payloads into their DTO classes
    }),
  );
}
