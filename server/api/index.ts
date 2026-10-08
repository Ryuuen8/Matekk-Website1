import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ExpressAdapter } from '@nestjs/platform-express';
import express from 'express';
import { AppModule } from '../src/app.module.js';

const server = express();
let ready: Promise<void> | null = null;

async function bootstrap() {
  const app = await NestFactory.create(AppModule, new ExpressAdapter(server));
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  const allowedOrigins = new Set(
    [
      'https://matekk-website1-q7cp.vercel.app',
      ...(process.env.FRONTEND_URL ? [process.env.FRONTEND_URL] : []),
      ...(process.env.CORS_ORIGINS ?? '').split(','),
    ]
      .map((origin) => origin.trim().replace(/\/+$/, ''))
      .filter(Boolean),
  );
  const isDevelopment = process.env.NODE_ENV !== 'production';

  app.enableCors({
    credentials: true,
    origin: (
      requestOrigin: string | undefined,
      callback: (error: Error | null, allow?: boolean) => void,
    ) => {
      if (
        !requestOrigin ||
        allowedOrigins.has(requestOrigin) ||
        (isDevelopment &&
          /^https?:\/\/(localhost|127\.0\.0\.1|\d{1,3}(?:\.\d{1,3}){3}):\d+$/.test(
            requestOrigin,
          ))
      ) {
        callback(null, true);
        return;
      }

      callback(new Error('Origin is not allowed by CORS'), false);
    },
  });
  await app.init();
}

export default async function handler(req: any, res: any) {
  ready ??= bootstrap();
  await ready;
  server(req, res);
}
