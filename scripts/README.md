# Reproducir la race condition en POST /rentals

Estos scripts sirven para demostrar por qué hace falta el lock pesimista.
La versión actual del servicio (`rental.service.ts`) tiene **desactivado** el
`FOR UPDATE SKIP LOCKED` y agrega un `sleep(100ms)` artificial dentro de la
transacción para ampliar la ventana de carrera → dos requests concurrentes
sobre el último ejemplar disponible producen dos rentals abiertos apuntando
al mismo `inventory_id` (violación de la regla de negocio).

## Requisitos

- Docker Compose corriendo (`docker compose up -d`).
- Backend Nest levantado en `http://localhost:3000` (`cd producer && npm run start:dev`).
- Node ≥ 18 (para `fetch` nativo) y `psql` en el PATH.

## 1. Elegir un film/store con exactamente 1 copia disponible

```bash
psql "postgresql://pagila:pagila@localhost:5433/pagila" -f scripts/race-setup.sql
```

Anotá un `film_id`, `store_id` de la primera consulta y un `customer_id` /
`staff_id` de la tercera. Ajustá `\set film_id` / `\set store_id` arriba del
`.sql` si querés inspeccionar otro par.

## 2. Disparar N requests concurrentes

```bash
node scripts/race-rental.mjs \
  --film 1 --store 1 --customer 1 --staff 1 --n 2
```

El script hace `Promise.all` con `N` fetches en paralelo e imprime:

- Status y latencia de cada request.
- `inventory_id` que devolvió cada 201.
- Si dos éxitos apuntan al mismo `inventory_id` → **race condition confirmada**
  (exit code `2`).

Equivalente en bash puro:

```bash
BODY='{"filmId":1,"storeId":1,"customerId":1,"staffId":1}'
curl -s -X POST http://localhost:3000/api/rentals -H 'Content-Type: application/json' -d "$BODY" &
curl -s -X POST http://localhost:3000/api/rentals -H 'Content-Type: application/json' -d "$BODY" &
wait
```

## 3. Verificar el daño en la BD

```bash
psql "postgresql://pagila:pagila@localhost:5433/pagila" -f scripts/race-verify.sql
```

La primera consulta lista todos los `inventory_id` con más de un rental abierto
(`return_date IS NULL`). Cualquier fila con `open_rentals > 1` es evidencia de
la carrera. La columna `delta_ms` muestra qué tan cerca en el tiempo se creó
la colisión.

## Limpieza opcional (cerrar los rentals abiertos que quedaron)

```sql
UPDATE rental
SET return_date = now()
WHERE return_date IS NULL AND rental_date > now() - interval '1 hour';
```
