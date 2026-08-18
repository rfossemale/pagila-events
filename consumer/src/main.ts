import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';

async function bootstrap() {
  // `bufferLogs` retiene los logs de arranque hasta que Pino toma el control,
  // para que TODA la app (incluidos los logs internos de Nest) salga en JSON.
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  await app.listen(process.env.PORT ?? 3001);
}
void bootstrap();
