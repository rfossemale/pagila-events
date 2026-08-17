-- puede fallar si Pagila ya tiene datos que violan la invariante
CREATE UNIQUE INDEX uq_inventory_active_rental
ON rental (inventory_id) WHERE return_date IS NULL;