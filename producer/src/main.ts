import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { AppModule } from './app.module';
import { RentalQueueService } from './queues/rental-queue.service';

const BULL_BOARD_PATH = '/admin/queues';

async function bootstrap() {
  // `bufferLogs` retiene los logs de arranque hasta que Pino toma el control,
  // para que TODA la app (incluidos los logs internos de Nest) salga en JSON.
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix('api');

  // ── Bull Board UI ────────────────────────────────────────────────────
  // `setGlobalPrefix('api')` solo afecta a controladores Nest; el middleware
  // Express montado con `app.use()` queda por fuera del prefix, así que la
  // UI vive en /admin/queues (no /api/admin/queues).
  const rentalQueueService = app.get(RentalQueueService);
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath(BULL_BOARD_PATH);

  createBullBoard({
    queues: [new BullMQAdapter(rentalQueueService.getQueue())],
    serverAdapter,
  });

  app.use(BULL_BOARD_PATH, serverAdapter.getRouter());

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  app
    .get(Logger)
    .log(
      `🐂 Bull Board disponible en http://localhost:${port}${BULL_BOARD_PATH}`,
    );
}
void bootstrap();
