-- =====================================================================
-- Verificar si hubo colisión: buscar inventarios con MÁS DE 1 rental abierto.
-- Uso: psql "postgresql://pagila:pagila@localhost:5433/pagila" -f scripts/race-verify.sql
-- =====================================================================

\echo '=== ⚠️  Inventarios con más de 1 rental ABIERTO (return_date IS NULL) ==='
\echo '=== Si aparecen filas → la race condition ocurrió. ==='
SELECT
  r.inventory_id,
  i.film_id,
  i.store_id,
  COUNT(*) AS open_rentals,
  array_agg(r.rental_id ORDER BY r.rental_id) AS rental_ids,
  array_agg(r.customer_id ORDER BY r.rental_id) AS customer_ids,
  MIN(r.rental_date) AS first_rental_at,
  MAX(r.rental_date) AS last_rental_at,
  EXTRACT(EPOCH FROM (MAX(r.rental_date) - MIN(r.rental_date))) * 1000 AS delta_ms
FROM rental r
JOIN inventory i USING (inventory_id)
WHERE r.return_date IS NULL
GROUP BY r.inventory_id, i.film_id, i.store_id
HAVING COUNT(*) > 1
ORDER BY open_rentals DESC, r.inventory_id;

\echo ''
\echo '=== Últimos 10 rentals creados (para contexto) ==='
SELECT
  r.rental_id,
  r.inventory_id,
  i.film_id,
  i.store_id,
  r.customer_id,
  r.staff_id,
  r.rental_date,
  r.return_date
FROM rental r
JOIN inventory i USING (inventory_id)
ORDER BY r.rental_id DESC
LIMIT 10;
