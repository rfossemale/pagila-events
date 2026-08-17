import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Inventory } from './inventory.entity';
import { Customer } from './customer.entity';
import { Staff } from './staff.entity';
import { Payment } from './payment.entity';

@Entity({ name: 'rental' })
export class Rental {
  @PrimaryGeneratedColumn({ name: 'rental_id' })
  rentalId!: number;

  @Column({ name: 'rental_date', type: 'timestamptz', default: () => 'now()' })
  rentalDate!: Date;

  @Column({ name: 'inventory_id' })
  inventoryId!: number;

  @Column({ name: 'customer_id' })
  customerId!: number;

  @Column({ name: 'return_date', type: 'timestamptz', nullable: true })
  returnDate?: Date | null;

  @Column({ name: 'staff_id' })
  staffId!: number;

  @Column({
    name: 'last_update',
    type: 'timestamptz',
    default: () => 'now()',
  })
  lastUpdate!: Date;

  @ManyToOne(() => Inventory, (inventory) => inventory.rentals, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'inventory_id', referencedColumnName: 'inventoryId' })
  inventory?: Inventory;

  @ManyToOne(() => Customer, (customer) => customer.rentals, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'customer_id', referencedColumnName: 'customerId' })
  customer?: Customer;

  @ManyToOne(() => Staff, (staff) => staff.rentals, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'staff_id', referencedColumnName: 'staffId' })
  staff?: Staff;

  @OneToMany(() => Payment, (payment) => payment.rental)
  payments?: Payment[];
}
