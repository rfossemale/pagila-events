// Create a new file called `inventory-availability.entity.ts` in the `consumer/src/entities`
// directory with the following content:
import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity({ schema: 'consumer', name: 'inventory_availability' })
export class InventoryAvailability {
  @PrimaryColumn({ name: 'film_id', type: 'int' })
  filmId!: number;

  @PrimaryColumn({ name: 'store_id', type: 'int' })
  storeId!: number;

  @Column({ name: 'available', type: 'int', default: 0 })
  available!: number;
}
