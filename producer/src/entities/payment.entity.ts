import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Customer } from './customer.entity';
import { Staff } from './staff.entity';
import { Rental } from './rental.entity';

/**
 * Tabla particionada por RANGE(payment_date).
 * Se mapea la tabla padre `payment`; las particiones (payment_p2022_*)
 * no se declaran como entidades separadas.
 * PK física compuesta (payment_date, payment_id) — se marca payment_id como
 * PrimaryGeneratedColumn y payment_date como PrimaryColumn para respetarla.
 */
@Entity({ name: 'payment' })
export class Payment {
  @PrimaryGeneratedColumn({ name: 'payment_id', type: 'int' })
  paymentId!: number;

  @Column({ name: 'customer_id', type: 'int' })
  customerId!: number;

  @Column({ name: 'staff_id', type: 'int' })
  staffId!: number;

  @Column({ name: 'rental_id', type: 'int' })
  rentalId!: number;

  @Column({
    name: 'amount',
    type: 'numeric',
    precision: 5,
    scale: 2,
    transformer: {
      to: (value?: number) => value,
      from: (value?: string) => (value == null ? value : parseFloat(value)),
    },
  })
  amount!: number;

  @Column({ name: 'payment_date', type: 'timestamptz', primary: true })
  paymentDate!: Date;

  @ManyToOne(() => Customer, (customer) => customer.payments, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'customer_id', referencedColumnName: 'customerId' })
  customer?: Customer;

  @ManyToOne(() => Staff, (staff) => staff.payments, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'staff_id', referencedColumnName: 'staffId' })
  staff?: Staff;

  @ManyToOne(() => Rental, (rental) => rental.payments, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'rental_id', referencedColumnName: 'rentalId' })
  rental?: Rental;
}
