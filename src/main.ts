import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { AppModule } from './app.module';
import { RentalQueueService } from './queues/rental-queue.service';

const BULL_BOARD_PATH = '/admin/queues';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
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
  new Logger('Bootstrap').log(
    `🐂 Bull Board disponible en http://localhost:${port}${BULL_BOARD_PATH}`,
  );
}
void bootstrap();
