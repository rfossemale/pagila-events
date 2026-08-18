# Scripts de prueba

Este directorio contiene dos cosas:

1. **`test-suite.mjs`** — una **batería de pruebas de integración end-to-end**
   que valida que toda la arquitectura funciona (alta y devolución de rentals,
   outbox, proyección del consumer, idempotencia, orden por versión y
   concurrencia sin doble-booking).
2. **`load-simulation.mjs`** — un **simulador de tráfico dinámico** que genera
   carga HTTP real con oleadas (rampa, pico, spike, enfriamiento) para observar
   el sistema bajo estrés en Grafana/Prometheus.
3. **`race-*`** — scripts enfocados para **reproducir/observar la race
   condition** en `POST /rentals` de forma manual.

## Requisitos

- Docker Compose corriendo (`docker compose up -d --build`).
- Node ≥ 18 (para `fetch` nativo) y `psql` en el PATH.

---

## 🧪 Batería de integración: `test-suite.mjs`

Runner autónomo (sin frameworks) que dispara **pedidos HTTP reales** contra el
`producer`/`consumer` y verifica los efectos en PostgreSQL. Cada prueba está
comentada para que se entienda qué valida.

```bash
node scripts/test-suite.mjs
```

Salida esperada: `21 passed · 0 failed`. Exit code `0` si todo pasa, `1` si algo
falla (ideal para CI).

Suites incluidas:

| Suite | Qué prueba |
| --- | --- |
| 0 · Preflight | El API responde; aborta con instrucciones si el stack está caído. |
| 1 · Alta de rental | `POST /rentals` → 201, fila en DB, outbox drenado, proyección −1, versión 1. |
| 2 · Devolución | `POST /rentals/:id/return` → 200, `return_date`, proyección +1, versión 2. |
| 3 · Reglas de negocio | Doble-return → 409, inexistente → 404, payloads inválidos → 400. |
| 4 · Idempotencia | El mismo `eventId` enviado dos veces se procesa **una sola vez**. |
| 5 · Orden por versión | Un evento con versión menor (viejo) se **descarta**. |
| 6 · Concurrencia | N pedidos en paralelo **no doble-reservan** el mismo ejemplar (lock pesimista). |

La suite es **higiénica**: devuelve los rentals que abrió, así se puede correr
las veces que quieras. Overrides por entorno: `API_URL`, `CONSUMER_URL`,
`DATABASE_URL`.

---

## � Simulador de tráfico dinámico: `load-simulation.mjs`

Genera **carga HTTP real** contra el `producer` durante ~2 minutos siguiendo un
**perfil de fases** que sube y baja el RPS objetivo, para poder visualizar el
sistema bajo estrés en Grafana/Prometheus (throughput, p95, backlog del outbox,
eventos/s del consumer, Postgres/Redis).

```bash
node scripts/load-simulation.mjs
```

Cada operación es un ciclo de negocio real: **alquilar** (baja disponibilidad) o
**devolver** (la restaura). Mantiene un pool de rentals abiertos y mezcla ambas,
así la proyección `inventory_availability` "respira". Algunos `409` (sin stock)
son esperados. Al terminar (o con Ctrl-C) **devuelve los rentals que queden
abiertos**.

Fases del perfil: `warm-up → ramp-up → peak → valley → SPIKE → recovery →
cool-down`. Overrides por entorno:

| Variable | Default | Descripción |
| --- | --- | --- |
| `DURATION_SEC` | `120` | Duración total de la simulación. |
| `PEAK_RPS` | `80` | RPS del pico/spike. |
| `MAX_INFLIGHT` | `250` | Tope de peticiones simultáneas. |
| `RETURN_BIAS` | `0.45` | Probabilidad base de devolver vs. alquilar. |

```bash
# Estrés fuerte de 3 minutos con pico de 120 rps:
DURATION_SEC=180 PEAK_RPS=120 node scripts/load-simulation.mjs
```

> 📊 Mientras corre, abrí el dashboard en **http://localhost:3000/grafana**.

---

## �🏁 Demo manual de la race condition

> Los scripts `race-*` asumen que querés **observar** el comportamiento bajo
> concurrencia paso a paso. La Suite 6 de `test-suite.mjs` ya cubre esto de
> forma automatizada contra la versión con lock (`FOR UPDATE SKIP LOCKED`).

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
