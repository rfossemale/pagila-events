import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, QueryFailedError } from 'typeorm';
import { PinoLogger } from 'nestjs-pino';
import { Film } from '../entities/film.entity';
import { Payment } from '../entities/payment.entity';
import { Rental } from '../entities/rental.entity';
import { Outbox } from '../entities/outbox.entity';
import {
  CreateRentalDto,
  CreateRentalResult,
  ReturnRentalResult,
} from '../dto/create-rental.dto';
// - código SQL estándar de unique_violation (PostgreSQL)
// - no es portable a otros RDBMS
const UNIQUE_VIOLATION_CODE = '23505';
@Injectable()
export class RentalService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(RentalService.name);
  }

  /**
   * Nota:
   * Bajo concurrencia, dos transacciones pueden leer el mismo `inventory_id`
   * como disponible y crear dos rentals abiertos sobre el mismo ejemplar
   * (violación de la regla de negocio). Este comportamiento es intencional
   * para demostrar la condición de carrera. ( Codigo comentado )
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
      const film = await em.getRepository(Film).findOne({
        where: { filmId },
        select: { filmId: true, rentalRate: true },
      });
      if (!film) {
        throw new NotFoundException(`Film ${filmId} no encontrado`);
      }

      try {
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
              version: 1, // version inicial del agregado
            },
          }),
        );

        this.logger.info(
          {
            rentalId: rental.rentalId,
            inventoryId,
            filmId,
            storeId,
            customerId,
            staffId,
            amount: payment.amount,
          },
          'rental creado',
        );

        return {
          rentalId: rental.rentalId,
          inventoryId,
          paymentId: payment.paymentId,
          amount: payment.amount,
          rentalDate: rental.rentalDate,
        };
      } catch (err) {
        if (
          err instanceof QueryFailedError &&
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          (err as any).code === UNIQUE_VIOLATION_CODE
        ) {
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

  /**
   * Devuelve un ejemplar alquilado: setea `return_date = now()` en el rental
   * y emite un evento `RentalReturned` v2 al outbox.
   *
   * Concurrencia: se bloquea la fila del rental con `FOR UPDATE` para evitar
   * doble-return concurrente (dos requests marcando la misma devolución →
   * dos eventos v2 → el consumer aplicaría el +1 dos veces).
   */
  async returnRental(rentalId: number): Promise<ReturnRentalResult> {
    this.assertPositiveInt(rentalId, 'rentalId');

    return this.dataSource.transaction('READ COMMITTED', async (em) => {
      // 1) Lock del rental + JOIN a inventory para conocer film/store.
      //    FOR UPDATE OF r: solo bloqueamos la fila del rental.
      const rows = await em.query<
        Array<{
          rental_id: number;
          inventory_id: number;
          return_date: Date | null;
          film_id: number;
          store_id: number;
        }>
      >(
        `
        SELECT r.rental_id, r.inventory_id, r.return_date,
               i.film_id, i.store_id
        FROM rental r
        JOIN inventory i ON i.inventory_id = r.inventory_id
        WHERE r.rental_id = $1
        FOR UPDATE OF r
        `,
        [rentalId],
      );

      if (rows.length === 0) {
        throw new NotFoundException(`Rental ${rentalId} no encontrado`);
      }
      const row = rows[0];

      if (row.return_date !== null) {
        throw new ConflictException(
          `Rental ${rentalId} ya fue devuelto el ${row.return_date.toISOString()}`,
        );
      }

      // 2) Marcar como devuelto. La UNIQUE INDEX parcial
      //    uq_inventory_active_rental "libera" el ejemplar automáticamente
      //    (deja de estar en el predicado WHERE return_date IS NULL).
      const now = new Date();
      await em
        .getRepository(Rental)
        .update({ rentalId }, { returnDate: now, lastUpdate: now });

      // 3) Evento RentalReturned v2 al outbox (misma tx).
      await em.getRepository(Outbox).save(
        em.getRepository(Outbox).create({
          aggregateType: 'Rental',
          aggregateId: String(rentalId),
          eventType: 'RentalReturned',
          payload: {
            rentalId,
            inventoryId: row.inventory_id,
            filmId: row.film_id,
            storeId: row.store_id,
            returnDate: now.toISOString(),
            version: 2, // v1 = RentalStarted; v2 = RentalReturned
          },
        }),
      );

      this.logger.info(
        {
          rentalId,
          inventoryId: row.inventory_id,
          filmId: row.film_id,
          storeId: row.store_id,
        },
        'rental devuelto',
      );

      return {
        rentalId,
        inventoryId: row.inventory_id,
        filmId: row.film_id,
        storeId: row.store_id,
        returnDate: now,
      };
    });
  }
}
