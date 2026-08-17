-- =====================================================================
-- Preparación / verificación de la race condition en POST /rentals
-- Uso: psql "postgresql://pagila:pagila@localhost:5433/pagila" -f scripts/race-setup.sql
-- =====================================================================

-- 1) Encontrar candidatos: film + store con POCAS copias no alquiladas.
--    Ideal para la prueba: exactamente 1 ejemplar disponible.
--    Ordena por disponibles ASC para ver primero los más "escasos".
\echo '=== Films con 1 sola copia disponible en alguna tienda ==='
SELECT
  i.film_id,
  i.store_id,
  COUNT(*) FILTER (
    WHERE NOT EXISTS (
      SELECT 1 FROM rental r
      WHERE r.inventory_id = i.inventory_id AND r.return_date IS NULL
    )
  ) AS available_copies,
  COUNT(*) AS total_copies
FROM inventory i
GROUP BY i.film_id, i.store_id
HAVING COUNT(*) FILTER (
    WHERE NOT EXISTS (
      SELECT 1 FROM rental r
      WHERE r.inventory_id = i.inventory_id AND r.return_date IS NULL
    )
  ) = 1
ORDER BY total_copies ASC, i.film_id
LIMIT 10;

-- 2) Detalle de los inventarios y su estado para un film/store específico.
--    Cambiá los valores :film_id y :store_id abajo (o pasalos como -v).
\set film_id 1
\set store_id 1

\echo ''
\echo '=== Inventarios del film :film_id en store :store_id ==='
SELECT
  i.inventory_id,
  (
    SELECT COUNT(*) FROM rental r
    WHERE r.inventory_id = i.inventory_id AND r.return_date IS NULL
  ) AS open_rentals,
  CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM rental r
      WHERE r.inventory_id = i.inventory_id AND r.return_date IS NULL
    ) THEN 'AVAILABLE'
    ELSE 'RENTED'
  END AS status
FROM inventory i
WHERE i.film_id = :film_id AND i.store_id = :store_id
ORDER BY i.inventory_id;

-- 3) IDs de customer y staff válidos para usar en el POST.
\echo ''
\echo '=== customer_id y staff_id válidos (primeros de la tienda) ==='
SELECT 'customer' AS kind, customer_id AS id FROM customer WHERE store_id = :store_id ORDER BY customer_id LIMIT 3
UNION ALL
SELECT 'staff' AS kind, staff_id AS id FROM staff WHERE store_id = :store_id ORDER BY staff_id LIMIT 3;
