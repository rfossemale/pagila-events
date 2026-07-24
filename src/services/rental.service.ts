import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, QueryFailedError } from 'typeorm';
import { Film } from '../entities/film.entity';
import { Payment } from '../entities/payment.entity';
import { Rental } from '../entities/rental.entity';
import { Outbox } from '../entities/outbox.entity';
import { CreateRentalDto, CreateRentalResult } from '../dto/create-rental.dto';

@Injectable()
export class RentalService {
  private readonly logger = new Logger(RentalService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Alquila un ejemplar (inventory) de `filmId` en `storeId` para `customerId`,
   * registrado por `staffId`. Todo transaccional.
   *
   * ⚠️ VERSIÓN NAIVE — SIN LOCK.
   * "Disponible" = NO existe rental con return_date IS NULL para ese inventory.
   * Bajo concurrencia, dos transacciones pueden leer el mismo `inventory_id`
   * como disponible y crear dos rentals abiertos sobre el mismo ejemplar
   * (violación de la regla de negocio). Este comportamiento es intencional
   * para demostrar la condición de carrera.
   */
  async createRental(input: CreateRentalDto): Promise<CreateRentalResult> {
    const { filmId, storeId, customerId, staffId } = input;

    this.assertPositiveInt(filmId, 'filmId');
    this.assertPositiveInt(storeId, 'storeId');
    this.assertPositiveInt(customerId, 'customerId');
    this.assertPositiveInt(staffId, 'staffId');

    return this.dataSource.transaction('READ COMMITTED', async (em) => {
      // 1) Buscar un ejemplar disponible. SIN lock → race condition posible.
      // const rows = await em.query<Array<{ inventory_id: number }>>(
      //   `
      //   SELECT i.inventory_id
      //   FROM inventory i
      //   WHERE i.film_id = $1
      //     AND i.store_id = $2
      //     AND NOT EXISTS (
      //       SELECT 1
      //       FROM rental r
      //       WHERE r.inventory_id = i.inventory_id and i.inventory_id = 1
      //         AND r.return_date IS NULL
      //     )
      //   ORDER BY i.inventory_id
      //   LIMIT 1
      //   `,
      //   [filmId, storeId],
      // );

      // ### ahora la versión con lock (para comparar el comportamiento): ###
      // - El contraste es que las dos requests van a poder ganar, si el film tiene más de un ejemplar libre,
      // porque cada una agarra uno distinto en vez de pelear por el mismo.
      // - EL FOR UPDATE SKIP LOCKED es lo que hace que la segunda request no se bloquee esperando a la primera,
      // sino que busque otro ejemplar libre en la tabla. Solamente tranca el registro que está siendo usado
      // por la primera request.
      // - Si no hay otro ejemplar libre, la segunda request falla con el ConflictException.
      const rows = await em.query<Array<{ inventory_id: number }>>(
        `
        SELECT i.inventory_id
        FROM inventory i
        WHERE i.film_id = $1
          AND i.store_id = $2
          AND NOT EXISTS (
            SELECT 1
            FROM rental r
            WHERE r.inventory_id = i.inventory_id
              AND r.return_date IS NULL
          )
        ORDER BY i.inventory_id
        LIMIT 1
        FOR UPDATE OF i SKIP LOCKED
        `,
        // El OF i es importante: sin él, FOR UPDATE intentaría bloquear filas de
        // todas las tablas del FROM, y acá solo querés bloquear inventory.
        [filmId, storeId],
      );

      if (rows.length === 0) {
        throw new ConflictException(
          `No hay ejemplares disponibles del film ${filmId} en la tienda ${storeId}`,
        );
      }
      const inventoryId = rows[0].inventory_id;

      // Pequeña ventana artificial para ampliar la race window y hacer
      // reproducible el fallo con dos requests casi simultáneas.
      // Quitar cuando se agregue el lock.
      // await new Promise((r) => setTimeout(r, 100));

      // 2) Tarifa del film para el payment.
      const film = await em.getRepository(Film).findOne({
        where: { filmId },
        select: { filmId: true, rentalRate: true },
      });
      if (!film) {
        throw new NotFoundException(`Film ${filmId} no encontrado`);
      }

      try {
        // 3) Crear rental (return_date = null → ejemplar queda "afuera").
        const now = new Date();
        const rentalRepo = em.getRepository(Rental);
        const rental = await rentalRepo.save(
          rentalRepo.create({
            inventoryId,
            customerId,
            staffId,
            rentalDate: now,
            returnDate: null,
          }),
        );

        // 4) Registrar payment vinculado al rental.
        const paymentRepo = em.getRepository(Payment);
        const payment = await paymentRepo.save(
          paymentRepo.create({
            customerId,
            staffId,
            rentalId: rental.rentalId,
            amount: film.rentalRate,
            paymentDate: now,
          }),
        );

        await em.getRepository(Outbox).save(
          em.getRepository(Outbox).create({
            aggregateType: 'Rental',
            aggregateId: String(rental.rentalId),
            eventType: 'RentalStarted',
            payload: {
              rentalId: rental.rentalId,
              inventoryId,
              customerId,
              filmId,
              storeId,
              amount: payment.amount,
              rentalDate: now.toISOString(),
            },
            // status, attempts, created_at → defaults
          }),
        );

        this.logger.log(
          `Rental ${rental.rentalId} creado: inventory=${inventoryId}, film=${filmId}, store=${storeId}, customer=${customerId}, staff=${staffId}, amount=${payment.amount}`,
        );

        return {
          rentalId: rental.rentalId,
          inventoryId,
          paymentId: payment.paymentId,
          amount: payment.amount,
          rentalDate: rental.rentalDate,
        };
      } catch (err) {
        // El .code === '23505' viene del driver pg, expuesto crudo en el error de TypeORM.
        // Es el código SQL estándar de unique_violation — vale conocerlo
        // ( esto es por la contraint definida en db/init/004-constraints.sql ), pero no es portable a otros RDBMS.
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        if (err instanceof QueryFailedError && (err as any).code === '23505') {
          throw new ConflictException(
            `El ejemplar ${inventoryId} ya fue alquilado por otra operación`,
          );
        }
        throw err;
      }
    });
  }

  private assertPositiveInt(value: unknown, name: string): void {
    if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
      throw new BadRequestException(`${name} debe ser un entero positivo`);
    }
  }
}
