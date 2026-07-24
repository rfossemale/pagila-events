export class CreateRentalDto {
  filmId!: number;
  storeId!: number;
  customerId!: number;
  staffId!: number;
}

export interface CreateRentalResult {
  rentalId: number;
  inventoryId: number;
  paymentId: number;
  amount: number;
  rentalDate: Date;
}
