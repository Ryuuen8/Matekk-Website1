import { NestFactory } from '@nestjs/core';
import { AppModule, isObserveEnabled, ObserveInstrument } from './app.module.js';
import { ValidationPipe } from '@nestjs/common';
import * as helmetModule from 'helmet';

const helmet = helmetModule.default;

async function bootstrap() {
  const app = await NestFactory.create(
    AppModule,
    isObserveEnabled ? { instrument: ObserveInstrument } : {},
  );
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  const allowedOrigins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const isDevelopment = process.env.NODE_ENV !== 'production';

  app.enableCors({
    credentials: true,
    origin: (
      requestOrigin: string | undefined,
      callback: (error: Error | null, allow?: boolean) => void,
    ) => {
      if (
        !requestOrigin ||
        allowedOrigins.includes(requestOrigin) ||
        (isDevelopment &&
          /^https?:\/\/(localhost|127\.0\.0\.1|\d{1,3}(?:\.\d{1,3}){3}):\d+$/.test(requestOrigin))
      ) {
        callback(null, true);
        return;
      }

      callback(new Error('Origin is not allowed by CORS'), false);
    },
  });
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: [`'self'`],
          scriptSrc: [`'self'`],
          styleSrc: [`'self'`, `'unsafe-inline'`],
          imgSrc: [`'self'`, 'data:', 'https:'],
          fontSrc: [`'self'`, 'https:', 'data:'],
          connectSrc: [`'self'`],
          objectSrc: [`'none'`],
          frameAncestors: [`'self'`],
          upgradeInsecureRequests: [],
        },
      },
    }),
  );
  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}
await bootstrap();
