DROP INDEX uq_inventory_active_rental;
CREATE UNIQUE INDEX uq_inventory_active_rental
ON rental (inventory_id)
WHERE return_date IS NULL AND status != 'cancelled';