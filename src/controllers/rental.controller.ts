import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { RentalService } from '../services/rental.service';
import { CreateRentalDto, CreateRentalResult } from '../dto/create-rental.dto';

@Controller('rentals')
export class RentalController {
  constructor(private readonly rentalService: RentalService) {}

  @Post()
  @HttpCode(201)
  async createRental(
    @Body() body: CreateRentalDto,
  ): Promise<CreateRentalResult> {
    return this.rentalService.createRental(body);
  }
}
