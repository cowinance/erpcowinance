import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.setGlobalPrefix('v1');
  app.enableCors({ origin: true });
  // Imágenes en base64 (subida de fotos) superan el límite JSON por defecto
  app.useBodyParser('json', { limit: '12mb' });
  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
  new Logger('api-core').log(`Cowinance api-core escuchando en http://localhost:${port}/v1`);
}
bootstrap();
