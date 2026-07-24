import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Film } from './film.entity';
import { Store } from './store.entity';
import { Rental } from './rental.entity';

@Entity({ name: 'inventory' })
export class Inventory {
  @PrimaryGeneratedColumn({ name: 'inventory_id' })
  inventoryId!: number;

  @Column({ name: 'film_id' })
  filmId!: number;

  @Column({ name: 'store_id' })
  storeId!: number;

  @Column({
    name: 'last_update',
    type: 'timestamptz',
    default: () => 'now()',
  })
  lastUpdate!: Date;

  @ManyToOne(() => Film, (film) => film.inventories, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'film_id', referencedColumnName: 'filmId' })
  film?: Film;

  @ManyToOne(() => Store, (store) => store.inventories, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'store_id', referencedColumnName: 'storeId' })
  store?: Store;

  @OneToMany(() => Rental, (rental) => rental.inventory)
  rentals?: Rental[];
}
