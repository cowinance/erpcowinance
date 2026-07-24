import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { DomainExceptionFilter } from './common/domain-exception.filter';
import { resolveCorsOrigin, resolveTrustProxy, securityHeaders } from './common/http-hardening';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.setGlobalPrefix('v1');

  // Detrás de un balanceador hay que confiar en X-Forwarded-For, o el rate limit por IP se
  // vuelve un límite global (todas las requests llegan con la IP del proxy). Sin proxy, confiar
  // dejaría que el cliente elija su propia IP y esquive el límite: por eso es opt-in explícito.
  const trustProxy = resolveTrustProxy();
  if (trustProxy !== false) app.set('trust proxy', trustProxy);

  app.use(securityHeaders());
  app.enableCors({ origin: resolveCorsOrigin() });
  app.useGlobalFilters(new DomainExceptionFilter());
  // Imágenes en base64 (subida de fotos) superan el límite JSON por defecto
  app.useBodyParser('json', { limit: '12mb' });
  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
  new Logger('api-core').log(`Cowinance api-core escuchando en http://localhost:${port}/v1`);
}
bootstrap();
